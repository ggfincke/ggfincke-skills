// tools/worker-broker/src/job-store.ts
// persist job state atomically & expose durable artifacts to later frontends

import { readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  PRIVATE_FILE_MODE,
  secureDirectory,
  securePrivateFile,
} from './artifact.js'
import type { WorkerJob } from './contracts.js'
import { STATE_SCHEMA_VERSION } from './daemon/protocol.js'
import { readJson, serializePrettyJson } from './json.js'

type StoredWorkerJob = WorkerJob & { state_schema_version?: number }

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

// a record written by an older broker lacks fields later versions added; fill
// the list-valued ones so scheduling never dereferences an absent array
function migrateJob(stored: StoredWorkerJob, jobId: string): WorkerJob
{
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
        .filter((entry) => entry.isDirectory())
        .map(
          async (entry) => await secureJobDirectory(this.jobDir(entry.name))
        ),
      ...worktrees
        .filter((entry) => entry.isDirectory())
        .map(
          async (entry) => await secureDirectory(this.worktreePath(entry.name))
        ),
    ])
  }

  jobDir(jobId: string): string
  {
    return path.join(this.jobsDir, jobId)
  }

  jobPath(jobId: string): string
  {
    return path.join(this.jobDir(jobId), 'job.json')
  }

  worktreePath(jobId: string): string
  {
    return path.join(this.worktreesDir, jobId)
  }

  async write(job: WorkerJob): Promise<void>
  {
    await this.initialize()
    const payload = serializePrettyJson({
      ...job,
      state_schema_version: STATE_SCHEMA_VERSION,
    })
    const previous = this.pendingWrites.get(job.job_id) ?? Promise.resolve()
    const pending = previous
      .catch(() => undefined)
      .then(async () =>
      {
        await this.writePayload(job.job_id, payload)
      })
    this.pendingWrites.set(job.job_id, pending)
    try
    {
      await pending
    }
    finally
    {
      if (this.pendingWrites.get(job.job_id) === pending)
      {
        this.pendingWrites.delete(job.job_id)
      }
    }
  }

  private async writePayload(jobId: string, payload: string): Promise<void>
  {
    const jobDirectory = this.jobDir(jobId)
    await secureDirectory(jobDirectory)
    const destination = this.jobPath(jobId)
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, payload, { mode: PRIVATE_FILE_MODE })
    await rename(temporary, destination)
  }

  async read(jobId: string): Promise<WorkerJob>
  {
    await this.initialize()
    return migrateJob(
      await readJson<StoredWorkerJob>(this.jobPath(jobId)),
      jobId
    )
  }

  async list(): Promise<WorkerJob[]>
  {
    await this.initialize()
    const entries = await readdir(this.jobsDir, { withFileTypes: true })
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.read(entry.name))
    )
    return jobs.sort((left, right) =>
      right.created_at.localeCompare(left.created_at)
    )
  }
}
