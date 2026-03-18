import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import enquirer from 'enquirer'
import { normalizeTags } from './db.ts'

export type PromptEntry = {
  question: string
  tags: string[]
  answer: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decodeHtmlEntities(value: string): string {
  const named = value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")

  return named
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

export function stripRichText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(#{1,6})\s+/gm, '')
    .replace(/^\s{0,3}([-+*]|\d+\.)\s+/gm, '')
    .replace(/^\s{0,3}([-_*]\s*){3,}$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function deriveQuestion(value: string): string {
  const lines = stripRichText(value).split('\n').map((line) => line.trim()).filter(Boolean)
  const first = lines[0] ?? ''
  if (!first) throw new Error('Question required')

  const sentence = first.match(/^(.+?[.!?])(?=\s|$)/)?.[1] ?? first
  const clean = sentence.replace(/\s+/g, ' ').trim()
  if (clean.length <= 120) return clean
  return `${clean.slice(0, 119).trimEnd()}...`
}

export function detectTagsInText(value: string, existingTags: string[]): string[] {
  const text = stripRichText(value).toLowerCase()
  return normalizeTags(existingTags.filter((tag) => {
    const parts = tag.toLowerCase().split(/[-_]+/).filter(Boolean).map(escapeRegex)
    if (parts.length === 0) return false
    const pattern = `(^|[^a-z0-9])${parts.join('[-_\\s]+')}(?=$|[^a-z0-9])`
    return new RegExp(pattern, 'i').test(text)
  }))
}

export function readClipboardText(): string {
  const result = spawnSync('pbpaste', [], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`pbpaste exited with code ${result.status}`)
  }
  return result.stdout
}

function parseTags(value: string): string[] {
  return normalizeTags(value.split(',').map((part) => part.trim()))
}

async function promptQuestion(): Promise<string> {
  const answer = await enquirer.prompt<{ question: string }>({
    type: 'input',
    name: 'question',
    message: 'Question',
    validate(value: string) {
      return value.trim() ? true : 'Question required'
    },
  })
  return answer.question.trim()
}

async function promptAnswer(): Promise<string> {
  console.log('Answer: blank line twice to finish. Type /editor on first line for editor.')
  const lines: string[] = []
  let blankCount = 0

  while (true) {
    const answer = await enquirer.prompt<{ line: string }>({
      type: 'input',
      name: 'line',
      message: lines.length === 0 ? '>' : '...',
    })
    const line = answer.line

    if (lines.length === 0 && line.trim() === '/editor') {
      return openEditor('').trim()
    }

    if (line.trim() === '') {
      blankCount += 1
      if (blankCount >= 2) break
    } else {
      blankCount = 0
    }

    lines.push(line)
  }

  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop()
  const answer = lines.join('\n').trim()
  if (!answer) throw new Error('Answer required')
  return answer
}

async function promptTags(existingTags: string[]): Promise<string[]> {
  const selected = new Set<string>()

  while (true) {
    const picked = await enquirer.prompt<{ tag: string }>({
      type: 'autocomplete',
      name: 'tag',
      message: selected.size === 0 ? 'Add tag' : `Add tag (${[...selected].join(', ')})`,
      choices: [...existingTags.filter((tag) => !selected.has(tag)), '[new tag]', '[done]'],
    })

    if (picked.tag === '[done]') break

    if (picked.tag === '[new tag]') {
      const custom = await enquirer.prompt<{ tag: string }>({
        type: 'input',
        name: 'tag',
        message: 'New tag',
      })
      for (const tag of parseTags(custom.tag)) selected.add(tag)
      continue
    }

    selected.add(picked.tag)
  }

  return [...selected].sort()
}

function openEditor(initial: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'kb-'))
  const file = join(dir, 'entry.md')
  writeFileSync(file, initial)

  const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
  const result = runEditor(editor, file)
  if (result.error) throw result.error
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`${editor} exited with code ${result.status}`)
  }

  const text = readFileSync(file, 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return text
}

export function splitEditorCommand(editor: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null
  let escaped = false

  for (const char of editor) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (quote === 'single') {
      if (char === "'") quote = null
      else current += char
      continue
    }

    if (quote === 'double') {
      if (char === '"') quote = null
      else if (char === '\\') escaped = true
      else current += char
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === "'") {
      quote = 'single'
      continue
    }

    if (char === '"') {
      quote = 'double'
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (escaped) current += '\\'
  if (current) parts.push(current)
  return parts
}

export function buildEditorInvocation(editor: string, file: string) {
  const [command = editor, ...args] = splitEditorCommand(editor)
  const name = basename(command).toLowerCase()
  const needsWait = (name === 'webstorm' || name === 'webstorm1') && !args.includes('--wait')

  return {
    command,
    name,
    args: [...args, ...(needsWait ? ['--wait'] : []), file],
  }
}

function runEditor(editor: string, file: string) {
  const invocation = buildEditorInvocation(editor, file)
  const direct = spawnSync(invocation.command, invocation.args, { stdio: 'inherit' })
  const error = direct.error as NodeJS.ErrnoException | undefined
  if (!error || error.code !== 'ENOENT') return direct

  if (invocation.name === 'webstorm' || invocation.name === 'webstorm1') {
    const app = spawnSync('open', ['-W', '-a', 'WebStorm', '--args', ...invocation.args], { stdio: 'inherit' })
    if (app.status === 0 && !app.error) return app
  }

  return spawnSync('sh', ['-lc', `${editor} "$1"`, 'sh', file], { stdio: 'inherit' })
}

export async function promptNewEntry(existingTags: string[]): Promise<PromptEntry> {
  const question = await promptQuestion()
  const tags = await promptTags(existingTags)
  const answer = await promptAnswer()

  if (!answer) throw new Error('Answer required')
  return { question, tags, answer }
}

export function formatEditableEntry(entry: PromptEntry): string {
  return `Question: ${entry.question}\nTags: ${entry.tags.join(', ')}\n\nAnswer:\n${entry.answer.trim()}\n`
}

export function parseEditableEntry(text: string): PromptEntry {
  const match = text.match(/^Question:\s*(.*)\nTags:\s*(.*)\n\nAnswer:\n([\s\S]*)$/)
  if (!match?.[1] || match[2] === undefined || match[3] === undefined) {
    throw new Error('Invalid edit format')
  }

  const [, question, tagsLine, answer] = match
  const tags = parseTags(tagsLine)
  if (!question.trim()) throw new Error('Question required')
  if (!answer.trim()) throw new Error('Answer required')

  return {
    question: question.trim(),
    tags,
    answer: answer.trim(),
  }
}

export function editEntryInEditor(entry: PromptEntry): PromptEntry {
  return parseEditableEntry(openEditor(formatEditableEntry(entry)))
}
