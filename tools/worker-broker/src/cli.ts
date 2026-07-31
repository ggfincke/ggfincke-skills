#!/usr/bin/env node
// tools/worker-broker/src/cli.ts
// provide a deterministic local CLI over the broker core before MCP wrapping

import path from 'node:path'
import process from 'node:process'
import type {
  BrokerConfig,
  StartWorkerRequest,
  WorkerJob,
} from './contracts.js'
import { defaultBrokerConfig } from './config.js'
import { errorMessage } from './errors.js'
import { JobManager } from './job-manager.js'
import { JobStore } from './job-store.js'
import { readJson } from './json.js'
import { CodexProvider } from './providers/codex.js'
import { ClaudeProvider } from './providers/claude.js'
import { CoralProvider } from './providers/coral.js'
import { CursorProvider } from './providers/cursor.js'

interface ParsedCli
{
  command: string
  positionals: string[]
  request_path?: string
  state_dir?: string
  pretty: boolean
}

function usage(): string
{
  return `worker-broker <command> [options]

Commands:
  run --request <file>   run one assignment and wait for its terminal result
  list                   list persisted jobs
  result <job-id>        print one persisted job

Options:
  --state-dir <path>     override WORKER_BROKER_HOME
  --pretty               pretty-print JSON output
`
}

function parseCli(argv: string[]): ParsedCli
{
  const [command = 'help', ...rest] = argv
  const parsed: ParsedCli = { command, positionals: [], pretty: false }
  for (let index = 0; index < rest.length; index += 1)
  {
    const argument = rest[index]
    if (argument === '--request')
    {
      const value = rest[++index]
      if (value === undefined) throw new Error('--request requires a value')
      parsed.request_path = value
    }
    else if (argument === '--state-dir')
    {
      const value = rest[++index]
      if (value === undefined) throw new Error('--state-dir requires a value')
      parsed.state_dir = value
    }
    else if (argument === '--pretty') parsed.pretty = true
    else if (argument?.startsWith('-'))
      throw new Error(`unknown option: ${argument}`)
    else if (argument !== undefined) parsed.positionals.push(argument)
  }
  return parsed
}

function output(value: unknown, pretty: boolean): void
{
  process.stdout.write(
    `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`
  )
}

function withStateDirectory(
  config: BrokerConfig,
  stateDir: string | undefined
): BrokerConfig
{
  if (stateDir === undefined) return config
  return { ...config, state_dir: path.resolve(stateDir) }
}

async function runJob(
  config: BrokerConfig,
  parsed: ParsedCli
): Promise<WorkerJob>
{
  if (parsed.request_path === undefined)
    throw new Error('run requires --request <file>')
  const request = await readJson<StartWorkerRequest>(
    path.resolve(parsed.request_path)
  )
  const manager = new JobManager(config, [
    new CodexProvider(config),
    new ClaudeProvider(config),
    new CursorProvider(config),
    new CoralProvider(config),
  ])
  const started = await manager.start(request)
  return await manager.waitForTerminal(started.job_id)
}

async function main(): Promise<void>
{
  const parsed = parseCli(process.argv.slice(2))
  const config = withStateDirectory(defaultBrokerConfig(), parsed.state_dir)
  if (
    parsed.command === 'help' ||
    parsed.command === '--help' ||
    parsed.command === '-h'
  )
  {
    process.stdout.write(usage())
    return
  }
  if (parsed.command === 'run')
  {
    const job = await runJob(config, parsed)
    output(job.result ?? job, parsed.pretty)
    if (job.status !== 'completed') process.exitCode = 1
    return
  }

  const store = new JobStore(config.state_dir)
  if (parsed.command === 'list')
  {
    output(await store.list(), parsed.pretty)
    return
  }
  if (parsed.command === 'result')
  {
    const jobId = parsed.positionals[0]
    if (jobId === undefined) throw new Error('result requires a job id')
    const job = await store.read(jobId)
    output(job.result ?? job, parsed.pretty)
    return
  }
  throw new Error(`unknown command: ${parsed.command}\n\n${usage()}`)
}

main().catch((error: unknown) =>
{
  process.stderr.write(`${errorMessage(error)}\n`)
  process.exitCode = 1
})
