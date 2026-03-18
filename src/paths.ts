import { join } from 'node:path'

export type StoragePaths = {
  rootDir: string
  dataDir: string
  dbPath: string
  searchPath: string
  backupDir: string
}

export function makePaths(rootDir: string): StoragePaths {
  const dataDir = join(rootDir, 'kb')
  return {
    rootDir,
    dataDir,
    dbPath: join(dataDir, 'kb.sqlite'),
    searchPath: join(dataDir, 'search-index.json'),
    backupDir: join(dataDir, 'backups'),
  }
}
