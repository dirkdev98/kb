import { mkdirSync } from 'node:fs'
import { styleText } from 'node:util'
import { KBDatabase } from './db.ts'
import { KBSearch } from './search.ts'
import { editEntryInEditor, promptNewEntry } from './prompt.ts'
import type { StoragePaths } from './paths.ts'
import { maybeRunDailyBackup } from './backup.ts'

type Command = 'add' | 'list' | 'get' | 'edit' | 'search' | 'remove'
type ParsedCommand = { command: Command; arg: string | undefined; tag: string | undefined }

export type AppDeps = {
  paths: StoragePaths
  now: () => Date
  out?: Pick<typeof console, 'log' | 'error'>
  promptNewEntry?: typeof promptNewEntry
  editEntryInEditor?: typeof editEntryInEditor
}

export class CliExit extends Error {
  readonly exitCode: number

  constructor(exitCode: number) {
    super(`CLI exited with code ${exitCode}`)
    this.exitCode = exitCode
  }
}

const paint = {
  id: (value: string): string => styleText(['bold', 'cyan'], value),
  date: (value: string): string => styleText('dim', value),
  tag: (value: string): string => styleText(['black', 'bgYellow'], ` ${value} `),
  question: (value: string): string => styleText('bold', value),
  answer: (value: string): string => styleText('gray', value),
  label: (value: string): string => styleText(['bold', 'blue'], value),
  empty: (value: string): string => styleText('yellow', value),
  ok: (value: string): string => styleText('green', value),
  cmd: (value: string): string => styleText(['bold', 'cyan'], value),
  arg: (value: string): string => styleText('dim', value),
}

export function usage(out: Pick<typeof console, 'log' | 'error'>, exitCode = 1): never {
  const write = exitCode === 0 ? out.log : out.error
  write(paint.label('Usage'))
  write(`  ${paint.cmd('kb')}                         add a new entry`)
  write(`  ${paint.cmd('kb list')} ${paint.arg('[--tag=tag]')}       list entries`)
  write(`  ${paint.cmd('kb get')} ${paint.arg('#id')}               show one entry`)
  write(`  ${paint.cmd('kb edit')} ${paint.arg('#id')}              edit one entry`)
  write(`  ${paint.cmd('kb remove')} ${paint.arg('#id')}            remove one entry`)
  write(`  ${paint.cmd('kb search')} ${paint.arg('"query"')}       search entries`)
  write('')
  write(paint.label('Examples'))
  write(`  ${paint.cmd('kb')}`)
  write(`  ${paint.cmd('kb list')} ${paint.arg('--tag=sqlite')}`)
  write(`  ${paint.cmd('kb get')} ${paint.arg('#12')}`)
  write(`  ${paint.cmd('kb search')} ${paint.arg('"fts tokenizer"')}`)
  throw new CliExit(exitCode)
}

export function parseId(raw: string | undefined, out: Pick<typeof console, 'log' | 'error'>): number {
  if (!raw) usage(out)
  const cleaned = raw.replace(/^#/, '')
  const id = Number(cleaned)
  if (!Number.isInteger(id) || id <= 0) usage(out)
  return id
}

export function parseCommand(argv: string[], out: Pick<typeof console, 'log' | 'error'>): ParsedCommand {
  if (argv.length === 0) return { command: 'add', arg: undefined, tag: undefined }
  const [first, ...rest] = argv

  if (first === 'help' || first === '--help' || first === '-h') usage(out, 0)

  if (first === 'list') {
    let tag: string | undefined
    for (let index = 0; index < rest.length; index += 1) {
      const part = rest[index]
      if (!part) usage(out)
      if (part === '--tag') {
        tag = rest[index + 1]?.replace(/^=/, '')
        index += 1
        continue
      }
      if (part.startsWith('--tag=')) {
        tag = part.slice('--tag='.length).replace(/^=/, '')
        continue
      }
      usage(out)
    }
    return { command: 'list', arg: undefined, tag }
  }

  if (first === 'get') return { command: 'get', arg: rest[0], tag: undefined }
  if (first === 'edit') return { command: 'edit', arg: rest[0], tag: undefined }
  if (first === 'remove') return { command: 'remove', arg: rest[0], tag: undefined }
  if (first === 'search') return { command: 'search', arg: rest.join(' ').trim(), tag: undefined }
  usage(out)
}

function ensureStorage(paths: StoragePaths): void {
  mkdirSync(paths.dataDir, { recursive: true })
  mkdirSync(paths.backupDir, { recursive: true })
}

function printEntry(out: Pick<typeof console, 'log' | 'error'>, entry: { id: number; question: string; tags: string[]; updatedAt: string }): void {
  const meta = [paint.id(`#${entry.id}`), paint.date(entry.updatedAt)]
  if (entry.tags.length > 0) meta.push(...entry.tags.map((tag) => paint.tag(tag)))
  out.log(meta.join(' '))
  out.log(`  ${paint.question(entry.question)}`)
}

function printFullEntry(out: Pick<typeof console, 'log' | 'error'>, entry: {
  id: number
  question: string
  answer: string
  tags: string[]
  createdAt: string
  updatedAt: string
}): void {
  printEntry(out, entry)
  out.log(`  ${paint.label('Created:')} ${paint.date(entry.createdAt)}`)
  out.log(`  ${paint.label('Updated:')} ${paint.date(entry.updatedAt)}`)
  out.log('')
  out.log(entry.answer)
}

function excerpt(text: string, limit = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}...`
}

export async function runCli(argv: string[], deps: AppDeps): Promise<number> {
  const out = deps.out ?? console
  const promptForNewEntry = deps.promptNewEntry ?? promptNewEntry
  const editInEditor = deps.editEntryInEditor ?? editEntryInEditor
  let parsed: ParsedCommand
  try {
    parsed = parseCommand(argv, out)
  } catch (error) {
    if (error instanceof CliExit) return error.exitCode
    throw error
  }

  ensureStorage(deps.paths)

  const db = new KBDatabase(deps.paths.dbPath)
  try {
    await maybeRunDailyBackup(db.sqlite, deps.paths.backupDir, deps.now())

    const search = new KBSearch(deps.paths.searchPath)
    const entries = db.allEntries()
    await search.ensureSynced(entries)

    if (parsed.command === 'add') {
      const created = db.createEntry(await promptForNewEntry(db.listTags()))
      await search.upsert(created)
      out.log(paint.ok(`Saved #${created.id}`))
      return 0
    }

    if (parsed.command === 'list') {
      const rows = db.listEntries(parsed.tag)
      if (rows.length === 0) {
        out.log(paint.empty('No entries found'))
        return 0
      }
      for (const row of rows) printEntry(out, row)
      return 0
    }

    if (parsed.command === 'get') {
      const id = parseId(parsed.arg, out)
      const entry = db.getEntry(id)
      if (!entry) throw new Error(`Entry #${id} not found`)
      printFullEntry(out, entry)
      return 0
    }

    if (parsed.command === 'edit') {
      const id = parseId(parsed.arg, out)
      const entry = db.getEntry(id)
      if (!entry) throw new Error(`Entry #${id} not found`)
      const updated = db.updateEntry(id, editInEditor(entry))
      await search.upsert(updated)
      out.log(paint.ok(`Updated #${updated.id}`))
      return 0
    }

    if (parsed.command === 'remove') {
      const id = parseId(parsed.arg, out)
      if (!db.removeEntry(id)) throw new Error(`Entry #${id} not found`)
      await search.remove(id)
      out.log(paint.ok(`Removed #${id}`))
      return 0
    }

    const term = parsed.arg?.trim()
    if (!term) usage(out)
    const ids = await search.searchIds(term)
    const rows = ids.map((id) => db.getEntry(id)).filter((row) => row !== null)
    if (rows.length === 0) {
      out.log(paint.empty('No matches found'))
      return 0
    }
    for (const row of rows) {
      printEntry(out, row)
      out.log(`  ${paint.answer(excerpt(row.answer))}`)
    }
    return 0
  } finally {
    db.close()
  }
}
