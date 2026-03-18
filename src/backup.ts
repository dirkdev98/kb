import { backup } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

const BACKUP_FILE = /^kb-(\d{4}-\d{2}-\d{2})\.sqlite$/
const MIGRATION_BACKUP_FILE = /^kb-pre-migration-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.sqlite$/
const RETAIN_COUNT = 7

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatBackupDay(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatBackupTimestamp(now: Date): string {
  return [
    formatBackupDay(now),
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  ].join('T')
}

export function listBackupFiles(backupDir: string): string[] {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((name) => BACKUP_FILE.test(name))
    .sort()
}

export function listMigrationBackupFiles(backupDir: string): string[] {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((name) => MIGRATION_BACKUP_FILE.test(name))
    .sort()
}

export async function maybeRunDailyBackup(db: DatabaseSync, backupDir: string, now: Date): Promise<void> {
  mkdirSync(backupDir, { recursive: true })

  const day = formatBackupDay(now)
  const target = join(backupDir, `kb-${day}.sqlite`)
  if (existsSync(target)) return

  const temp = join(backupDir, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`)
  try {
    await backup(db, temp)
    renameSync(temp, target)
  } catch (error) {
    rmSync(temp, { force: true })
    if (existsSync(target)) return
    throw error
  }

  const files = listBackupFiles(backupDir)
  const stale = files.slice(0, Math.max(0, files.length - RETAIN_COUNT))
  for (const file of stale) {
    rmSync(join(backupDir, file), { force: true })
  }
}

export async function createMigrationBackup(db: DatabaseSync, backupDir: string, now: Date): Promise<string> {
  mkdirSync(backupDir, { recursive: true })

  const target = join(backupDir, `kb-pre-migration-${formatBackupTimestamp(now)}.sqlite`)
  const temp = join(backupDir, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`)

  try {
    await backup(db, temp)
    renameSync(temp, target)
    return target
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}
