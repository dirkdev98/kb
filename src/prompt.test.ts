import { describe, expect, it } from 'vitest'
import {
  buildEditorInvocation,
  deriveQuestion,
  detectTagsInText,
  formatEditableEntry,
  parseEditableEntry,
  splitEditorCommand,
  stripRichText,
} from './prompt.ts'

describe('editable entry helpers', () => {
  it('splits editor commands with args', () => {
    expect(splitEditorCommand('webstorm -e')).toEqual(['webstorm', '-e'])
    expect(splitEditorCommand('"Visual Studio Code" --wait')).toEqual(['Visual Studio Code', '--wait'])
  })

  it('adds wait for webstorm launchers', () => {
    expect(buildEditorInvocation('webstorm -e', '/tmp/entry.md')).toEqual({
      command: 'webstorm',
      name: 'webstorm',
      args: ['-e', '--wait', '/tmp/entry.md'],
    })
  })

  it('round-trips editable entries', () => {
    const entry = {
      question: 'How?',
      tags: ['alpha', 'beta'],
      answer: 'Like this.',
    }

    expect(parseEditableEntry(formatEditableEntry(entry))).toEqual(entry)
  })

  it('normalizes tags while parsing', () => {
    expect(parseEditableEntry('Question: Test\nTags: One Tag, Two\n\nAnswer:\nBody\n')).toEqual({
      question: 'Test',
      tags: ['one-tag', 'two'],
      answer: 'Body',
    })
  })

  it('rejects invalid edit format', () => {
    expect(() => parseEditableEntry('nope')).toThrow('Invalid edit format')
  })

  it('strips markdown and html when deriving questions', () => {
    expect(deriveQuestion('# SQLite FTS\n\nUse `unicode61` tokenizer.')).toBe('SQLite FTS')
    expect(deriveQuestion('<h1>Chrome note</h1><p>Use contextMenus API.</p>')).toBe('Chrome note')
  })

  it('strips formatting but keeps readable text', () => {
    expect(stripRichText('**Bold** [docs](https://example.com) <em>html</em>')).toBe('Bold docs html')
  })

  it('detects existing tags from cleaned text', () => {
    expect(detectTagsInText('Use Full Text Search in <b>SQLite</b>.', ['sqlite', 'full-text-search', 'webstorm'])).toEqual([
      'full-text-search',
      'sqlite',
    ])
  })
})
