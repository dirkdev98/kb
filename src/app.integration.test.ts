import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
