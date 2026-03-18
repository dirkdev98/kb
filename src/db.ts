import { DatabaseSync } from 'node:sqlite'

export type EntryRecord = {
  id: number
  question: string
  answer: string
  createdAt: string
  updatedAt: string
  tags: string[]
}

type EntryRow = {
  id: number
  question: string
  answer: string
  created_at: string
  updated_at: string
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
    this.db.exec(`
      create table if not exists entries (
        id integer primary key autoincrement,
        question text not null,
        answer text not null,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
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
    `)
  }

  close(): void {
    this.db.close()
  }

  get sqlite(): DatabaseSync {
    return this.db
  }

  createEntry(input: { question: string; answer: string; tags: string[] }): EntryRecord {
    const tags = uniqTags(input.tags)
    this.db.exec('begin immediate')
    try {
      const entry = this.db
        .prepare(`
          insert into entries (question, answer, created_at, updated_at)
          values (?, ?, current_timestamp, current_timestamp)
          returning id, question, answer, created_at, updated_at
        `)
        .get(input.question.trim(), input.answer.trim()) as EntryRow

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
      .prepare('select id, question, answer, created_at, updated_at from entries where id = ?')
      .get(id) as EntryRow | undefined
    if (!row) return null
    return this.mapEntry(row)
  }

  listEntries(tag?: string): EntryRecord[] {
    const rows = tag
      ? (this.db
          .prepare(`
            select e.id, e.question, e.answer, e.created_at, e.updated_at
            from entries e
            join entry_tags et on et.entry_id = e.id
            join tags t on t.id = et.tag_id
            where t.name = ?
            order by e.updated_at desc, e.id desc
          `)
          .all(slugTag(tag)) as EntryRow[])
      : (this.db
          .prepare(`
            select id, question, answer, created_at, updated_at
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

  allEntries(): EntryRecord[] {
    const rows = this.db
      .prepare('select id, question, answer, created_at, updated_at from entries order by id asc')
      .all() as EntryRow[]
    return rows.map((row) => this.mapEntry(row))
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
      tags: tags.map((tag) => tag.name),
    }
  }
}

export function normalizeTags(tags: string[]): string[] {
  return uniqTags(tags)
}
