import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { formatBackupDay, listBackupFiles, maybeRunDailyBackup } from './backup.ts'

const openDbs: DatabaseSync[] = []

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'kb-backup-test-'))
}

function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  openDbs.push(db)
  db.exec('create table if not exists entries (id integer primary key, value text); insert into entries(value) values (\'x\')')
  return db
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()?.close()
  }
})

describe('backup helpers', () => {
  it('formats backup days', () => {
    expect(formatBackupDay(new Date('2026-03-18T12:00:00Z'))).toBe('2026-03-18')
  })

  it('creates one backup per day', async () => {
    const dir = makeTempDir()
    const db = openDb(join(dir, 'kb.sqlite'))
    const backupDir = join(dir, 'backups')
    const day = new Date('2026-03-18T12:00:00Z')

    await maybeRunDailyBackup(db, backupDir, day)
    await maybeRunDailyBackup(db, backupDir, day)

    expect(listBackupFiles(backupDir)).toEqual(['kb-2026-03-18.sqlite'])
  })

  it('keeps newest seven matching backups only', async () => {
    const dir = makeTempDir()
    const db = openDb(join(dir, 'kb.sqlite'))
    const backupDir = join(dir, 'backups')

    mkdirSync(backupDir, { recursive: true })
    for (const day of ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15', '2026-03-16']) {
      writeFileSync(join(backupDir, `kb-${day}.sqlite`), '')
    }
    writeFileSync(join(backupDir, 'notes.txt'), 'keep me')

    await maybeRunDailyBackup(db, backupDir, new Date('2026-03-17T12:00:00Z'))

    expect(listBackupFiles(backupDir)).toEqual([
      'kb-2026-03-11.sqlite',
      'kb-2026-03-12.sqlite',
      'kb-2026-03-13.sqlite',
      'kb-2026-03-14.sqlite',
      'kb-2026-03-15.sqlite',
      'kb-2026-03-16.sqlite',
      'kb-2026-03-17.sqlite',
    ])
  })
})
