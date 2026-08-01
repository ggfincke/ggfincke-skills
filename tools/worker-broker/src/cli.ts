#!/usr/bin/env node
// tools/worker-broker/src/cli.ts
// provide a deterministic CLI over the shared worker daemon

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import type {
  BrokerConfig,
  StartWorkerRequest,
  WorkerJob,
  WorkerStatus,
} from './contracts.js'
import { defaultBrokerConfig } from './config.js'
import { ensureDaemonClient } from './daemon/client.js'
import type { DaemonClient } from './daemon/protocol.js'
import { errorMessage } from './errors.js'
import { readJson } from './json.js'

export interface ParsedCli
{
  command: string
  positionals: string[]
  request_path?: string
  state_dir?: string
  pretty: boolean
  when_idle: boolean
}

export interface CliDependencies
{
  connect(config: BrokerConfig): Promise<DaemonClient>
  writeStdout(value: string): void
  readRequest(path: string): Promise<StartWorkerRequest>
}

const TERMINAL_STATUSES = new Set<WorkerStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

export function usage(): string
{
  return `worker-broker <command> [options]

Commands:
  run --request <file>   run one assignment and wait for its terminal result
  list                   list persisted jobs
  result <job-id>        print one persisted job
  daemon status          print shared daemon status
  daemon stop            stop the daemon when no jobs are active
  daemon stop --when-idle drain active jobs, then stop the daemon

Options:
  --state-dir <path>     override WORKER_BROKER_HOME
  --pretty               pretty-print JSON output
`
}

export function parseCli(argv: string[]): ParsedCli
{
  const [command = 'help', ...rest] = argv
  const parsed: ParsedCli = {
    command,
    positionals: [],
    pretty: false,
    when_idle: false,
  }
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
    else if (argument === '--when-idle') parsed.when_idle = true
    else if (argument?.startsWith('-'))
      throw new Error(`unknown option: ${argument}`)
    else if (argument !== undefined) parsed.positionals.push(argument)
  }
  return parsed
}

function serializeOutput(value: unknown, pretty: boolean): string
{
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`
}

function withStateDirectory(
  config: BrokerConfig,
  stateDir: string | undefined
): BrokerConfig
{
  if (stateDir === undefined) return config
  return { ...config, state_dir: path.resolve(stateDir) }
}

async function waitForTerminal(
  client: DaemonClient,
  jobId: string
): Promise<WorkerJob>
{
  while (true)
  {
    const waited = await client.call('wait_for_workers', {
      job_ids: [jobId],
      timeout_seconds: 300,
    })
    const job = waited.workers.find((worker) => worker.job_id === jobId)
    if (job !== undefined && TERMINAL_STATUSES.has(job.status)) return job
  }
}

export async function runCli(
  argv: string[],
  dependencies: CliDependencies = {
    connect: ensureDaemonClient,
    writeStdout: (value) => process.stdout.write(value),
    readRequest: async (requestPath) =>
      await readJson<StartWorkerRequest>(requestPath),
  }
): Promise<number>
{
  const parsed = parseCli(argv)
  const config = withStateDirectory(defaultBrokerConfig(), parsed.state_dir)
  if (
    parsed.command === 'help' ||
    parsed.command === '--help' ||
    parsed.command === '-h'
  )
  {
    dependencies.writeStdout(usage())
    return 0
  }
  const client = await dependencies.connect(config)
  try
  {
    if (parsed.command === 'run')
    {
      if (parsed.request_path === undefined)
        throw new Error('run requires --request <file>')
      const request = await dependencies.readRequest(
        path.resolve(parsed.request_path)
      )
      const started = await client.call('start_worker', request)
      const job = await waitForTerminal(client, started.job_id)
      dependencies.writeStdout(
        serializeOutput(job.result ?? job, parsed.pretty)
      )
      return job.status === 'completed' ? 0 : 1
    }

    if (parsed.command === 'list')
    {
      dependencies.writeStdout(
        serializeOutput(await client.call('list_workers', {}), parsed.pretty)
      )
      return 0
    }
    if (parsed.command === 'result')
    {
      const jobId = parsed.positionals[0]
      if (jobId === undefined) throw new Error('result requires a job id')
      const job = await client.call('get_worker_result', { job_id: jobId })
      dependencies.writeStdout(
        serializeOutput(job.result ?? job, parsed.pretty)
      )
      return 0
    }
    if (parsed.command === 'daemon')
    {
      const action = parsed.positionals[0]
      if (action === 'status')
      {
        dependencies.writeStdout(
          serializeOutput(await client.call('daemon_status', {}), parsed.pretty)
        )
        return 0
      }
      if (action === 'stop')
      {
        const status = await client.call('shutdown', {
          when_idle: parsed.when_idle,
        })
        dependencies.writeStdout(serializeOutput(status, parsed.pretty))
        return !parsed.when_idle && status.active_jobs.length > 0 ? 1 : 0
      }
      throw new Error('daemon requires status or stop')
    }
    throw new Error(`unknown command: ${parsed.command}\n\n${usage()}`)
  }
  finally
  {
    await client.close()
  }
}

async function main(): Promise<void>
{
  process.exitCode = await runCli(process.argv.slice(2))
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
)
{
  main().catch((error: unknown) =>
  {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}
