import { describe, expect, it } from 'vitest'
import { makePaths } from './paths.ts'

describe('makePaths', () => {
  it('derives all storage paths from injected root', () => {
    const paths = makePaths('/tmp/kb-root')

    expect(paths).toEqual({
      rootDir: '/tmp/kb-root',
      dataDir: '/tmp/kb-root/kb',
      dbPath: '/tmp/kb-root/kb/kb.sqlite',
      searchPath: '/tmp/kb-root/kb/search-index.json',
      backupDir: '/tmp/kb-root/kb/backups',
    })
  })
})
