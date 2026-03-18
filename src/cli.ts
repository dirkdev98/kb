#!/usr/bin/env -S node --experimental-strip-types

import process from 'node:process'
import { styleText } from 'node:util'
import { KBDatabase } from './db.ts'
import { KBSearch } from './search.ts'
import { editEntryInEditor, promptNewEntry } from './prompt.ts'

type Command = 'add' | 'list' | 'get' | 'edit' | 'search' | 'remove'
type ParsedCommand = { command: Command; arg: string | undefined; tag: string | undefined }

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

function usage(exitCode = 1): never {
  const out = exitCode === 0 ? console.log : console.error
  out(paint.label('Usage'))
  out(`  ${paint.cmd('kb')}                         add a new entry`)
  out(`  ${paint.cmd('kb list')} ${paint.arg('[--tag=tag]')}       list entries`)
  out(`  ${paint.cmd('kb get')} ${paint.arg('#id')}               show one entry`)
  out(`  ${paint.cmd('kb edit')} ${paint.arg('#id')}              edit one entry`)
  out(`  ${paint.cmd('kb remove')} ${paint.arg('#id')}            remove one entry`)
  out(`  ${paint.cmd('kb search')} ${paint.arg('"query"')}       search entries`)
  out('')
  out(paint.label('Examples'))
  out(`  ${paint.cmd('kb')}`)
  out(`  ${paint.cmd('kb list')} ${paint.arg('--tag=sqlite')}`)
  out(`  ${paint.cmd('kb get')} ${paint.arg('#12')}`)
  out(`  ${paint.cmd('kb search')} ${paint.arg('"fts tokenizer"')}`)
  process.exit(exitCode)
}

function parseId(raw: string | undefined): number {
  if (!raw) usage()
  const cleaned = raw.replace(/^#/, '')
  const id = Number(cleaned)
  if (!Number.isInteger(id) || id <= 0) usage()
  return id
}

function parseCommand(argv: string[]): ParsedCommand {
  if (argv.length === 0) return { command: 'add', arg: undefined, tag: undefined }
  const [first, ...rest] = argv

  if (first === 'help' || first === '--help' || first === '-h') usage(0)

  if (first === 'list') {
    let tag: string | undefined
    for (let index = 0; index < rest.length; index += 1) {
      const part = rest[index]
      if (!part) usage()
      if (part === '--tag') {
        tag = rest[index + 1]?.replace(/^=/, '')
        index += 1
        continue
      }
      if (part.startsWith('--tag=')) {
        tag = part.slice('--tag='.length).replace(/^=/, '')
        continue
      }
      usage()
    }
    return { command: 'list', arg: undefined, tag }
  }

  if (first === 'get') return { command: 'get', arg: rest[0], tag: undefined }
  if (first === 'edit') return { command: 'edit', arg: rest[0], tag: undefined }
  if (first === 'remove') return { command: 'remove', arg: rest[0], tag: undefined }
  if (first === 'search') return { command: 'search', arg: rest.join(' ').trim(), tag: undefined }
  usage()
}

function printEntry(entry: { id: number; question: string; tags: string[]; updatedAt: string }): void {
  const meta = [paint.id(`#${entry.id}`), paint.date(entry.updatedAt)]
  if (entry.tags.length > 0) {
    meta.push(...entry.tags.map((tag) => paint.tag(tag)))
  }
  console.log(meta.join(' '))
  console.log(`  ${paint.question(entry.question)}`)
}

function printFullEntry(entry: {
  id: number
  question: string
  answer: string
  tags: string[]
  createdAt: string
  updatedAt: string
}): void {
  printEntry(entry)
  console.log(`  ${paint.label('Created:')} ${paint.date(entry.createdAt)}`)
  console.log(`  ${paint.label('Updated:')} ${paint.date(entry.updatedAt)}`)
  console.log('')
  console.log(entry.answer)
}

function excerpt(text: string, limit = 140): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}...`
}

async function main(): Promise<void> {
  const db = new KBDatabase()
  const search = new KBSearch()

  try {
    const parsed = parseCommand(process.argv.slice(2))
    const entries = db.allEntries()
    await search.ensureSynced(entries)

    if (parsed.command === 'add') {
      const created = db.createEntry(await promptNewEntry(db.listTags()))
      await search.upsert(created)
      console.log(paint.ok(`Saved #${created.id}`))
      return
    }

    if (parsed.command === 'list') {
      const rows = db.listEntries(parsed.tag)
      if (rows.length === 0) {
        console.log(paint.empty('No entries found'))
        return
      }
      for (const row of rows) printEntry(row)
      return
    }

    if (parsed.command === 'get') {
      const id = parseId(parsed.arg)
      const entry = db.getEntry(id)
      if (!entry) throw new Error(`Entry #${id} not found`)
      printFullEntry(entry)
      return
    }

    if (parsed.command === 'edit') {
      const id = parseId(parsed.arg)
      const entry = db.getEntry(id)
      if (!entry) throw new Error(`Entry #${id} not found`)
      const updated = db.updateEntry(id, editEntryInEditor(entry))
      await search.upsert(updated)
      console.log(paint.ok(`Updated #${updated.id}`))
      return
    }

    if (parsed.command === 'remove') {
      const id = parseId(parsed.arg)
      if (!db.removeEntry(id)) throw new Error(`Entry #${id} not found`)
      await search.remove(id)
      console.log(paint.ok(`Removed #${id}`))
      return
    }

    if (parsed.command === 'search') {
      const term = parsed.arg?.trim()
      if (!term) usage()
      const ids = await search.searchIds(term)
      const rows = ids.map((id) => db.getEntry(id)).filter((row) => row !== null)
      if (rows.length === 0) {
        console.log(paint.empty('No matches found'))
        return
      }
      for (const row of rows) {
        printEntry(row)
        console.log(`  ${paint.answer(excerpt(row.answer))}`)
      }
      return
    }
  } finally {
    db.close()
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
