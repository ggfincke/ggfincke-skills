// tools/worker-broker/src/ccusage.ts
// capture & backfill content-free Codex worker usage for stock ccusage

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import {
  access,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  secureDirectory,
  securePrivateFile,
  writePrivateFile,
} from './artifact.js'
import { readJson } from './json.js'

const TERMINAL_STATUSES = new Set([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

type UsageProvenance = 'captured' | 'backfilled'
type PersistResult = 'written' | 'existing' | 'ignored'

interface CodexUsage
{
  input_tokens: number
  cached_input_tokens: number
  cache_write_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

interface CodexUsageRecord
{
  type: 'turn.completed'
  timestamp: string
  model?: string
  usage: CodexUsage
  worker_broker: {
    schema_version: 1
    source_id: string
    attempt: number
    turn_index: number
    provenance: UsageProvenance
  }
}

interface StoredJob
{
  job_id?: string
  status?: string
  restart_requeues?: number
  request?: {
    provider?: string
    model?: string
  }
  result?: {
    effective_model?: string
  }
}

export interface CodexUsageSource
{
  job_id: string
  attempt: number
  turn_index: number
  timestamp: string
  model?: string
  provenance: UsageProvenance
  replace_existing?: boolean
}

export interface CodexUsageSidecarSummary
{
  directory: string
  records: number
  missing_models: number
  backfilled_records: number
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
}

function isRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined
{
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function eventContainers(
  event: Record<string, unknown>
): Record<string, unknown>[]
{
  const containers = [event]
  for (const key of ['data', 'result', 'response'])
  {
    const nested = event[key]
    if (isRecord(nested)) containers.push(nested)
  }
  return containers
}

export function codexEventModel(
  event: Record<string, unknown>
): string | undefined
{
  for (const container of eventContainers(event))
  {
    const direct =
      nonEmptyString(container.model) ?? nonEmptyString(container.model_name)
    if (direct !== undefined) return direct
    const metadata = container.metadata
    if (isRecord(metadata))
    {
      const nested = nonEmptyString(metadata.model)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

function codexEventTimestamp(
  event: Record<string, unknown>
): string | undefined
{
  for (const container of eventContainers(event))
  {
    for (const key of ['timestamp', 'created_at', 'createdAt'])
    {
      const value = nonEmptyString(container[key])
      if (value === undefined) continue
      const milliseconds = Date.parse(value)
      if (Number.isFinite(milliseconds))
      {
        return new Date(milliseconds).toISOString()
      }
    }
  }
  return undefined
}

function tokenCount(
  usage: Record<string, unknown>,
  key: keyof CodexUsage
): number | undefined
{
  const value = usage[key]
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
  {
    return undefined
  }
  return value
}

function codexUsageFromEvent(
  event: Record<string, unknown>
): CodexUsage | undefined
{
  let rawUsage: Record<string, unknown> | undefined
  for (const container of eventContainers(event))
  {
    if (isRecord(container.usage))
    {
      rawUsage = container.usage
      break
    }
  }
  if (rawUsage === undefined) return undefined

  const inputTokens = tokenCount(rawUsage, 'input_tokens')
  const cachedInputTokens = tokenCount(rawUsage, 'cached_input_tokens')
  const cacheWriteInputTokens = tokenCount(rawUsage, 'cache_write_input_tokens')
  const outputTokens = tokenCount(rawUsage, 'output_tokens')
  const reasoningOutputTokens = tokenCount(rawUsage, 'reasoning_output_tokens')
  if (
    inputTokens === undefined ||
    cachedInputTokens === undefined ||
    cacheWriteInputTokens === undefined ||
    outputTokens === undefined ||
    reasoningOutputTokens === undefined
  )
  {
    return undefined
  }
  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    cacheWriteInputTokens === 0 &&
    outputTokens === 0 &&
    reasoningOutputTokens === 0
  )
  {
    return undefined
  }
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: cacheWriteInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
  }
}

function sourceHash(
  jobId: string,
  attempt: number,
  turnIndex: number | 'complete'
): string
{
  return createHash('sha256')
    .update('worker-broker-codex\0')
    .update(jobId)
    .update('\0')
    .update(String(attempt))
    .update('\0')
    .update(String(turnIndex))
    .digest('hex')
}

export function codexUsageSidecarDirectory(stateDir: string): string
{
  return path.join(stateDir, 'ccusage', 'codex')
}

function usageRecordPath(
  stateDir: string,
  jobId: string,
  attempt: number,
  turnIndex: number
): string
{
  return path.join(
    codexUsageSidecarDirectory(stateDir),
    `${sourceHash(jobId, attempt, turnIndex)}.jsonl`
  )
}

function completionMarkerPath(
  stateDir: string,
  jobId: string,
  attempt: number
): string
{
  return path.join(
    codexUsageSidecarDirectory(stateDir),
    `${sourceHash(jobId, attempt, 'complete')}.complete`
  )
}

async function pathExists(filePath: string): Promise<boolean>
{
  try
  {
    await access(filePath)
    return true
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function writePrivateAtomic(
  filePath: string,
  content: string
): Promise<void>
{
  await secureDirectory(path.dirname(filePath))
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try
  {
    await writePrivateFile(temporary, content)
    await rename(temporary, filePath)
    await securePrivateFile(filePath)
  }
  finally
  {
    await unlink(temporary).catch(() => undefined)
  }
}

export async function persistCodexUsageEvent(
  stateDir: string,
  event: Record<string, unknown>,
  source: CodexUsageSource
): Promise<PersistResult>
{
  if (event.type !== 'turn.completed') return 'ignored'
  const usage = codexUsageFromEvent(event)
  if (usage === undefined) return 'ignored'
  const filePath = usageRecordPath(
    stateDir,
    source.job_id,
    source.attempt,
    source.turn_index
  )
  if (source.replace_existing === false && (await pathExists(filePath)))
  {
    return 'existing'
  }

  const sourceId = sourceHash(source.job_id, source.attempt, source.turn_index)
  const record: CodexUsageRecord = {
    type: 'turn.completed',
    timestamp: codexEventTimestamp(event) ?? source.timestamp,
    usage,
    worker_broker: {
      schema_version: 1,
      source_id: `sha256:${sourceId}`,
      attempt: source.attempt,
      turn_index: source.turn_index,
      provenance: source.provenance,
    },
  }
  const model = codexEventModel(event) ?? source.model
  if (model !== undefined) record.model = model

  // compact JSON is part of ccusage's fast headless-event classifier
  await writePrivateAtomic(filePath, `${JSON.stringify(record)}\n`)
  return 'written'
}

async function directoryEntries(directory: string)
{
  try
  {
    return await readdir(directory, { withFileTypes: true })
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function storedJobModel(job: StoredJob): string | undefined
{
  return (
    nonEmptyString(job.result?.effective_model) ??
    nonEmptyString(job.request?.model)
  )
}

function storedJobAttempt(job: StoredJob): number
{
  const attempt = job.restart_requeues
  return typeof attempt === 'number' &&
    Number.isSafeInteger(attempt) &&
    attempt >= 0
    ? attempt
    : 0
}

async function backfillEventLog(
  stateDir: string,
  eventLogPath: string,
  jobId: string,
  attempt: number,
  fallbackTimestamp: string,
  jobModel: string | undefined
): Promise<number>
{
  const stream = createReadStream(eventLogPath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let currentModel = jobModel
  let turnIndex = 0
  let written = 0
  for await (const line of lines)
  {
    let event: Record<string, unknown>
    try
    {
      const parsed = JSON.parse(line) as unknown
      if (!isRecord(parsed)) continue
      event = parsed
    }
    catch
    {
      continue
    }
    currentModel = codexEventModel(event) ?? currentModel
    if (event.type !== 'turn.completed') continue
    const source: CodexUsageSource = {
      job_id: jobId,
      attempt,
      turn_index: turnIndex,
      timestamp: fallbackTimestamp,
      provenance: 'backfilled',
      replace_existing: false,
    }
    if (currentModel !== undefined) source.model = currentModel
    const result = await persistCodexUsageEvent(stateDir, event, source)
    if (result === 'written') written += 1
    turnIndex += 1
  }
  return written
}

async function summarizeSidecar(
  directory: string,
  backfilledRecords: number
): Promise<CodexUsageSidecarSummary>
{
  const summary: CodexUsageSidecarSummary = {
    directory,
    records: 0,
    missing_models: 0,
    backfilled_records: backfilledRecords,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  }
  const entries = (await directoryEntries(directory))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries)
  {
    let parsed: unknown
    try
    {
      parsed = JSON.parse(
        await readFile(path.join(directory, entry.name), 'utf8')
      )
    }
    catch
    {
      continue
    }
    if (!isRecord(parsed)) continue
    const usage = codexUsageFromEvent(parsed)
    if (usage === undefined) continue
    summary.records += 1
    if (codexEventModel(parsed) === undefined) summary.missing_models += 1
    summary.input_tokens += usage.input_tokens
    summary.cached_input_tokens += usage.cached_input_tokens
    summary.output_tokens += usage.output_tokens
    summary.reasoning_output_tokens += usage.reasoning_output_tokens
  }
  return summary
}

export async function materializeCodexUsageSidecar(
  stateDir: string
): Promise<CodexUsageSidecarSummary>
{
  const sidecarDirectory = codexUsageSidecarDirectory(stateDir)
  await secureDirectory(sidecarDirectory)
  const jobsDirectory = path.join(stateDir, 'jobs')
  const entries = (await directoryEntries(jobsDirectory))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
  let backfilledRecords = 0

  // terminal records are immutable, so a completion marker avoids rescanning
  // hundreds of megabytes of retained provider logs on every report
  for (const entry of entries)
  {
    let job: StoredJob
    try
    {
      job = await readJson<StoredJob>(
        path.join(jobsDirectory, entry.name, 'job.json')
      )
    }
    catch
    {
      continue
    }
    if (
      job.request?.provider !== 'codex' ||
      job.status === undefined ||
      !TERMINAL_STATUSES.has(job.status)
    )
    {
      continue
    }
    const jobId = nonEmptyString(job.job_id) ?? entry.name
    const attempt = storedJobAttempt(job)
    const markerPath = completionMarkerPath(stateDir, jobId, attempt)
    if (await pathExists(markerPath)) continue

    const eventLogPath = path.join(jobsDirectory, entry.name, 'events.jsonl')
    let fallbackTimestamp: string
    try
    {
      fallbackTimestamp = (await stat(eventLogPath)).mtime.toISOString()
    }
    catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await writePrivateAtomic(markerPath, '')
      continue
    }
    backfilledRecords += await backfillEventLog(
      stateDir,
      eventLogPath,
      jobId,
      attempt,
      fallbackTimestamp,
      storedJobModel(job)
    )
    await writePrivateAtomic(markerPath, '')
  }
  return await summarizeSidecar(sidecarDirectory, backfilledRecords)
}

function combinedCodexHome(
  environment: NodeJS.ProcessEnv,
  sidecarDirectory: string
): string
{
  const configured = environment.CODEX_HOME
  const homes =
    configured === undefined
      ? [path.join(nonEmptyString(environment.HOME) ?? os.homedir(), '.codex')]
      : configured
          .split(',')
          .map((home) => home.trim())
          .filter((home) => home !== '')
  const absoluteSidecar = path.resolve(sidecarDirectory)
  if (!homes.includes(absoluteSidecar)) homes.push(absoluteSidecar)
  return homes.join(',')
}

// the whole point of this command is to run behind a wrapper named `ccusage`
// that sits ahead of the stock binary on PATH, so spawning the bare name would
// re-enter this command forever; resolution walks PATH itself & skips every
// candidate that points back at this package
const CCUSAGE_BINARY_NAME = 'ccusage'
// stock ccusage is a bundled entrypoint & a wrapper is a short script, so the
// head of a candidate is enough to tell them apart
const CCUSAGE_PROBE_BYTES = 65536
// carried into the child so a wrapper that still wins the lookup fails on its
// second entry instead of forking another level
const CCUSAGE_REENTRY_MARKER = 'WORKER_BROKER_CCUSAGE_WRAPPED'
// dist/src/ccusage.js -> the package root a wrapper would name
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

async function readFileHead(filePath: string, bytes: number): Promise<string>
{
  const handle = await open(filePath, 'r')
  try
  {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  }
  finally
  {
    await handle.close()
  }
}

// a candidate re-enters this package when it lives inside it or when its text
// names it; the wrapper shape is `npm --prefix <package> run ccusage`
async function reentersWorkerBroker(candidate: string): Promise<boolean>
{
  let resolved = candidate
  try
  {
    resolved = await realpath(candidate)
  }
  catch
  {
    // an unresolvable link is judged on its text alone
  }
  if (
    resolved === PACKAGE_ROOT ||
    resolved.startsWith(`${PACKAGE_ROOT}${path.sep}`)
  )
  {
    return true
  }
  try
  {
    const head = await readFileHead(resolved, CCUSAGE_PROBE_BYTES)
    return head.includes(PACKAGE_ROOT) || head.includes('worker-broker')
  }
  catch
  {
    return false
  }
}

async function isExecutableFile(candidate: string): Promise<boolean>
{
  try
  {
    if (!(await stat(candidate)).isFile()) return false
    await access(candidate, constants.X_OK)
    return true
  }
  catch
  {
    return false
  }
}

async function resolveCcusageBinary(
  environment: NodeJS.ProcessEnv
): Promise<string>
{
  const configured = nonEmptyString(environment.WORKER_BROKER_CCUSAGE_BINARY)
  if (configured !== undefined) return configured
  const skipped: string[] = []
  for (const directory of (nonEmptyString(environment.PATH) ?? '').split(
    path.delimiter
  ))
  {
    if (directory.trim() === '') continue
    const candidate = path.resolve(directory, CCUSAGE_BINARY_NAME)
    if (!(await isExecutableFile(candidate))) continue
    if (await reentersWorkerBroker(candidate))
    {
      if (!skipped.includes(candidate)) skipped.push(candidate)
      continue
    }
    return candidate
  }
  const wrappers =
    skipped.length === 0
      ? ''
      : ` (skipped ${skipped.join(', ')}: each one runs worker-broker again)`
  throw new Error(
    `no stock ccusage on PATH${wrappers}; install ccusage or set WORKER_BROKER_CCUSAGE_BINARY to the absolute path of the stock binary`
  )
}

export async function runCcusage(
  stateDir: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<number>
{
  if (nonEmptyString(environment[CCUSAGE_REENTRY_MARKER]) !== undefined)
  {
    throw new Error(
      'refusing to re-enter worker-broker ccusage: the resolved ccusage runs this command again; set WORKER_BROKER_CCUSAGE_BINARY to the absolute path of the stock binary'
    )
  }
  // resolved before the sidecar walk so a broken setup fails in milliseconds
  const binary = await resolveCcusageBinary(environment)
  const summary = await materializeCodexUsageSidecar(stateDir)
  const fallback =
    summary.missing_models === 0
      ? ''
      : `; ${summary.missing_models} use ccusage fallback pricing`
  process.stderr.write(
    `worker-broker: included ${summary.records} Codex worker turns${fallback}\n`
  )
  const childEnvironment = {
    ...environment,
    CODEX_HOME: combinedCodexHome(environment, summary.directory),
    [CCUSAGE_REENTRY_MARKER]: '1',
  }
  return await new Promise<number>((resolve, reject) =>
  {
    const child = spawn(binary, args, {
      env: childEnvironment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('close', (exitCode) => resolve(exitCode ?? 1))
  })
}
