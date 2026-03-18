import { existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCommand, parseId, runCli } from './app.ts'
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

function makeMissingRoot(): string {
  const base = mkdtempSync(join(tmpdir(), 'kb-app-test-'))
  return join(base, 'missing-root')
}

describe('app parsing', () => {
  it('parses list tag arguments', () => {
    const { out } = makeOut()
    expect(parseCommand(['list', '--tag=sqlite'], out)).toEqual({ command: 'list', arg: undefined, tag: 'sqlite', add: undefined })
  })

  it('parses scripted add arguments', () => {
    const { out } = makeOut()
    expect(parseCommand(['add', '--stdin', '--tag=sqlite', '--tag', 'fts'], out)).toEqual({
      command: 'add',
      arg: undefined,
      tag: undefined,
      add: {
        question: undefined,
        tags: ['sqlite', 'fts'],
        answer: undefined,
        stdin: true,
        fromClipboard: false,
        format: undefined,
        file: undefined,
        lineStart: undefined,
        lineEnd: undefined,
      },
    })
  })

  it('parses code-reference add arguments', () => {
    const { out } = makeOut()
    expect(parseCommand(['add', '--file=src/app.ts', '--line-start=1', '--line-end=5', '--format=code-reference'], out)).toEqual({
      command: 'add',
      arg: undefined,
      tag: undefined,
      add: {
        question: undefined,
        tags: [],
        answer: undefined,
        stdin: false,
        fromClipboard: false,
        format: 'code-reference',
        file: 'src/app.ts',
        lineStart: 1,
        lineEnd: 5,
      },
    })
  })

  it('parses numeric ids with # prefix', () => {
    const { out } = makeOut()
    expect(parseId('#12', out)).toBe(12)
  })

  it('rejects multiple scripted answer sources', () => {
    const { out } = makeOut()
    expect(() => parseCommand(['add', '--stdin', '--from-clipboard'], out)).toThrow('Use only one answer source')
  })

  it('rejects code-reference with answer source', () => {
    const { out } = makeOut()
    expect(() => parseCommand(['add', '--file=a.ts', '--line-start=1', '--line-end=2', '--format=code-reference', '--stdin'], out))
      .toThrow('code-reference format reads from --file and line range')
  })

  it('rejects explicit tags for code-reference', () => {
    const { out } = makeOut()
    expect(() => parseCommand(['add', '--file=a.ts', '--line-start=1', '--line-end=2', '--format=code-reference', '--tag=ts'], out))
      .toThrow('code-reference format auto-tags')
  })
})

describe('runCli no-touch behavior', () => {
  it('help exits cleanly without creating storage', async () => {
    const { out, logs } = makeOut()
    const root = makeMissingRoot()

    const exitCode = await runCli(['--help'], {
      paths: makePaths(root),
      now: () => new Date('2026-03-18T12:00:00Z'),
      out,
    })

    expect(exitCode).toBe(0)
    expect(logs.join('\n')).toContain('Usage')
    expect(existsSync(join(root, 'kb'))).toBe(false)
  })

  it('invalid command exits without creating storage', async () => {
    const { out, errors } = makeOut()
    const root = makeMissingRoot()

    const exitCode = await runCli(['wat'], {
      paths: makePaths(root),
      now: () => new Date('2026-03-18T12:00:00Z'),
      out,
    })

    expect(exitCode).toBe(1)
    expect(errors.join('\n')).toContain('Usage')
    expect(existsSync(join(root, 'kb'))).toBe(false)
  })

  it('bad list flags exit without creating storage', async () => {
    const { out } = makeOut()
    const root = makeMissingRoot()

    const exitCode = await runCli(['list', '--wat'], {
      paths: makePaths(root),
      now: () => new Date('2026-03-18T12:00:00Z'),
      out,
    })

    expect(exitCode).toBe(1)
    expect(existsSync(join(root, 'kb'))).toBe(false)
  })
})
