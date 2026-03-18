import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const entry = join(process.cwd(), 'src', 'test-cli.ts')

describe('test-cli smoke', () => {
  it('uses injected test root only', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-test-cli-'))
    const result = spawnSync('node', ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', entry, 'list'], {
      env: { ...process.env, KB_TEST_ROOT: root },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('No entries found')
    expect(existsSync(join(root, 'kb', 'kb.sqlite'))).toBe(true)
    expect(readdirSync(join(root, 'kb', 'backups')).some((name) => /^kb-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name))).toBe(true)
  })

  it('help does not create storage', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-test-cli-'))
    const result = spawnSync('node', ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', entry, '--help'], {
      env: { ...process.env, KB_TEST_ROOT: root },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage')
    expect(existsSync(join(root, 'kb'))).toBe(false)
  })
})
