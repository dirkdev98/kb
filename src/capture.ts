import { readFileSync } from 'node:fs'
import { basename, extname, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { deriveQuestion } from './prompt.ts'

export type CodeReferenceInput = {
  cwd: string
  file: string
  lineStart: number
  lineEnd: number
}

export type ProjectMetadata = {
  projectName?: string
  branch?: string
  commit?: string
  githubUrl?: string
  displayFile: string
}

type GitRunner = (args: string[], cwd: string) => string | undefined

function defaultGitRunner(args: string[], cwd: string): string | undefined {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error || result.status !== 0) return undefined
  return result.stdout.trim() || undefined
}

function mapLanguage(file: string): string {
  const ext = extname(file).toLowerCase()
  if (ext === '.ts' || ext === '.mts' || ext === '.cts') return 'ts'
  if (ext === '.tsx') return 'tsx'
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'js'
  if (ext === '.jsx') return 'jsx'
  if (ext === '.py') return 'python'
  if (ext === '.rb') return 'ruby'
  if (ext === '.sh') return 'bash'
  if (ext === '.yml') return 'yaml'
  return ext.replace(/^\./, '') || 'text'
}

function isMarkdownFile(file: string): boolean {
  const ext = extname(file).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

function parseGithubRemote(remote: string): { owner: string; repo: string } | null {
  const ssh = remote.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/)
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! }
  const https = remote.match(/^https:\/\/github\.com\/(.+?)\/(.+?)(?:\.git)?$/)
  if (https) return { owner: https[1]!, repo: https[2]! }
  return null
}

export function extractCommentQuestion(snippet: string): string {
  const lines = snippet.replace(/\r/g, '').split('\n')
  let index = 0
  while (index < lines.length && lines[index]?.trim() === '') index += 1
  const first = lines[index]?.trim()
  if (!first) throw new Error('Selected code must start with a comment')

  const collected: string[] = []

  if (first.startsWith('//')) {
    for (; index < lines.length; index += 1) {
      const line = lines[index]?.trim() ?? ''
      if (!line.startsWith('//')) break
      collected.push(line.replace(/^\/\/\s?/, ''))
    }
  } else if (first.startsWith('/*') || first.startsWith('/**')) {
    for (; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      const trimmed = line.trim()
      let value = trimmed
        .replace(/^\/\*+\s?/, '')
        .replace(/^\*\s?/, '')
        .replace(/\s*\*\/$/, '')
      if (value.trim()) collected.push(value)
      if (trimmed.includes('*/')) break
    }
  } else if (first.startsWith('*')) {
    for (; index < lines.length; index += 1) {
      const trimmed = lines[index]?.trim() ?? ''
      if (!trimmed.startsWith('*')) break
      const value = trimmed.replace(/^\*+\s?/, '').replace(/\s*\*\/$/, '')
      if (value.trim()) collected.push(value)
      if (trimmed.includes('*/')) break
    }
  } else {
    throw new Error('Selected code must start with a comment')
  }

  const question = deriveQuestion(collected.join(' ').trim())
  if (!question) throw new Error('Question required')
  return question
}

export function readCodeReference(input: CodeReferenceInput): { snippet: string; absoluteFile: string; language: string; question: string } {
  if (!Number.isInteger(input.lineStart) || input.lineStart <= 0) throw new Error('line-start must be a positive integer')
  if (!Number.isInteger(input.lineEnd) || input.lineEnd <= 0) throw new Error('line-end must be a positive integer')
  if (input.lineStart > input.lineEnd) throw new Error('line-start must be less than or equal to line-end')

  const absoluteFile = resolve(input.cwd, input.file)
  const lines = readFileSync(absoluteFile, 'utf8').replace(/\r/g, '').split('\n')
  const snippet = lines.slice(input.lineStart - 1, input.lineEnd).join('\n').trimEnd()
  if (!snippet.trim()) throw new Error('Selected code is empty')

  return {
    snippet,
    absoluteFile,
    language: mapLanguage(input.file),
    question: isMarkdownFile(input.file) ? deriveQuestion(snippet) : extractCommentQuestion(snippet),
  }
}

export function collectProjectMetadata(
  input: CodeReferenceInput & { absoluteFile?: string },
  runGit: GitRunner = defaultGitRunner,
): ProjectMetadata {
  const repoRoot = runGit(['rev-parse', '--show-toplevel'], input.cwd)
  const commit = runGit(['rev-parse', 'HEAD'], input.cwd)
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], input.cwd)
  const remote = runGit(['remote', 'get-url', 'origin'], input.cwd)
  const absoluteFile = input.absoluteFile ?? resolve(input.cwd, input.file)

  const displayFile = repoRoot ? relative(repoRoot, absoluteFile) || basename(absoluteFile) : input.file
  const projectName = repoRoot ? basename(repoRoot) : basename(input.cwd)

  let githubUrl: string | undefined
  const remoteParts = remote ? parseGithubRemote(remote) : null
  if (remoteParts && commit && repoRoot) {
    const rel = relative(repoRoot, absoluteFile)
    if (rel && !rel.startsWith('..')) {
      githubUrl = `https://github.com/${remoteParts.owner}/${remoteParts.repo}/blob/${commit}/${rel.replace(/\\/g, '/')}`
      githubUrl += `#L${input.lineStart}`
      if (input.lineEnd > input.lineStart) githubUrl += `-L${input.lineEnd}`
    }
  }

  return {
    displayFile,
    ...(projectName ? { projectName } : {}),
    ...(branch && branch !== 'HEAD' ? { branch } : {}),
    ...(commit ? { commit } : {}),
    ...(githubUrl ? { githubUrl } : {}),
  }
}

export function formatCodeReferenceAnswer(
  input: { snippet: string; language: string; metadata: ProjectMetadata } & Pick<CodeReferenceInput, 'lineStart' | 'lineEnd'>,
): string {
  const fileRef = input.lineStart === input.lineEnd
    ? `${input.metadata.displayFile}:${input.lineStart}`
    : `${input.metadata.displayFile}:${input.lineStart}-${input.lineEnd}`

  const lines = [
    `File: \`${fileRef}\``,
    input.metadata.projectName ? `Project: \`${input.metadata.projectName}\`` : undefined,
    input.metadata.branch ? `Branch: \`${input.metadata.branch}\`` : undefined,
    input.metadata.commit ? `Commit: \`${input.metadata.commit.slice(0, 7)}\`` : undefined,
    input.metadata.githubUrl ? `GitHub: ${input.metadata.githubUrl}` : undefined,
  ].filter((line): line is string => line !== undefined)

  const fence = `\`\`\`${input.language}`
  return `${lines.join('\n')}\n\n${fence}\n${input.snippet}\n\`\`\``
}
