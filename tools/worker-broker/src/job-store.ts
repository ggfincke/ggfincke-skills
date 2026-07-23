// tools/worker-broker/src/job-store.ts
// persist job state atomically & expose durable artifacts to later frontends

import { readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  PRIVATE_FILE_MODE,
  secureDirectory,
  securePrivateFile,
} from './artifact.js'
import type { WorkerJob } from './contracts.js'

async function secureJobDirectory(directory: string): Promise<void> {
  await secureDirectory(directory)
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) await secureJobDirectory(entryPath)
      else if (entry.isFile()) await securePrivateFile(entryPath)
    }),
  )
}

export class JobStore {
  readonly stateDir: string
  readonly jobsDir: string
  readonly worktreesDir: string
  private readonly pendingWrites = new Map<string, Promise<void>>()
  private initialization: Promise<void> | undefined

  constructor(stateDir: string) {
    this.stateDir = stateDir
    this.jobsDir = path.join(stateDir, 'jobs')
    this.worktreesDir = path.join(stateDir, 'worktrees')
  }

  async initialize(): Promise<void> {
    this.initialization ??= this.initializeOnce()
    await this.initialization
  }

  private async initializeOnce(): Promise<void> {
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
        .map(async (entry) => await secureJobDirectory(this.jobDir(entry.name))),
      ...worktrees
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => await secureDirectory(this.worktreePath(entry.name))),
    ])
  }

  jobDir(jobId: string): string {
    return path.join(this.jobsDir, jobId)
  }

  jobPath(jobId: string): string {
    return path.join(this.jobDir(jobId), 'job.json')
  }

  worktreePath(jobId: string): string {
    return path.join(this.worktreesDir, jobId)
  }

  async write(job: WorkerJob): Promise<void> {
    await this.initialize()
    const payload = `${JSON.stringify(job, null, 2)}\n`
    const previous = this.pendingWrites.get(job.job_id) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(async () => {
      await this.writePayload(job.job_id, payload)
    })
    this.pendingWrites.set(job.job_id, pending)
    try {
      await pending
    } finally {
      if (this.pendingWrites.get(job.job_id) === pending) {
        this.pendingWrites.delete(job.job_id)
      }
    }
  }

  private async writePayload(jobId: string, payload: string): Promise<void> {
    const jobDirectory = this.jobDir(jobId)
    await secureDirectory(jobDirectory)
    const destination = this.jobPath(jobId)
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, payload, { mode: PRIVATE_FILE_MODE })
    await rename(temporary, destination)
  }

  async read(jobId: string): Promise<WorkerJob> {
    await this.initialize()
    return JSON.parse(await readFile(this.jobPath(jobId), 'utf8')) as WorkerJob
  }

  async list(): Promise<WorkerJob[]> {
    await this.initialize()
    const entries = await readdir(this.jobsDir, { withFileTypes: true })
    const jobs = await Promise.all(
      entries.filter((entry) => entry.isDirectory()).map((entry) => this.read(entry.name)),
    )
    return jobs.sort((left, right) => right.created_at.localeCompare(left.created_at))
  }
}
