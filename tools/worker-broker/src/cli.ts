#!/usr/bin/env node
// tools/worker-broker/src/cli.ts
// provide a deterministic CLI over the shared worker daemon

import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import type { BrokerConfig } from './contracts.js'
import { runCcusage as runCcusageCommand } from './ccusage.js'
import { defaultBrokerConfig } from './config.js'
import { connectDaemon, ensureDaemonClient } from './daemon/client.js'
import type { DaemonClient } from './daemon/protocol.js'
import { errorMessage } from './errors.js'
import { readJson } from './json.js'
import { parseStartWorkerRequest } from './request.js'
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
  writeStderr(value: string): void
  readRequest(path: string): Promise<unknown>
  runCcusage?(stateDir: string, args: string[]): Promise<number>
}

export class CliUsageError extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'CliUsageError'
  }
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
  const seenOptions = new Set<string>()
  const markOption = (option: string): void =>
  {
    if (option !== '--job-id' && seenOptions.has(option))
    {
      throw new CliUsageError(`duplicate option: ${option}`)
    }
    seenOptions.add(option)
  }
  const optionValue = (option: string, index: number): string =>
  {
    const value = rest[index]
    if (value === undefined || value.trim() === '' || value.startsWith('-'))
    {
      throw new CliUsageError(`${option} requires a value`)
    }
    return value
  }
  for (let index = 0; index < rest.length; index += 1)
  {
    const argument = rest[index]
    if (argument === '--')
    {
      if (command !== 'ccusage') throw new CliUsageError('unknown option: --')
      parsed.passthrough = rest.slice(index + 1)
      break
    }
    if (argument === '--request')
    {
      markOption(argument)
      parsed.request_path = optionValue(argument, ++index)
    }
    else if (argument === '--state-dir')
    {
      markOption(argument)
      parsed.state_dir = optionValue(argument, ++index)
    }
    else if (argument === '--run')
    {
      markOption(argument)
      parsed.run = optionValue(argument, ++index)
    }
    else if (argument === '--job-id')
    {
      markOption(argument)
      const value = optionValue(argument, ++index)
      if (parsed.job_ids?.includes(value) === true)
      {
        throw new CliUsageError(`duplicate --job-id value: ${value}`)
      }
      ;(parsed.job_ids ??= []).push(value)
    }
    else if (argument === '--timeout')
    {
      markOption(argument)
      const value = optionValue(argument, ++index)
      const seconds = /^[0-9]+$/u.test(value) ? Number(value) : Number.NaN
      if (!Number.isSafeInteger(seconds) || seconds <= 0)
        throw new CliUsageError('--timeout requires a positive integer')
      parsed.timeout = seconds
    }
    else if (argument === '--json')
    {
      markOption(argument)
      parsed.json = true
    }
    else if (argument === '--pretty')
    {
      markOption(argument)
      parsed.pretty = true
    }
    else if (argument === '--when-idle')
    {
      markOption(argument)
      parsed.when_idle = true
    }
    else if (argument?.startsWith('-'))
      throw new CliUsageError(`unknown option: ${argument}`)
    else if (argument !== undefined) parsed.positionals.push(argument)
  }

  const allowOnly = (...allowed: string[]): void =>
  {
    const permitted = new Set(allowed)
    const unsupported = [...seenOptions].find(
      (option) => !permitted.has(option)
    )
    if (unsupported !== undefined)
    {
      throw new CliUsageError(`${unsupported} is not valid for ${command}`)
    }
  }
  const requireNoPositionals = (): void =>
  {
    if (parsed.positionals.length > 0)
    {
      throw new CliUsageError(`${command} does not accept positional arguments`)
    }
  }

  if (command === 'help' || command === '--help' || command === '-h')
  {
    allowOnly()
    requireNoPositionals()
  }
  else if (command === 'run')
  {
    allowOnly('--request', '--state-dir', '--timeout', '--pretty')
    requireNoPositionals()
    if (parsed.request_path === undefined)
      throw new CliUsageError('run requires --request <file>')
  }
  else if (command === 'wait')
  {
    allowOnly('--run', '--job-id', '--state-dir', '--timeout', '--json')
    requireNoPositionals()
    if ((parsed.run === undefined) === (parsed.job_ids === undefined))
    {
      throw new CliUsageError(
        'wait requires exactly one of --run <run> or --job-id <id>...'
      )
    }
  }
  else if (command === 'list')
  {
    allowOnly('--state-dir', '--pretty')
    requireNoPositionals()
  }
  else if (command === 'result')
  {
    allowOnly('--state-dir', '--pretty')
    if (parsed.positionals.length !== 1)
      throw new CliUsageError('result requires exactly one job id')
  }
  else if (command === 'ccusage')
  {
    allowOnly('--state-dir')
    requireNoPositionals()
  }
  else if (command === 'daemon')
  {
    if (parsed.positionals.length !== 1)
      throw new CliUsageError(
        'daemon requires exactly one action: status or stop'
      )
    const action = parsed.positionals[0]
    if (action === 'status') allowOnly('--state-dir', '--pretty')
    else if (action === 'stop')
      allowOnly('--state-dir', '--pretty', '--when-idle')
    else throw new CliUsageError('daemon requires status or stop')
  }
  else
  {
    throw new CliUsageError(`unknown command: ${command}`)
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
    throw new Error(
      'no worker-broker daemon is listening; nothing was waited on'
    )
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
      throw new Error('no workers matched the selector')
    }
    return outcome.failed + outcome.rejected + outcome.cancelled === 0 ? 0 : 1
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
    const runCcusage = dependencies.runCcusage ?? runCcusageCommand
    return (await runCcusage(config.state_dir, parsed.passthrough ?? [])) === 0
      ? 0
      : 1
  }
  if (parsed.command === 'wait')
  {
    return await runWait(parsed, config, dependencies)
  }
  let request: ReturnType<typeof parseStartWorkerRequest> | undefined
  if (parsed.command === 'run')
  {
    request = parseStartWorkerRequest(
      await dependencies.readRequest(path.resolve(parsed.request_path ?? ''))
    )
  }
  const client = await dependencies.connect(config)
  try
  {
    if (parsed.command === 'run')
    {
      if (request === undefined)
        throw new Error('validated run request missing')
      const started = await client.call('start_worker', request)
      const summary = await waitForOneTerminal(
        client,
        started.worker.job_id,
        parsed.timeout ?? DEFAULT_WAIT_POLL_SECONDS
      )
      const job = await client.call('get_worker_result', {
        job_id: summary.job_id,
      })
      dependencies.writeStdout(
        serializeOutput(job.result ?? job, parsed.pretty)
      )
      return summary.status === 'completed' ? 0 : 1
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
      const jobId = parsed.positionals[0] as string
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
      throw new Error('validated daemon action missing')
    }
    throw new Error(`validated command missing: ${parsed.command}`)
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
    writeStderr: (value) => process.stderr.write(value),
    readRequest: async (requestPath) => await readJson<unknown>(requestPath),
  }
): Promise<number>
{
  try
  {
    return await dispatchCli(argv, dependencies)
  }
  catch (error)
  {
    dependencies.writeStderr(`${errorMessage(error)}\n`)
    if (error instanceof CliUsageError || argv[0] === 'wait') return 2
    return 1
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
