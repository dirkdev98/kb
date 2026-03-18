import { describe, expect, it } from 'vitest'
import { buildEditorInvocation, formatEditableEntry, parseEditableEntry, splitEditorCommand } from './prompt.ts'

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
})
