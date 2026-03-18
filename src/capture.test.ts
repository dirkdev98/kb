import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectProjectMetadata, extractCommentQuestion, formatCodeReferenceAnswer, readCodeReference } from './capture.ts'

describe('code reference helpers', () => {
  it('extracts question from leading slash comments', () => {
    expect(extractCommentQuestion('// Why normalize tags?\nconst x = 1')).toBe('Why normalize tags?')
  })

  it('extracts question from block comments', () => {
    expect(extractCommentQuestion('/** Why normalize tags?\n * Keep lookups stable.\n */\nconst x = 1')).toBe('Why normalize tags?')
  })

  it('extracts question from partial jsdoc lines', () => {
    expect(extractCommentQuestion('* Why normalize tags?\n* Keep lookups stable.\nconst x = 1')).toBe('Why normalize tags?')
  })

  it('rejects snippets without a leading comment', () => {
    expect(() => extractCommentQuestion('const x = 1')).toThrow('Selected code must start with a comment')
  })

  it('reads file snippets by line range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-capture-test-'))
    const file = join(dir, 'note.ts')
    writeFileSync(file, ['const nope = 0', '// Why normalize tags?', 'const x = 1'].join('\n'))

    expect(readCodeReference({ cwd: dir, file: 'note.ts', lineStart: 2, lineEnd: 3 })).toMatchObject({
      snippet: '// Why normalize tags?\nconst x = 1',
      language: 'ts',
      question: 'Why normalize tags?',
    })
  })

  it('uses normal question derivation for markdown files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-capture-test-'))
    const file = join(dir, 'note.md')
    writeFileSync(file, ['# SQLite FTS', '', 'Use `unicode61` tokenizer.'].join('\n'))

    expect(readCodeReference({ cwd: dir, file: 'note.md', lineStart: 1, lineEnd: 3 })).toMatchObject({
      language: 'md',
      question: 'SQLite FTS',
    })
  })

  it('formats code reference answers', () => {
    expect(formatCodeReferenceAnswer({
      snippet: '// Why normalize tags?\nconst x = 1',
      language: 'ts',
      lineStart: 2,
      lineEnd: 3,
      metadata: {
        displayFile: 'src/app.ts',
        projectName: 'kb',
        branch: 'main',
        commit: '1234567890',
        githubUrl: 'https://github.com/acme/kb/blob/123/src/app.ts#L2-L3',
      },
    })).toContain('```ts')
  })

  it('collects github metadata best effort', () => {
    const metadata = collectProjectMetadata({
      cwd: '/tmp/project',
      file: 'src/app.ts',
      lineStart: 2,
      lineEnd: 3,
      absoluteFile: '/tmp/project/src/app.ts',
    }, (args) => {
      const key = args.join(' ')
      if (key === 'rev-parse --show-toplevel') return '/tmp/project'
      if (key === 'rev-parse HEAD') return '1234567890abcdef'
      if (key === 'rev-parse --abbrev-ref HEAD') return 'main'
      if (key === 'remote get-url origin') return 'git@github.com:acme/kb.git'
      return undefined
    })

    expect(metadata).toEqual({
      displayFile: 'src/app.ts',
      projectName: 'project',
      branch: 'main',
      commit: '1234567890abcdef',
      githubUrl: 'https://github.com/acme/kb/blob/1234567890abcdef/src/app.ts#L2-L3',
    })
  })
})
