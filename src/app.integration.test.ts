import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { runCli } from './app.ts'
import { makePaths } from './paths.ts'

function makeOut() {
  const logs: string[] = []
  const errors: string[] = []
  return {
    out: {
      log: (value = '') => logs.push(String(value)),
      error: (value = '') => errors.push(String(value)),
    },
    logs,
    errors,
  }
}

function makePathsForTest() {
  return makePaths(mkdtempSync(join(tmpdir(), 'kb-runcli-test-')))
}

describe('runCli integration', () => {
  it('supports add/list/get/search/edit/remove against injected paths', async () => {
    const paths = makePathsForTest()
    const day = new Date('2026-03-18T12:00:00Z')

    let result = makeOut()
    expect(await runCli([], {
      paths,
      now: () => day,
      out: result.out,
      promptNewEntry: async () => ({
        question: 'How do backups work?',
        tags: ['sqlite', 'safety'],
        answer: 'They run daily.',
      }),
    })).toBe(0)
    expect(result.logs.join('\n')).toContain('Saved #1')

    result = makeOut()
    expect(await runCli(['list'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('How do backups work?')

    result = makeOut()
    expect(await runCli(['get', '#1'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('They run daily.')
    expect(result.logs.join('\n')).toContain('Added via: interactive')
    expect(result.logs.join('\n')).toContain('Views: 1')

    let db = new DatabaseSync(paths.dbPath)
    try {
      expect((db.prepare('select count(*) as count from entry_views').get() as { count: number }).count).toBe(1)
    } finally {
      db.close()
    }

    result = makeOut()
    expect(await runCli(['search', 'daily'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('How do backups work?')

    result = makeOut()
    expect(await runCli(['edit', '#1'], {
      paths,
      now: () => day,
      out: result.out,
      editEntryInEditor: () => ({
        question: 'How do backups work now?',
        tags: ['sqlite'],
        answer: 'They still run daily.',
      }),
    })).toBe(0)
    expect(result.logs.join('\n')).toContain('Updated #1')

    result = makeOut()
    expect(await runCli(['search', 'still'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('How do backups work now?')

    result = makeOut()
    expect(await runCli(['remove', '#1'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('Removed #1')

    result = makeOut()
    expect(await runCli(['list'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('No entries found')

    expect(existsSync(paths.dbPath)).toBe(true)
    expect(existsSync(paths.searchPath)).toBe(true)
    expect(existsSync(join(paths.backupDir, 'kb-2026-03-18.sqlite'))).toBe(true)

    db = new DatabaseSync(paths.dbPath)
    try {
      expect((db.prepare('select count(*) as count from entry_views').get() as { count: number }).count).toBe(0)
      expect((db.prepare('select count(*) as count from search_events').get() as { count: number }).count).toBe(2)
    } finally {
      db.close()
    }
  })

  it('keeps bad args from touching injected storage', async () => {
    const paths = makePathsForTest()
    const missing = makePaths(join(paths.rootDir, 'unused'))
    const result = makeOut()

    expect(await runCli(['wat'], { paths: missing, now: () => new Date('2026-03-18T12:00:00Z'), out: result.out })).toBe(1)
    expect(existsSync(missing.dataDir)).toBe(false)
  })

  it('writes a search index document file', async () => {
    const paths = makePathsForTest()

    await runCli([], {
      paths,
      now: () => new Date('2026-03-18T12:00:00Z'),
      out: makeOut().out,
      promptNewEntry: async () => ({
        question: 'Index me',
        tags: ['search'],
        answer: 'Please.',
      }),
    })

    expect(JSON.parse(readFileSync(paths.searchPath, 'utf8'))).toMatchObject({
      version: 1,
    })
  })

  it('supports scripted add from stdin with derived question and detected tags', async () => {
    const paths = makePathsForTest()
    const day = new Date('2026-03-18T12:00:00Z')

    await runCli([], {
      paths,
      now: () => day,
      out: makeOut().out,
      promptNewEntry: async () => ({
        question: 'Seed',
        tags: ['sqlite', 'full-text-search'],
        answer: 'Seed tags.',
      }),
    })

    const result = makeOut()
    expect(await runCli(['add', '--stdin', '--tag', 'cli'], {
      paths,
      now: () => day,
      out: result.out,
      readStdin: async () => '# SQLite FTS\n\nUse Full Text Search for docs.',
    })).toBe(0)

    expect(result.logs.join('\n')).toContain('Saved #2')

    result.logs.length = 0
    expect(await runCli(['get', '#2'], { paths, now: () => day, out: result.out })).toBe(0)
    const output = result.logs.join('\n')
    expect(output).toContain('SQLite FTS')
    expect(output).toContain('cli')
    expect(output).toContain('sqlite')
    expect(output).toContain('full-text-search')
  })

  it('supports scripted add from clipboard', async () => {
    const paths = makePathsForTest()
    const result = makeOut()

    expect(await runCli(['add', '--from-clipboard'], {
      paths,
      now: () => new Date('2026-03-18T12:00:00Z'),
      out: result.out,
      readClipboard: () => '<h1>Chrome note</h1><p>Use context menus.</p>',
    })).toBe(0)

    expect(result.logs.join('\n')).toContain('Saved #1')
  })

  it('shows linked notes from either side', async () => {
    const paths = makePathsForTest()
    const day = new Date('2026-03-18T12:00:00Z')

    await runCli(['add', '--answer', 'First note'], {
      paths,
      now: () => day,
      out: makeOut().out,
    })

    await runCli(['add', '--answer', 'Second note'], {
      paths,
      now: () => day,
      out: makeOut().out,
    })

    const linkResult = makeOut()
    expect(await runCli(['link', '1', '2'], { paths, now: () => day, out: linkResult.out })).toBe(0)
    expect(linkResult.logs.join('\n')).toContain('Linked #1 and #2')

    let result = makeOut()
    expect(await runCli(['get', '#1'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('Linked notes:')
    expect(result.logs.join('\n')).toContain('#2')
    expect(result.logs.join('\n')).toContain('Second note')

    result = makeOut()
    expect(await runCli(['get', '#2'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('#1')
    expect(result.logs.join('\n')).toContain('First note')
  })

  it('creates a separate backup before migrating legacy schema', async () => {
    const paths = makePathsForTest()
    const day = new Date('2026-03-18T12:00:00Z')
    mkdirSync(paths.dataDir, { recursive: true })
    const legacy = new DatabaseSync(paths.dbPath)
    try {
      legacy.exec(`
        create table entries (
          id integer primary key autoincrement,
          question text not null,
          answer text not null,
          created_at text not null default current_timestamp,
          updated_at text not null default current_timestamp
        );
        create table tags (
          id integer primary key autoincrement,
          name text not null unique
        );
        create table entry_tags (
          entry_id integer not null,
          tag_id integer not null,
          primary key (entry_id, tag_id),
          foreign key (entry_id) references entries(id) on delete cascade,
          foreign key (tag_id) references tags(id) on delete cascade
        );
        insert into entries (question, answer, created_at, updated_at)
        values ('Legacy note', 'Still here.', current_timestamp, current_timestamp);
      `)
    } finally {
      legacy.close()
    }

    const result = makeOut()
    expect(await runCli(['get', '#1'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('Legacy note')
    expect(result.logs.join('\n')).toContain('Added via: interactive')
    expect(result.logs.join('\n')).toContain('Views: 1')

    const backupFiles = readdirSync(paths.backupDir).sort()
    expect(backupFiles).toContain('kb-2026-03-18.sqlite')
    expect(backupFiles.some((file) => /^kb-pre-migration-2026-03-18T\d{2}-\d{2}-\d{2}\.sqlite$/.test(file))).toBe(true)

    const migrated = new DatabaseSync(paths.dbPath)
    try {
      expect((migrated.prepare('select user_version from pragma_user_version').get() as { user_version: number }).user_version).toBe(1)
      expect((migrated.prepare('select added_via as addedVia, view_count as viewCount from entries where id = 1').get() as { addedVia: string; viewCount: number })).toEqual({
        addedVia: 'interactive',
        viewCount: 1,
      })
      expect((migrated.prepare('select count(*) as count from entry_views').get() as { count: number }).count).toBe(1)
    } finally {
      migrated.close()
    }
  })

  it('lists and adds standalone tags', async () => {
    const paths = makePathsForTest()
    const day = new Date('2026-03-18T12:00:00Z')

    let result = makeOut()
    expect(await runCli(['tags'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('No tags found')

    result = makeOut()
    expect(await runCli(['tags', 'add', 'Full Text Search'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('Saved tag full-text-search')

    result = makeOut()
    expect(await runCli(['tags', 'add', 'Full Text Search'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs.join('\n')).toContain('Saved tag full-text-search')

    result = makeOut()
    expect(await runCli(['tags'], { paths, now: () => day, out: result.out })).toBe(0)
    expect(result.logs).toContain('full-text-search')
    expect(result.logs.filter((line) => line === 'full-text-search')).toHaveLength(1)
  })

  it('supports code-reference add from file and line range', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-code-ref-test-'))
    const paths = makePaths(root)
    writeFileSync(join(root, 'example.ts'), [
      'const nope = 0',
      '// Why normalize tags?',
      'const value = normalize(input)',
    ].join('\n'))

    const result = makeOut()
    expect(await runCli(['add', '--file=example.ts', '--line-start=2', '--line-end=3', '--format=code-reference'], {
      paths,
      now: () => new Date('2026-03-18T12:00:00Z'),
      out: result.out,
      cwd: root,
    })).toBe(0)

    result.logs.length = 0
    expect(await runCli(['get', '#1'], { paths, now: () => new Date('2026-03-18T12:00:00Z'), out: result.out, cwd: root })).toBe(0)
    const output = result.logs.join('\n')
    expect(output).toContain('Why normalize tags?')
    expect(output).toContain('File: `example.ts:2-3`')
    expect(output).toContain('Project: `kb-code-ref-test-')
    expect(output).toContain('```ts')
  })

  it('supports markdown code-reference add without a leading comment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-code-ref-md-test-'))
    const paths = makePaths(root)
    writeFileSync(join(root, 'note.md'), [
      '# SQLite FTS',
      '',
      'Use `unicode61` tokenizer.',
    ].join('\n'))

    const result = makeOut()
    expect(await runCli(['add', '--file=note.md', '--line-start=1', '--line-end=3', '--format=code-reference'], {
      paths,
      now: () => new Date('2026-03-18T12:00:00Z'),
      out: result.out,
      cwd: root,
    })).toBe(0)

    result.logs.length = 0
    expect(await runCli(['get', '#1'], { paths, now: () => new Date('2026-03-18T12:00:00Z'), out: result.out, cwd: root })).toBe(0)
    const output = result.logs.join('\n')
    expect(output).toContain('SQLite FTS')
    expect(output).toContain('File: `note.md:1-3`')
    expect(output).toContain('```md')
  })
})
