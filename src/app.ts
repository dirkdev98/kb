import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { styleText } from 'node:util'
import { KBDatabase } from './db.ts'
import { KBSearch } from './search.ts'
import { collectProjectMetadata, formatCodeReferenceAnswer, readCodeReference } from './capture.ts'
import { deriveQuestion, detectTagsInText, editEntryInEditor, promptNewEntry, readClipboardText } from './prompt.ts'
import type { StoragePaths } from './paths.ts'
import { maybeRunDailyBackup } from './backup.ts'

type Command = 'add' | 'list' | 'get' | 'edit' | 'search' | 'remove' | 'tags' | 'tags-add'
type AddOptions = {
  question: string | undefined
  tags: string[]
  answer: string | undefined
  stdin: boolean
  fromClipboard: boolean
  format: string | undefined
  file: string | undefined
  lineStart: number | undefined
  lineEnd: number | undefined
}
type ParsedCommand = { command: Command; arg: string | undefined; tag: string | undefined; add: AddOptions | undefined }

export type AppDeps = {
  paths: StoragePaths
  now: () => Date
  out?: Pick<typeof console, 'log' | 'error'>
  promptNewEntry?: typeof promptNewEntry
  editEntryInEditor?: typeof editEntryInEditor
  readClipboard?: typeof readClipboardText
  readStdin?: () => Promise<string>
  cwd?: string
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
  write(`  ${paint.cmd('kb add')} ${paint.arg('--answer="..."')}      add from inline text`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--stdin [--tag=tag]')}  add from standard input`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--from-clipboard')}    add from clipboard`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--file=path --line-start=n --line-end=n --format=code-reference')}`)
  write(`  ${paint.cmd('kb list')} ${paint.arg('[--tag=tag]')}       list entries`)
  write(`  ${paint.cmd('kb tags')}                    list tags`)
  write(`  ${paint.cmd('kb tags add')} ${paint.arg('tag')}          add a tag`)
  write(`  ${paint.cmd('kb get')} ${paint.arg('#id')}               show one entry`)
  write(`  ${paint.cmd('kb edit')} ${paint.arg('#id')}              edit one entry`)
  write(`  ${paint.cmd('kb remove')} ${paint.arg('#id')}            remove one entry`)
  write(`  ${paint.cmd('kb search')} ${paint.arg('"query"')}       search entries`)
  write('')
  write(paint.label('Examples'))
  write(`  ${paint.cmd('kb')}`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--answer="Use unicode61 tokenizer" --tag=sqlite')}`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--stdin --tag=sqlite')}`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--from-clipboard --tag=chrome')}`)
  write(`  ${paint.cmd('kb add')} ${paint.arg('--file=src/app.ts --line-start=1 --line-end=8 --format=code-reference')}`)
  write(`  ${paint.cmd('kb list')} ${paint.arg('--tag=sqlite')}`)
  write(`  ${paint.cmd('kb tags')}`)
  write(`  ${paint.cmd('kb tags add')} ${paint.arg('sqlite')}`)
  write(`  ${paint.cmd('kb get')} ${paint.arg('#12')}`)
  write(`  ${paint.cmd('kb search')} ${paint.arg('"fts tokenizer"')}`)
  throw new CliExit(exitCode)
}

function parseAddArgs(argv: string[], out: Pick<typeof console, 'log' | 'error'>): AddOptions {
  const parsed: AddOptions = {
    question: undefined,
    tags: [],
    answer: undefined,
    stdin: false,
    fromClipboard: false,
    format: undefined,
    file: undefined,
    lineStart: undefined,
    lineEnd: undefined,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index]
    if (!part) usage(out)

    if (part === '--stdin') {
      parsed.stdin = true
      continue
    }

    if (part === '--from-clipboard') {
      parsed.fromClipboard = true
      continue
    }

    if (part === '--question' || part === '--tag' || part === '--answer' || part === '--format' || part === '--file' || part === '--line-start' || part === '--line-end') {
      const value = argv[index + 1]
      if (!value) usage(out)
      if (part === '--question') parsed.question = value
      if (part === '--tag') parsed.tags.push(value)
      if (part === '--answer') parsed.answer = value
      if (part === '--format') parsed.format = value
      if (part === '--file') parsed.file = value
      if (part === '--line-start') parsed.lineStart = Number(value)
      if (part === '--line-end') parsed.lineEnd = Number(value)
      index += 1
      continue
    }

    if (part.startsWith('--question=')) {
      parsed.question = part.slice('--question='.length)
      continue
    }

    if (part.startsWith('--tag=')) {
      parsed.tags.push(part.slice('--tag='.length))
      continue
    }

    if (part.startsWith('--answer=')) {
      parsed.answer = part.slice('--answer='.length)
      continue
    }

    if (part.startsWith('--format=')) {
      parsed.format = part.slice('--format='.length)
      continue
    }

    if (part.startsWith('--file=')) {
      parsed.file = part.slice('--file='.length)
      continue
    }

    if (part.startsWith('--line-start=')) {
      parsed.lineStart = Number(part.slice('--line-start='.length))
      continue
    }

    if (part.startsWith('--line-end=')) {
      parsed.lineEnd = Number(part.slice('--line-end='.length))
      continue
    }

    usage(out)
  }

  const sources = Number(Boolean(parsed.answer)) + Number(parsed.stdin) + Number(parsed.fromClipboard)
  if (parsed.format && parsed.format !== 'code-reference') throw new Error(`Unsupported add format: ${parsed.format}`)
  if (parsed.format === 'code-reference') {
    if (!parsed.file) throw new Error('code-reference format requires --file')
    if (parsed.lineStart === undefined) throw new Error('code-reference format requires --line-start')
    if (parsed.lineEnd === undefined) throw new Error('code-reference format requires --line-end')
    if (sources > 0) throw new Error('code-reference format reads from --file and line range, not --answer, --stdin, or --from-clipboard')
    if (parsed.question) throw new Error('code-reference format derives the question from the selected leading comment')
    if (parsed.tags.length > 0) throw new Error('code-reference format auto-tags with the current project name only')
  }
  if (sources > 1) throw new Error('Use only one answer source: --answer, --stdin, or --from-clipboard')
  return parsed
}

function hasAddFlags(add: AddOptions | undefined): boolean {
  return Boolean(add && (add.question || add.answer || add.stdin || add.fromClipboard || add.tags.length > 0 || add.format || add.file || add.lineStart !== undefined || add.lineEnd !== undefined))
}

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  return Buffer.concat(chunks).toString('utf8')
}

export function parseId(raw: string | undefined, out: Pick<typeof console, 'log' | 'error'>): number {
  if (!raw) usage(out)
  const cleaned = raw.replace(/^#/, '')
  const id = Number(cleaned)
  if (!Number.isInteger(id) || id <= 0) usage(out)
  return id
}

export function parseCommand(argv: string[], out: Pick<typeof console, 'log' | 'error'>): ParsedCommand {
  if (argv.length === 0) return { command: 'add', arg: undefined, tag: undefined, add: undefined }
  const [first, ...rest] = argv

  if (first === 'help' || first === '--help' || first === '-h') usage(out, 0)
  if (first === 'add') return { command: 'add', arg: undefined, tag: undefined, add: parseAddArgs(rest, out) }

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
    return { command: 'list', arg: undefined, tag, add: undefined }
  }

  if (first === 'tags') {
    if (rest.length === 0) return { command: 'tags', arg: undefined, tag: undefined, add: undefined }
    if (rest[0] === 'add' && rest.length === 2) return { command: 'tags-add', arg: rest[1], tag: undefined, add: undefined }
    usage(out)
  }

  if (first === 'get') return { command: 'get', arg: rest[0], tag: undefined, add: undefined }
  if (first === 'edit') return { command: 'edit', arg: rest[0], tag: undefined, add: undefined }
  if (first === 'remove') return { command: 'remove', arg: rest[0], tag: undefined, add: undefined }
  if (first === 'search') return { command: 'search', arg: rest.join(' ').trim(), tag: undefined, add: undefined }
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
  const readClipboard = deps.readClipboard ?? readClipboardText
  const readStdin = deps.readStdin ?? readStdinText
  const cwd = deps.cwd ?? process.cwd()
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
      const existingTags = db.listTags()
      let entry

      if (!hasAddFlags(parsed.add)) {
        entry = await promptForNewEntry(existingTags)
      } else if (parsed.add?.format === 'code-reference') {
        const reference = readCodeReference({
          cwd,
          file: parsed.add.file!,
          lineStart: parsed.add.lineStart!,
          lineEnd: parsed.add.lineEnd!,
        })
        const metadata = collectProjectMetadata({
          cwd,
          file: parsed.add.file!,
          lineStart: parsed.add.lineStart!,
          lineEnd: parsed.add.lineEnd!,
          absoluteFile: reference.absoluteFile,
        })
        entry = {
          question: parsed.add.question?.trim() || reference.question,
          answer: formatCodeReferenceAnswer({
            snippet: reference.snippet,
            language: reference.language,
            metadata,
            lineStart: parsed.add.lineStart!,
            lineEnd: parsed.add.lineEnd!,
          }),
          tags: metadata.projectName ? [metadata.projectName] : [],
        }
      } else {
        let answer = parsed.add?.answer
        if (!answer && parsed.add?.stdin) answer = await readStdin()
        if (!answer && parsed.add?.fromClipboard) answer = readClipboard()
        if (!answer?.trim()) throw new Error('Answer required when using kb add flags')

        const question = parsed.add?.question?.trim() || deriveQuestion(answer)
        const tags = detectTagsInText(`${question}\n\n${answer}`, existingTags)
        entry = {
          question,
          answer: answer.trim(),
          tags: [...new Set([...(parsed.add?.tags ?? []), ...tags])],
        }
      }

      const created = db.createEntry(entry)
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

    if (parsed.command === 'tags') {
      const tags = db.listTags()
      if (tags.length === 0) {
        out.log(paint.empty('No tags found'))
        return 0
      }
      for (const tag of tags) out.log(tag)
      return 0
    }

    if (parsed.command === 'tags-add') {
      const tag = db.createTag(parsed.arg ?? '')
      out.log(paint.ok(`Saved tag ${tag}`))
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
