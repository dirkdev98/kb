import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true })
  return path
}

export function getDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
  return ensureDir(join(base, 'kb'))
}

export function getDbPath(): string {
  const path = join(getDataDir(), 'kb.sqlite')
  ensureDir(dirname(path))
  return path
}

export function getSearchPath(): string {
  const path = join(getDataDir(), 'search-index.json')
  ensureDir(dirname(path))
  return path
}
