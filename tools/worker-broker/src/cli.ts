#!/usr/bin/env node
// tools/worker-broker/src/cli.ts
// provide a deterministic CLI over the shared worker daemon

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import type { BrokerConfig, StartWorkerRequest } from './contracts.js'
import { runCcusage as runCcusageCommand } from './ccusage.js'
import { defaultBrokerConfig } from './config.js'
import { connectDaemon, ensureDaemonClient } from './daemon/client.js'
import type { DaemonClient } from './daemon/protocol.js'
import { errorMessage } from './errors.js'
import { readJson } from './json.js'
import {
  waitForOneTerminal,
  waitForSelection,
  type WaitSelector,
} from './wait-command.js'

export interface ParsedCli
{
  command: string
  positionals: string[]
  request_path?: string
  state_dir?: string
  passthrough?: string[]
  run?: string
  job_ids?: string[]
  json?: boolean
  timeout?: number
  pretty: boolean
  when_idle: boolean
}

export interface CliDependencies
{
  connect(config: BrokerConfig): Promise<DaemonClient>
  // * wait must attach to the daemon the workers were started on; spawning one
  // from the lead's shell would pick up a different provider config
  connectExisting?(config: BrokerConfig): Promise<DaemonClient>
  writeStdout(value: string): void
  readRequest(path: string): Promise<StartWorkerRequest>
  runCcusage?(stateDir: string, args: string[]): Promise<number>
}

// matches the daemon's MAX_WAIT_SECONDS, so no blocking call is re-clamped
const DEFAULT_WAIT_POLL_SECONDS = 900

export function usage(): string
{
  return `worker-broker <command> [options]

Commands:
  run --request <file>   run one assignment and wait for its terminal result
  wait --run <run> | --job-id <id>...
                         block until every selected worker is terminal
                         (0 all completed, 1 terminal w/ failures,
                          2 terminality not observed)
  list                   list persisted jobs
  result <job-id>        print one persisted job
  ccusage -- [args...]   include Codex worker usage in stock ccusage
                         (WORKER_BROKER_CCUSAGE_BINARY pins the stock binary
                          when a wrapper shadows it on PATH)
  daemon status          print shared daemon status
  daemon stop            stop the daemon when no jobs are active
  daemon stop --when-idle drain active jobs, then stop the daemon

Options:
  --state-dir <path>     override WORKER_BROKER_HOME
  --pretty               pretty-print JSON output
  --json                 machine-readable output
  --timeout <seconds>    per-call daemon wait (default 900)
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
    if (argument === '--')
    {
      if (command !== 'ccusage') throw new Error('unknown option: --')
      parsed.passthrough = rest.slice(index + 1)
      break
    }
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
    else if (argument === '--run')
    {
      const value = rest[++index]
      if (value === undefined) throw new Error('--run requires a value')
      parsed.run = value
    }
    else if (argument === '--job-id')
    {
      const value = rest[++index]
      if (value === undefined) throw new Error('--job-id requires a value')
      ;(parsed.job_ids ??= []).push(value)
    }
    else if (argument === '--timeout')
    {
      const value = rest[++index]
      const seconds =
        value === undefined ? Number.NaN : Number.parseInt(value, 10)
      if (!Number.isSafeInteger(seconds) || seconds <= 0)
        throw new Error('--timeout requires a positive integer')
      parsed.timeout = seconds
    }
    else if (argument === '--json') parsed.json = true
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

// exit codes are the contract a detached caller branches on: 0 = every selected
// worker completed, 1 = all terminal but at least one did not complete,
// 2 = terminality was never observed (no daemon, empty selector, transport loss)
async function runWait(
  parsed: ParsedCli,
  config: BrokerConfig,
  dependencies: CliDependencies
): Promise<number>
{
  if (parsed.run === undefined && parsed.job_ids === undefined)
    throw new Error('wait requires --run <run> or --job-id <id>')
  const connectExisting =
    dependencies.connectExisting ??
    (async (target: BrokerConfig) =>
      await connectDaemon(target, { spawn: false }))
  let client: DaemonClient
  try
  {
    client = await connectExisting(config)
  }
  catch
  {
    process.stderr.write(
      'no worker-broker daemon is listening; nothing was waited on\n'
    )
    return 2
  }
  try
  {
    const selector: WaitSelector = {}
    if (parsed.run !== undefined) selector.run = parsed.run
    if (parsed.job_ids !== undefined) selector.job_ids = parsed.job_ids
    const outcome = await waitForSelection(
      client,
      selector,
      { line: (text) => dependencies.writeStdout(`${text}\n`) },
      {
        json: parsed.json ?? false,
        pollSeconds: parsed.timeout ?? DEFAULT_WAIT_POLL_SECONDS,
      }
    )
    if (!outcome.observed)
    {
      process.stderr.write('no workers matched the selector\n')
      return 2
    }
    return outcome.failed === 0 ? 0 : 1
  }
  catch (error)
  {
    // a lost socket must not read as "the wave finished with failures"
    process.stderr.write(`${errorMessage(error)}\n`)
    return 2
  }
  finally
  {
    await client.close()
  }
}

async function dispatchCli(
  argv: string[],
  dependencies: CliDependencies
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
  if (parsed.command === 'ccusage')
  {
    if (
      parsed.positionals.length > 0 ||
      parsed.request_path !== undefined ||
      parsed.pretty ||
      parsed.when_idle
    )
    {
      throw new Error('ccusage arguments must follow --')
    }
    const runCcusage = dependencies.runCcusage ?? runCcusageCommand
    return await runCcusage(config.state_dir, parsed.passthrough ?? [])
  }
  if (parsed.command === 'wait')
  {
    return await runWait(parsed, config, dependencies)
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
      const job = await waitForOneTerminal(
        client,
        started.job_id,
        parsed.timeout ?? DEFAULT_WAIT_POLL_SECONDS
      )
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
  try
  {
    return await dispatchCli(argv, dependencies)
  }
  catch (error)
  {
    // an invocation error is not an observed wave: exit 1 is reserved for a
    // terminal wave with failures, so a bad flag or a missing selector reports
    // 2 rather than waking the caller into triage
    if (argv[0] !== 'wait') throw error
    process.stderr.write(`${errorMessage(error)}\n`)
    return 2
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
