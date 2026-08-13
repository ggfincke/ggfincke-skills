// tools/worker-broker/src/job-store.ts
// persist job state atomically & expose durable artifacts to later frontends

import { open, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import {
  PRIVATE_FILE_MODE,
  secureDirectory,
  securePrivateFile,
} from './artifact.js'
import {
  TERMINAL_WORKER_STATUSES,
  type WorkerJob,
  type WorkerStatus,
  type WorkerSummary,
} from './contracts.js'
import { readJson, serializePrettyJson } from './json.js'
import { summarizeWorkerJob, WorkerSummarySchema } from './worker-summary.js'

export const STATE_SCHEMA_VERSION = 1
export const SUMMARY_SCHEMA_VERSION = 2

// minted createJobId values are kebab-case; the cap keeps them one path segment
export const JOB_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
export const JOB_ID_MAX_LENGTH = 64

export function isSafeJobId(jobId: string): boolean
{
  return jobId.length <= JOB_ID_MAX_LENGTH && JOB_ID_PATTERN.test(jobId)
}

function assertSafeJobId(jobId: string): void
{
  if (!isSafeJobId(jobId))
  {
    throw new Error(`invalid job id: ${jobId}`)
  }
}

type StoredWorkerJob = WorkerJob & { state_schema_version?: number }
const TERMINAL_STATUSES = new Set<WorkerStatus>(TERMINAL_WORKER_STATUSES)
const StoredWorkerSummarySchema = WorkerSummarySchema.extend({
  summary_schema_version: z.number().int(),
  state_schema_version: z.number().int(),
  job_mtime_ns: z.string().regex(/^\d+$/u),
  job_size: z.string().regex(/^\d+$/u),
  job_ino: z.string().regex(/^\d+$/u),
}).strict()

interface JobFingerprint
{
  job_mtime_ns: string
  job_size: string
  job_ino: string
  authoritative_state_schema_version?: number
}

const JOB_SCHEMA_TAIL_BYTES = 512

function isReadableStateSchemaVersion(version: number | undefined): boolean
{
  return (
    version === undefined ||
    (Number.isInteger(version) &&
      version >= 0 &&
      version <= STATE_SCHEMA_VERSION)
  )
}

async function secureJobDirectory(directory: string): Promise<void>
{
  await secureDirectory(directory)
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) =>
    {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await secureJobDirectory(entryPath)
      else if (entry.isFile()) await securePrivateFile(entryPath)
    })
  )
}

// read-time normalization leaves job.json byte-for-byte authoritative
function normalizeStoredJob(stored: StoredWorkerJob, jobId: string): WorkerJob
{
  if (stored.job_id !== jobId)
  {
    throw new Error(
      `stored job_id ${stored.job_id} does not match directory ${jobId}`
    )
  }
  const version = stored.state_schema_version
  if (version !== undefined)
  {
    if (!Number.isInteger(version) || version < 0)
    {
      throw new Error(
        `job ${jobId} has invalid state schema version: ${String(version)}`
      )
    }
    if (version > STATE_SCHEMA_VERSION)
    {
      throw new Error(
        `job ${jobId} uses state schema version ${version}, but this worker-broker build supports only version ${STATE_SCHEMA_VERSION}`
      )
    }
  }
  const { state_schema_version: _stateSchemaVersion, ...job } = stored
  const request = job.request as Partial<WorkerJob['request']>
  request.setup_commands ??= []
  request.verification_commands ??= []
  request.acceptance_criteria ??= []
  request.allowed_paths ??= []
  request.depends_on ??= []
  return job
}

export class JobStore
{
  readonly stateDir: string
  readonly jobsDir: string
  readonly worktreesDir: string
  private readonly pendingWrites = new Map<string, Promise<void>>()
  private initialization: Promise<void> | undefined

  constructor(stateDir: string)
  {
    this.stateDir = stateDir
    this.jobsDir = path.join(stateDir, 'jobs')
    this.worktreesDir = path.join(stateDir, 'worktrees')
  }

  async initialize(): Promise<void>
  {
    this.initialization ??= this.initializeOnce()
    await this.initialization
  }

  private async initializeOnce(): Promise<void>
  {
    await secureDirectory(this.stateDir)
    await Promise.all([
      secureDirectory(this.jobsDir),
      secureDirectory(this.worktreesDir),
    ])
    const [jobs, worktrees] = await Promise.all([
      readdir(this.jobsDir, { withFileTypes: true }),
      readdir(this.worktreesDir, { withFileTypes: true }),
    ])
    await Promise.all([
      ...jobs
        .filter((entry) => entry.isDirectory() && isSafeJobId(entry.name))
        .map(
          async (entry) => await secureJobDirectory(this.jobDir(entry.name))
        ),
      ...worktrees
        .filter((entry) => entry.isDirectory() && isSafeJobId(entry.name))
        .map(
          async (entry) => await secureDirectory(this.worktreePath(entry.name))
        ),
    ])
  }

  jobDir(jobId: string): string
  {
    assertSafeJobId(jobId)
    return path.join(this.jobsDir, jobId)
  }

  jobPath(jobId: string): string
  {
    return path.join(this.jobDir(jobId), 'job.json')
  }

  summaryPath(jobId: string): string
  {
    return path.join(this.jobDir(jobId), 'summary.json')
  }

  worktreePath(jobId: string): string
  {
    assertSafeJobId(jobId)
    return path.join(this.worktreesDir, jobId)
  }

  async write(job: WorkerJob): Promise<void>
  {
    await this.initialize()
    const jobId = job.job_id
    const terminal = TERMINAL_STATUSES.has(job.status)
    let summary: WorkerSummary | undefined
    if (terminal)
    {
      try
      {
        summary = summarizeWorkerJob(job)
      }
      catch
      {
        // a cache projection defect cannot reject the authoritative write
      }
    }
    const payload = serializePrettyJson({
      ...job,
      state_schema_version: STATE_SCHEMA_VERSION,
    })
    await this.withJobOperation(jobId, async () =>
    {
      await this.writeJobPayload(jobId, payload)
      if (summary !== undefined)
      {
        await this.writeSummaryBestEffort(jobId, summary)
      }
      else
      {
        await this.removeSummaryBestEffort(jobId)
      }
    })
  }

  private async withJobOperation<T>(
    jobId: string,
    operation: () => Promise<T>
  ): Promise<T>
  {
    const previous = this.pendingWrites.get(jobId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.pendingWrites.set(jobId, tail)
    try
    {
      return await result
    }
    finally
    {
      if (this.pendingWrites.get(jobId) === tail)
      {
        this.pendingWrites.delete(jobId)
      }
    }
  }

  private async writeJobPayload(jobId: string, payload: string): Promise<void>
  {
    const jobDirectory = this.jobDir(jobId)
    await secureDirectory(jobDirectory)
    await this.writeAtomic(this.jobPath(jobId), payload)
  }

  private async writeSummaryPayload(
    jobId: string,
    payload: string
  ): Promise<void>
  {
    await this.writeAtomic(this.summaryPath(jobId), payload)
  }

  private async writeAtomic(
    destination: string,
    payload: string
  ): Promise<void>
  {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, payload, { mode: PRIVATE_FILE_MODE })
    await rename(temporary, destination)
  }

  private async fingerprint(jobId: string): Promise<JobFingerprint>
  {
    const file = await open(this.jobPath(jobId), 'r')
    try
    {
      const metadata = await file.stat({ bigint: true })
      const tailLength = Number(
        metadata.size < BigInt(JOB_SCHEMA_TAIL_BYTES)
          ? metadata.size
          : BigInt(JOB_SCHEMA_TAIL_BYTES)
      )
      const tail = Buffer.alloc(tailLength)
      await file.read(tail, 0, tailLength, Number(metadata.size) - tailLength)
      const version = tail
        .toString('utf8')
        .match(/"state_schema_version"\s*:\s*(-?\d+)\s*\}\s*$/u)?.[1]
      return {
        job_mtime_ns: metadata.mtimeNs.toString(),
        job_size: metadata.size.toString(),
        job_ino: metadata.ino.toString(),
        ...(version === undefined
          ? {}
          : { authoritative_state_schema_version: Number(version) }),
      }
    }
    finally
    {
      await file.close()
    }
  }

  private async writeSummaryBestEffort(
    jobId: string,
    summary: WorkerSummary
  ): Promise<void>
  {
    try
    {
      const fingerprint = await this.fingerprint(jobId)
      if (
        !isReadableStateSchemaVersion(
          fingerprint.authoritative_state_schema_version
        )
      )
      {
        throw new Error('authoritative job schema is not cache-compatible')
      }
      const {
        authoritative_state_schema_version: _authoritativeStateSchemaVersion,
        ...storedFingerprint
      } = fingerprint
      const payload = serializePrettyJson({
        ...summary,
        summary_schema_version: SUMMARY_SCHEMA_VERSION,
        state_schema_version: STATE_SCHEMA_VERSION,
        ...storedFingerprint,
      })
      await this.writeSummaryPayload(jobId, payload)
    }
    catch
    {
      await this.removeSummaryBestEffort(jobId)
    }
  }

  private async removeSummaryBestEffort(jobId: string): Promise<void>
  {
    await unlink(this.summaryPath(jobId)).catch(() => undefined)
  }

  async read(jobId: string): Promise<WorkerJob>
  {
    await this.initialize()
    return normalizeStoredJob(
      await readJson<StoredWorkerJob>(this.jobPath(jobId)),
      jobId
    )
  }

  private async readCachedSummary(
    jobId: string
  ): Promise<WorkerSummary | undefined>
  {
    let raw: unknown
    let fingerprint: JobFingerprint
    try
    {
      ;[raw, fingerprint] = await Promise.all([
        readJson<unknown>(this.summaryPath(jobId)),
        this.fingerprint(jobId),
      ])
    }
    catch
    {
      return undefined
    }
    const parsed = StoredWorkerSummarySchema.safeParse(raw)
    if (!parsed.success) return undefined
    const stored = parsed.data
    if (
      stored.summary_schema_version !== SUMMARY_SCHEMA_VERSION ||
      stored.state_schema_version !== STATE_SCHEMA_VERSION ||
      !isReadableStateSchemaVersion(
        fingerprint.authoritative_state_schema_version
      ) ||
      stored.job_id !== jobId ||
      !TERMINAL_STATUSES.has(stored.status) ||
      stored.job_mtime_ns !== fingerprint.job_mtime_ns ||
      stored.job_size !== fingerprint.job_size ||
      stored.job_ino !== fingerprint.job_ino
    )
    {
      return undefined
    }
    const {
      summary_schema_version: _summarySchemaVersion,
      state_schema_version: _stateSchemaVersion,
      job_mtime_ns: _jobMtimeNs,
      job_size: _jobSize,
      job_ino: _jobIno,
      ...summary
    } = stored
    return summary
  }

  async readSummary(jobId: string): Promise<WorkerSummary>
  {
    await this.initialize()
    return await this.withJobOperation(jobId, async () =>
    {
      const cached = await this.readCachedSummary(jobId)
      if (cached !== undefined) return cached
      const job = await this.read(jobId)
      const summary = summarizeWorkerJob(job)
      if (TERMINAL_STATUSES.has(job.status))
      {
        await this.writeSummaryBestEffort(jobId, summary)
      }
      else
      {
        await this.removeSummaryBestEffort(jobId)
      }
      return summary
    })
  }

  async listSummaries(
    excludedJobIds: ReadonlySet<string> = new Set()
  ): Promise<WorkerSummary[]>
  {
    await this.initialize()
    const entries = await readdir(this.jobsDir, { withFileTypes: true })
    const summaries = await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            isSafeJobId(entry.name) &&
            !excludedJobIds.has(entry.name)
        )
        .map(async (entry) =>
        {
          try
          {
            return await this.readSummary(entry.name)
          }
          catch (error)
          {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT')
              return undefined
            throw error
          }
        })
    )
    return summaries
      .filter((summary): summary is WorkerSummary => summary !== undefined)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
  }
}
