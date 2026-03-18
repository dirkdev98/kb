import { DatabaseSync } from 'node:sqlite'
import { createMigrationBackup } from './backup.ts'

const CURRENT_SCHEMA_VERSION = 1

export type EntryRecord = {
  id: number
  question: string
  answer: string
  createdAt: string
  updatedAt: string
  addedVia: string
  viewCount: number
  lastViewedAt: string | null
  tags: string[]
}

export type LinkedEntryRecord = {
  id: number
  question: string
}

type EntryRow = {
  id: number
  question: string
  answer: string
  created_at: string
  updated_at: string
  added_via: string
  view_count: number
  last_viewed_at: string | null
}

function slugTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
}

function uniqTags(tags: string[]): string[] {
  return [...new Set(tags.map(slugTag).filter(Boolean))].sort()
}

export class KBDatabase {
  private readonly db: DatabaseSync

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath)
    this.db.exec('pragma foreign_keys = on')
    this.db.exec('pragma busy_timeout = 5000')
  }

  close(): void {
    this.db.close()
  }

  get sqlite(): DatabaseSync {
    return this.db
  }

  async ensureSchema(backupDir: string, now: Date): Promise<void> {
    const version = this.getUserVersion()
    if (version === CURRENT_SCHEMA_VERSION) {
      this.ensureLatestSupportTables()
      return
    }

    if (version === 0 && !this.hasTable('entries') && !this.hasTable('tags') && !this.hasTable('entry_tags')) {
      this.createLatestSchema()
      return
    }

    if (version === 0) {
      await createMigrationBackup(this.db, backupDir, now)
      this.migrateLegacySchema()
      return
    }

    throw new Error(`Unsupported schema version: ${version}`)
  }

  createEntry(input: { question: string; answer: string; tags: string[]; addedVia: string }): EntryRecord {
    const tags = uniqTags(input.tags)
    this.db.exec('begin immediate')
    try {
      const entry = this.db
        .prepare(`
          insert into entries (question, answer, created_at, updated_at, added_via, view_count, last_viewed_at)
          values (?, ?, current_timestamp, current_timestamp, ?, 0, null)
          returning id, question, answer, created_at, updated_at, added_via, view_count, last_viewed_at
        `)
        .get(input.question.trim(), input.answer.trim(), input.addedVia.trim() || 'interactive') as EntryRow

      this.replaceTags(entry.id, tags)
      this.db.exec('commit')
      return this.getEntry(entry.id)!
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  updateEntry(id: number, input: { question: string; answer: string; tags: string[] }): EntryRecord {
    const tags = uniqTags(input.tags)
    this.db.exec('begin immediate')
    try {
      this.db
        .prepare(`
          update entries
          set question = ?, answer = ?, updated_at = current_timestamp
          where id = ?
        `)
        .run(input.question.trim(), input.answer.trim(), id)
      this.replaceTags(id, tags)
      this.db.exec('commit')
      const entry = this.getEntry(id)
      if (!entry) throw new Error(`Entry #${id} not found`)
      return entry
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  removeEntry(id: number): boolean {
    const result = this.db.prepare('delete from entries where id = ?').run(id)
    return Number(result.changes) > 0
  }

  getEntry(id: number): EntryRecord | null {
    const row = this.db
      .prepare('select id, question, answer, created_at, updated_at, added_via, view_count, last_viewed_at from entries where id = ?')
      .get(id) as EntryRow | undefined
    if (!row) return null
    return this.mapEntry(row)
  }

  listEntries(tag?: string): EntryRecord[] {
    const rows = tag
      ? (this.db
          .prepare(`
            select e.id, e.question, e.answer, e.created_at, e.updated_at, e.added_via, e.view_count, e.last_viewed_at
            from entries e
            join entry_tags et on et.entry_id = e.id
            join tags t on t.id = et.tag_id
            where t.name = ?
            order by e.updated_at desc, e.id desc
          `)
          .all(slugTag(tag)) as EntryRow[])
      : (this.db
          .prepare(`
            select id, question, answer, created_at, updated_at, added_via, view_count, last_viewed_at
            from entries
            order by updated_at desc, id desc
          `)
          .all() as EntryRow[])

    return rows.map((row) => this.mapEntry(row))
  }

  listTags(): string[] {
    const rows = this.db.prepare('select name from tags order by name asc').all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  }

  createTag(tag: string): string {
    const name = slugTag(tag)
    if (!name) throw new Error('Tag required')
    this.db.prepare('insert into tags (name) values (?) on conflict(name) do nothing').run(name)
    return name
  }

  allEntries(): EntryRecord[] {
    const rows = this.db
      .prepare('select id, question, answer, created_at, updated_at, added_via, view_count, last_viewed_at from entries order by id asc')
      .all() as EntryRow[]
    return rows.map((row) => this.mapEntry(row))
  }

  recordView(entryId: number, command: string): void {
    this.db.exec('begin immediate')
    try {
      this.db
        .prepare('insert into entry_views (entry_id, viewed_at, command) values (?, current_timestamp, ?)')
        .run(entryId, command)
      this.db
        .prepare('update entries set view_count = view_count + 1, last_viewed_at = current_timestamp where id = ?')
        .run(entryId)
      this.db.exec('commit')
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  recordSearch(query: string, resultCount: number, command: string): void {
    this.db
      .prepare('insert into search_events (query, searched_at, result_count, command) values (?, current_timestamp, ?, ?)')
      .run(query, resultCount, command)
  }

  createLink(leftId: number, rightId: number): void {
    const [lowId, highId] = leftId < rightId ? [leftId, rightId] : [rightId, leftId]
    this.db
      .prepare(`
        insert into entry_links (entry_low_id, entry_high_id, created_at)
        values (?, ?, current_timestamp)
        on conflict(entry_low_id, entry_high_id) do nothing
      `)
      .run(lowId, highId)
  }

  listLinkedEntries(entryId: number): LinkedEntryRecord[] {
    return this.db
      .prepare(`
        select e.id, e.question
        from entry_links l
        join entries e on (
          (l.entry_low_id = ? and e.id = l.entry_high_id)
          or
          (l.entry_high_id = ? and e.id = l.entry_low_id)
        )
        order by e.updated_at desc, e.id desc
      `)
      .all(entryId, entryId) as LinkedEntryRecord[]
  }

  private replaceTags(entryId: number, tags: string[]): void {
    this.db.prepare('delete from entry_tags where entry_id = ?').run(entryId)

    const insertTag = this.db.prepare('insert into tags (name) values (?) on conflict(name) do nothing')
    const fetchTag = this.db.prepare('select id from tags where name = ?')
    const linkTag = this.db.prepare('insert into entry_tags (entry_id, tag_id) values (?, ?)')

    for (const tag of tags) {
      insertTag.run(tag)
      const row = fetchTag.get(tag) as { id: number } | undefined
      if (!row) continue
      linkTag.run(entryId, row.id)
    }
  }

  private mapEntry(row: EntryRow): EntryRecord {
    const tags = this.db
      .prepare(`
        select t.name
        from tags t
        join entry_tags et on et.tag_id = t.id
        where et.entry_id = ?
        order by t.name asc
      `)
      .all(row.id) as Array<{ name: string }>

    return {
      id: row.id,
      question: row.question,
      answer: row.answer,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      addedVia: row.added_via,
      viewCount: row.view_count,
      lastViewedAt: row.last_viewed_at,
      tags: tags.map((tag) => tag.name),
    }
  }

  private getUserVersion(): number {
    const row = this.db.prepare('pragma user_version').get() as { user_version?: number } | undefined
    return row?.user_version ?? 0
  }

  private setUserVersion(version: number): void {
    this.db.exec(`pragma user_version = ${version}`)
  }

  private hasTable(name: string): boolean {
    const row = this.db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name) as { 1: number } | undefined
    return Boolean(row)
  }

  private hasColumn(table: string, column: string): boolean {
    const rows = this.db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>
    return rows.some((row) => row.name === column)
  }

  private createLatestSchema(): void {
    this.db.exec('begin immediate')
    try {
      this.db.exec(`
        create table if not exists entries (
          id integer primary key autoincrement,
          question text not null,
          answer text not null,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp,
          added_via text not null default 'interactive',
          view_count integer not null default 0,
          last_viewed_at text
        );

        create table if not exists tags (
          id integer primary key autoincrement,
          name text not null unique
        );

        create table if not exists entry_tags (
          entry_id integer not null,
          tag_id integer not null,
          primary key (entry_id, tag_id),
          foreign key (entry_id) references entries(id) on delete cascade,
          foreign key (tag_id) references tags(id) on delete cascade
        );

        create table if not exists entry_views (
          id integer primary key autoincrement,
          entry_id integer not null,
          viewed_at text not null default current_timestamp,
          command text not null,
          foreign key (entry_id) references entries(id) on delete cascade
        );

        create table if not exists search_events (
          id integer primary key autoincrement,
          query text not null,
          searched_at text not null default current_timestamp,
          result_count integer not null,
          command text not null
        );

        create table if not exists entry_links (
          entry_low_id integer not null,
          entry_high_id integer not null,
          created_at text not null default current_timestamp,
          primary key (entry_low_id, entry_high_id),
          foreign key (entry_low_id) references entries(id) on delete cascade,
          foreign key (entry_high_id) references entries(id) on delete cascade,
          check (entry_low_id < entry_high_id)
        );
      `)
      this.setUserVersion(CURRENT_SCHEMA_VERSION)
      this.db.exec('commit')
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }

  private ensureLatestSupportTables(): void {
    if (!this.hasTable('entry_views') || !this.hasTable('search_events') || !this.hasTable('entry_links')) {
      this.createLatestSchema()
    }
  }

  private migrateLegacySchema(): void {
    this.db.exec('begin immediate')
    try {
      if (!this.hasColumn('entries', 'added_via')) {
        this.db.exec("alter table entries add column added_via text not null default 'interactive'")
      }
      if (!this.hasColumn('entries', 'view_count')) {
        this.db.exec('alter table entries add column view_count integer not null default 0')
      }
      if (!this.hasColumn('entries', 'last_viewed_at')) {
        this.db.exec('alter table entries add column last_viewed_at text')
      }

      this.db.exec(`
        create table if not exists entry_views (
          id integer primary key autoincrement,
          entry_id integer not null,
          viewed_at text not null default current_timestamp,
          command text not null,
          foreign key (entry_id) references entries(id) on delete cascade
        );

        create table if not exists search_events (
          id integer primary key autoincrement,
          query text not null,
          searched_at text not null default current_timestamp,
          result_count integer not null,
          command text not null
        );

        create table if not exists entry_links (
          entry_low_id integer not null,
          entry_high_id integer not null,
          created_at text not null default current_timestamp,
          primary key (entry_low_id, entry_high_id),
          foreign key (entry_low_id) references entries(id) on delete cascade,
          foreign key (entry_high_id) references entries(id) on delete cascade,
          check (entry_low_id < entry_high_id)
        );
      `)

      this.setUserVersion(CURRENT_SCHEMA_VERSION)
      this.db.exec('commit')
    } catch (error) {
      this.db.exec('rollback')
      throw error
    }
  }
}

export function normalizeTags(tags: string[]): string[] {
  return uniqTags(tags)
}
