// tools/worker-broker/tests/worker-result-schema.test.ts
// validate real terminal broker results against the portable result schema

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../src/contracts.js'
import { JobManager } from '../src/job-manager.js'
import { initializeTestRepo, waitUntil } from './helpers.js'

class ParityProvider implements WorkerProvider
{
  readonly name = 'codex' as const
  readonly started = new Set<string>()

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    this.started.add(context.job_id)
    if (context.request.task === 'return a provider failure')
    {
      return { exit_code: 1, signal: null }
    }
    if (context.request.task === 'return a scope rejection')
    {
      await writeFile(path.join(context.worktree, 'outside.txt'), 'outside\n')
    }
    if (context.request.task === 'wait for cancellation')
    {
      return await new Promise<ProviderOutcome>((resolve) =>
      {
        context.signal.addEventListener(
          'abort',
          () => resolve({ exit_code: null, signal: 'SIGTERM' }),
          { once: true }
        )
      })
    }
    return {
      exit_code: 0,
      signal: null,
      effective_model: 'effective-fixture',
      model_result: {
        summary: 'completed fixture',
        assumptions: [],
        risks: [],
        follow_ups: [],
      },
    }
  }
}

function config(stateDir: string): BrokerConfig
{
  return {
    state_dir: stateDir,
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
    claude_binary: 'claude',
  }
}

test('portable schema accepts every real terminal JobManager result shape', async () =>
{
  const repo = await initializeTestRepo()
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'worker-schema-'))
  const provider = new ParityProvider()
  const manager = new JobManager(config(stateDir), [provider])
  try
  {
    const completedAdmission = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'return a completed result',
      allowed_paths: ['src'],
      model: 'requested-fixture',
      effort: 'high',
      stage: 'implementation',
      workflow: 'standard',
      run: 'schema-parity',
    })
    await manager.waitForTerminal(completedAdmission.job.job_id)
    const completed = await manager.get(completedAdmission.job.job_id)
    const failedAdmission = await manager.start({
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'return a provider failure',
      allowed_paths: [],
    })
    await manager.waitForTerminal(failedAdmission.job.job_id)
    const failed = await manager.get(failedAdmission.job.job_id)
    const rejectedAdmission = await manager.start({
      provider: 'codex',
      mode: 'edit',
      repo,
      task: 'return a scope rejection',
      allowed_paths: ['src'],
    })
    await manager.waitForTerminal(rejectedAdmission.job.job_id)
    const rejected = await manager.get(rejectedAdmission.job.job_id)
    const cancelledAdmission = await manager.start({
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'wait for cancellation',
      allowed_paths: [],
    })
    await waitUntil(() => provider.started.has(cancelledAdmission.job.job_id))
    await manager.cancel(cancelledAdmission.job.job_id)
    await manager.waitForTerminal(cancelledAdmission.job.job_id)
    const cancelled = await manager.get(cancelledAdmission.job.job_id)

    assert.equal(completed.status, 'completed')
    assert.equal(completed.result?.stage, 'implementation')
    assert.equal(completed.result?.workflow, 'standard')
    assert.equal(completed.result?.run, 'schema-parity')
    assert.equal(completed.result?.model, 'requested-fixture')
    assert.equal(completed.result?.effort, 'high')
    assert.equal(completed.result?.effective_model, 'effective-fixture')
    assert.equal(failed.status, 'failed')
    assert.equal(failed.result?.failure_class, 'model')
    assert.equal(failed.result?.model, undefined)
    assert.equal(failed.result?.effort, undefined)
    assert.equal(failed.result?.effective_model, undefined)
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.result?.failure_class, 'scope')
    assert.equal(cancelled.status, 'cancelled')
    const schemaPath = fileURLToPath(
      new URL(
        '../../../../skills/orchestrate/assets/worker-result.schema.json',
        import.meta.url
      )
    )
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as Record<
      string,
      unknown
    >
    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    })
    const validate = ajv.compile(schema)
    for (const job of [completed, failed, rejected, cancelled])
    {
      const result = job.result
      assert.ok(result)
      assert.equal(
        validate(result),
        true,
        `${job.status}: ${ajv.errorsText(validate.errors)}`
      )
    }
  }
  finally
  {
    await manager.shutdown().catch(() => undefined)
    await rm(repo, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  }
})
