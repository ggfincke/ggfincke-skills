// tools/worker-broker/tests/job-store-summary.test.ts
// verify terminal summary caching, fallback, repair, & write serialization

import assert from 'node:assert/strict'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { WorkerJob, WorkerResult } from '../src/contracts.js'
import {
  JobStore,
  STATE_SCHEMA_VERSION,
  SUMMARY_SCHEMA_VERSION,
} from '../src/job-store.js'

function terminalJob(
  jobId: string,
  task = 'cached terminal fixture'
): WorkerJob
{
  const createdAt = '2026-08-01T00:00:00.000Z'
  const startedAt = '2026-08-01T00:00:01.000Z'
  const completedAt = '2026-08-01T00:00:02.000Z'
  const result: WorkerResult = {
    job_id: jobId,
    status: 'completed',
    provider: 'codex',
    mode: 'edit',
    repo: '/repo',
    base_ref: 'HEAD',
    base_sha: 'base-sha',
    summary: 'completed fixture',
    assumptions: [],
    risks: [],
    follow_ups: [],
    changed_files: ['src/result.ts'],
    changes: [{ status: 'M', paths: ['src/result.ts'] }],
    setup: [],
    verification: [],
    scope_violations: [],
    event_log_path: '/job/events.jsonl',
    stderr_path: '/job/provider.stderr.log',
    model_result_path: '/job/model-result.json',
    process_exit_code: 0,
    process_signal: null,
    created_at: createdAt,
    started_at: startedAt,
    completed_at: completedAt,
    elapsed_ms: 1_000,
  }
  return {
    job_id: jobId,
    status: 'completed',
    request: {
      provider: 'codex',
      mode: 'edit',
      repo: '/repo',
      base_ref: 'HEAD',
      task,
      allowed_paths: ['src'],
      acceptance_criteria: [],
      setup_commands: [],
      verification_commands: [],
      depends_on: [],
      allow_nested_agents: false,
    },
    base_sha: 'base-sha',
    branch: `agent/${jobId}`,
    worktree: `/worktrees/${jobId}`,
    created_at: createdAt,
    started_at: startedAt,
    completed_at: completedAt,
    result,
  }
}

async function summaryRecord(
  store: JobStore,
  jobId: string
): Promise<Record<string, unknown>>
{
  return JSON.parse(await readFile(store.summaryPath(jobId), 'utf8')) as Record<
    string,
    unknown
  >
}

test('summary cache falls back for missing, corrupt, newer, stale, and cache-only records', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-summary-'))
  const store = new JobStore(stateDir)
  try
  {
    const longTask = '😀'.repeat(200)
    const longError = 'failure '.repeat(80)
    const missing = terminalJob('missing-summary', longTask)
    assert.ok(missing.result)
    missing.result.error = longError
    missing.result.failure_class = 'model'
    await store.write(missing)
    await unlink(store.summaryPath(missing.job_id))
    const bounded = await store.readSummary(missing.job_id)
    assert.equal(bounded.status, 'completed')
    assert.equal([...bounded.task_preview].length, 161)
    assert.equal(bounded.task_bytes, Buffer.byteLength(longTask, 'utf8'))
    assert.equal([...(bounded.error_preview ?? '')].length, 241)
    assert.equal(bounded.error_bytes, Buffer.byteLength(longError, 'utf8'))
    assert.equal(bounded.changed_file_count, 1)
    assert.equal(bounded.scope_violation_count, 0)
    assert.equal(bounded.failure_class, 'model')
    assert.equal(bounded.elapsed_ms, 1_000)
    assert.equal(
      (await summaryRecord(store, missing.job_id)).summary_schema_version,
      SUMMARY_SCHEMA_VERSION
    )

    const corrupt = terminalJob('corrupt-summary')
    await store.write(corrupt)
    await writeFile(store.summaryPath(corrupt.job_id), '{broken')
    assert.equal(
      (await store.readSummary(corrupt.job_id)).job_id,
      corrupt.job_id
    )
    assert.equal(
      (await summaryRecord(store, corrupt.job_id)).summary_schema_version,
      SUMMARY_SCHEMA_VERSION
    )

    const newer = terminalJob('newer-summary')
    await store.write(newer)
    await writeFile(
      store.summaryPath(newer.job_id),
      `${JSON.stringify({
        ...(await summaryRecord(store, newer.job_id)),
        summary_schema_version: SUMMARY_SCHEMA_VERSION + 1,
      })}\n`
    )
    assert.equal((await store.readSummary(newer.job_id)).job_id, newer.job_id)
    assert.equal(
      (await summaryRecord(store, newer.job_id)).summary_schema_version,
      SUMMARY_SCHEMA_VERSION
    )

    const wrongId = terminalJob('wrong-id-summary')
    await store.write(wrongId)
    await writeFile(
      store.summaryPath(wrongId.job_id),
      `${JSON.stringify({
        ...(await summaryRecord(store, wrongId.job_id)),
        job_id: 'different-job',
      })}\n`
    )
    assert.equal(
      (await store.readSummary(wrongId.job_id)).job_id,
      wrongId.job_id
    )

    const nonterminal = terminalJob('nonterminal-summary')
    await store.write(nonterminal)
    await writeFile(
      store.summaryPath(nonterminal.job_id),
      `${JSON.stringify({
        ...(await summaryRecord(store, nonterminal.job_id)),
        status: 'running',
      })}\n`
    )
    assert.equal(
      (await store.readSummary(nonterminal.job_id)).status,
      'completed'
    )

    const stale = terminalJob('stale-summary')
    await store.write(stale)
    const authoritative = JSON.parse(
      await readFile(store.jobPath(stale.job_id), 'utf8')
    ) as { request: { task: string } }
    authoritative.request.task = 'authoritative task after stale cache'
    await writeFile(
      store.jobPath(stale.job_id),
      `${JSON.stringify(authoritative, null, 2)}\n`
    )
    assert.equal(
      (await store.readSummary(stale.job_id)).task_preview,
      'authoritative task after stale cache'
    )

    const ghostId = 'cache-only-ghost'
    await mkdir(store.jobDir(ghostId), { recursive: true })
    await writeFile(store.summaryPath(ghostId), '{}\n')
    assert.equal(
      (await store.listSummaries()).some(
        (summary) => summary.job_id === ghostId
      ),
      false
    )

    const originalRead = store.read.bind(store)
    store.read = async (jobId) =>
    {
      if (jobId === stale.job_id)
      {
        throw new Error('terminal summary path parsed the full record')
      }
      return await originalRead(jobId)
    }
    try
    {
      assert.equal((await store.readSummary(stale.job_id)).status, 'completed')
      assert.ok(
        (await store.listSummaries()).some(
          (summary) => summary.job_id === stale.job_id
        )
      )
    }
    finally
    {
      store.read = originalRead
    }
  }
  finally
  {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('summary write failure preserves the authoritative terminal mutation and removes stale cache', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-summary-'))
  const store = new JobStore(stateDir)
  const internals = store as unknown as {
    writeSummaryPayload(jobId: string, payload: string): Promise<void>
  }
  try
  {
    const original = terminalJob('summary-write-failure', 'old projection')
    await store.write(original)
    const writeSummaryPayload = internals.writeSummaryPayload.bind(store)
    internals.writeSummaryPayload = async () =>
    {
      throw new Error('injected summary promotion failure')
    }
    const updated = terminalJob(
      original.job_id,
      'authoritative projection after summary failure'
    )
    try
    {
      await store.write(updated)
    }
    finally
    {
      internals.writeSummaryPayload = writeSummaryPayload
    }
    await assert.rejects(
      access(store.summaryPath(original.job_id)),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )
    assert.equal(
      (await store.read(original.job_id)).request.task,
      updated.request.task
    )
    assert.equal(
      (await store.readSummary(original.job_id)).task_preview,
      updated.request.task
    )
  }
  finally
  {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('summary cache cannot bypass a newer authoritative state version', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-summary-'))
  const store = new JobStore(stateDir)
  const job = terminalJob('newer-state-with-summary')
  try
  {
    await store.write(job)
    const persisted = JSON.parse(
      await readFile(store.jobPath(job.job_id), 'utf8')
    ) as Record<string, unknown>
    persisted.state_schema_version = STATE_SCHEMA_VERSION + 1
    await writeFile(
      store.jobPath(job.job_id),
      `${JSON.stringify(persisted, null, 2)}\n`
    )

    const metadata = await stat(store.jobPath(job.job_id), { bigint: true })
    const cached = await summaryRecord(store, job.job_id)
    // a current-looking cache must not override the authoritative version
    cached.state_schema_version = STATE_SCHEMA_VERSION
    cached.job_mtime_ns = metadata.mtimeNs.toString()
    cached.job_size = metadata.size.toString()
    cached.job_ino = metadata.ino.toString()
    await writeFile(
      store.summaryPath(job.job_id),
      `${JSON.stringify(cached, null, 2)}\n`
    )

    for (const operation of [
      async () => await store.readSummary(job.job_id),
      async () => await store.listSummaries(),
      async () => await store.read(job.job_id),
    ])
    {
      await assert.rejects(
        operation,
        /state schema version 2.*supports only version 1/u
      )
    }
  }
  finally
  {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('legacy terminal records become warm without rewriting authoritative state', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-summary-'))
  const store = new JobStore(stateDir)
  const originalRead = store.read.bind(store)
  let fullReads = 0
  store.read = async (jobId) =>
  {
    fullReads += 1
    return await originalRead(jobId)
  }
  try
  {
    for (const legacyVersion of [undefined, 0] as const)
    {
      const suffix = legacyVersion === undefined ? 'absent' : 'zero'
      const job = terminalJob(`legacy-state-${suffix}`)
      await store.write(job)
      const persisted = JSON.parse(
        await readFile(store.jobPath(job.job_id), 'utf8')
      ) as Record<string, unknown>
      if (legacyVersion === undefined) delete persisted.state_schema_version
      else persisted.state_schema_version = legacyVersion
      const authoritativeBytes = `${JSON.stringify(persisted, null, 2)}\n`
      await writeFile(store.jobPath(job.job_id), authoritativeBytes)
      await unlink(store.summaryPath(job.job_id))

      const readsBefore = fullReads
      assert.equal((await store.readSummary(job.job_id)).status, 'completed')
      assert.equal(fullReads, readsBefore + 1)
      assert.equal(
        (await summaryRecord(store, job.job_id)).state_schema_version,
        STATE_SCHEMA_VERSION
      )
      assert.equal(
        await readFile(store.jobPath(job.job_id), 'utf8'),
        authoritativeBytes
      )

      assert.equal((await store.readSummary(job.job_id)).status, 'completed')
      assert.ok(
        (await store.listSummaries()).some(
          (summary) => summary.job_id === job.job_id
        )
      )
      assert.equal(fullReads, readsBefore + 1)
    }
  }
  finally
  {
    store.read = originalRead
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('summary fallback linearizes behind a concurrent terminal write', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-summary-'))
  const store = new JobStore(stateDir)
  const internals = store as unknown as {
    writeJobPayload(jobId: string, payload: string): Promise<void>
  }
  let releaseWrite = (): void => undefined
  let markWriteEntered = (): void => undefined
  const writeGate = new Promise<void>((resolve) =>
  {
    releaseWrite = resolve
  })
  const writeEntered = new Promise<void>((resolve) =>
  {
    markWriteEntered = resolve
  })
  let writing: Promise<void> | undefined
  try
  {
    const queued = terminalJob('concurrent-terminal-write')
    queued.status = 'queued'
    delete queued.completed_at
    delete queued.result
    await store.write(queued)

    const writeJobPayload = internals.writeJobPayload.bind(store)
    internals.writeJobPayload = async (jobId, payload) =>
    {
      markWriteEntered()
      await writeGate
      await writeJobPayload(jobId, payload)
    }
    writing = store.write(
      terminalJob(queued.job_id, 'terminal projection wins')
    )
    await writeEntered
    let summarySettled = false
    const reading = store.readSummary(queued.job_id).then((summary) =>
    {
      summarySettled = true
      return summary
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.equal(summarySettled, false)
    releaseWrite()
    await writing
    assert.equal((await reading).task_preview, 'terminal projection wins')
    internals.writeJobPayload = writeJobPayload
  }
  finally
  {
    releaseWrite()
    await writing?.catch(() => undefined)
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('job ids cannot escape the store directory or disagree with it', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'broker-job-id-'))
  const store = new JobStore(stateDir)
  try
  {
    await mkdir(store.jobsDir, { recursive: true })
    await mkdir(store.worktreesDir, { recursive: true })
    await mkdir(path.join(store.jobsDir, 'Not_Safe'), { recursive: true })
    await mkdir(path.join(store.worktreesDir, 'Also_Bad'), { recursive: true })
    await writeFile(
      path.join(store.jobsDir, 'Not_Safe', 'job.json'),
      `${JSON.stringify(terminalJob('safe-placeholder'), null, 2)}\n`
    )
    await store.initialize()

    assert.throws(() => store.jobDir('../escape'), /invalid job id/u)
    assert.throws(() => store.jobDir('/tmp/evil'), /invalid job id/u)
    assert.throws(() => store.worktreePath('../escape'), /invalid job id/u)
    assert.throws(() => store.worktreePath('/tmp/evil'), /invalid job id/u)
    await assert.rejects(store.readSummary('../escape'), /invalid job id/u)
    await assert.rejects(store.readSummary('/tmp/evil'), /invalid job id/u)
    await assert.rejects(store.read('../escape'), /invalid job id/u)
    await assert.rejects(
      access(path.join(stateDir, 'escape')),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )
    await assert.rejects(
      access(path.join('/tmp', 'evil', 'job.json')),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )
    await assert.rejects(
      access(path.join('/tmp', 'evil', 'summary.json')),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )

    const directoryId = 'mismatch-dir'
    await mkdir(store.jobDir(directoryId), { recursive: true })
    await writeFile(
      store.jobPath(directoryId),
      `${JSON.stringify(terminalJob('../escape'), null, 2)}\n`
    )
    await assert.rejects(
      store.readSummary(directoryId),
      /does not match directory mismatch-dir/u
    )
    await assert.rejects(
      store.read(directoryId),
      /does not match directory mismatch-dir/u
    )
    await assert.rejects(
      access(store.summaryPath(directoryId)),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )
    await assert.rejects(
      access(path.join(stateDir, 'escape', 'summary.json')),
      (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
    )
    await rm(store.jobDir(directoryId), { recursive: true, force: true })

    const ok = terminalJob('safe-job')
    await store.write(ok)
    const listed = await store.listSummaries()
    assert.equal(
      listed.some((summary) => summary.job_id === 'safe-placeholder'),
      false
    )
    assert.equal(
      listed.some((summary) => summary.job_id === 'safe-job'),
      true
    )
  }
  finally
  {
    await rm(stateDir, { recursive: true, force: true })
  }
})
