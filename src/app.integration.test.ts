import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
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
})
