#!/usr/bin/env -S node --disable-warning=ExperimentalWarning --experimental-strip-types

import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { runCli } from './app.ts'
import { makePaths } from './paths.ts'

function getRealRootDir(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share')
}

runCli(process.argv.slice(2), {
  paths: makePaths(getRealRootDir(process.env)),
  now: () => new Date(),
}).then((exitCode) => {
  process.exit(exitCode)
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
