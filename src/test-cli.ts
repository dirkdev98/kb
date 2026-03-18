#!/usr/bin/env -S node --experimental-strip-types

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { join } from 'node:path'
import { runCli } from './app.ts'
import { makePaths } from './paths.ts'

const rootDir = process.env.KB_TEST_ROOT ?? mkdtempSync(join(tmpdir(), 'kb-test-'))

runCli(process.argv.slice(2), {
  paths: makePaths(rootDir),
  now: () => new Date(),
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
