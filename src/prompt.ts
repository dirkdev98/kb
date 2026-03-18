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

function runEditor(editor: string, file: string) {
  const direct = spawnSync(editor, [file], { stdio: 'inherit' })
  const error = direct.error as NodeJS.ErrnoException | undefined
  if (!error || error.code !== 'ENOENT') return direct

  const name = basename(editor).toLowerCase()
  if (name === 'webstorm' || name === 'webstorm1') {
    const app = spawnSync('open', ['-W', '-a', 'WebStorm', file], { stdio: 'inherit' })
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
