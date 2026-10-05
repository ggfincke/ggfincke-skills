// tools/worker-broker/tests/run-policy.test.ts
// protect durable consent budgets and power-sensitive local scheduling

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JobManager } from '../src/job-manager.js'
import { defaultBrokerConfig } from '../src/config.js'
import type { ProviderOutcome, WorkerProvider } from '../src/contracts.js'
import type { PowerState } from '../src/local-policy.js'
import { RunStore } from '../src/run-store.js'
import { initializeTestRepo, waitUntil } from './helpers.js'

const success: ProviderOutcome = {
  exit_code: 0,
  signal: null,
  model_result: {
    summary: 'read fixture',
    assumptions: [],
    risks: [],
    follow_ups: [],
  },
}

test('run admission preserves scope and spent budget across concurrency, cancellation, and restart', async () =>
{
  const repo = await initializeTestRepo()
  const state = await mkdtemp(path.join(os.tmpdir(), 'broker-run-policy-'))
  const config = { ...defaultBrokerConfig({}), state_dir: state }
  const provider: WorkerProvider = { name: 'codex', run: async () => success }
  const manager = new JobManager(config, [provider])
  try
  {
    const request = {
      provider: 'codex',
      repo,
      mode: 'read',
      allowed_paths: [],
      task: 'read fixture',
    }
    await assert.rejects(manager.start(request), /run/u)
    const run = await manager.createRun({
      repo,
      targets: [{ provider: 'codex', model: 'fixture' }],
    })
    await assert.rejects(
      manager.start({ ...request, run: run.id, model: 'other' }),
      /scope/u
    )
    await assert.rejects(
      manager.start({
        ...request,
        run: run.id,
        mode: 'edit',
        allowed_paths: ['README.md'],
      }),
      /scope/u
    )
    assert.equal((await manager.runDetails(run.id)).spent, 0)
    const write = manager.store.write.bind(manager.store)
    manager.store.write = async () =>
    {
      throw new Error('injected admission write failure')
    }
    await assert.rejects(
      manager.start({ ...request, run: run.id }),
      /write failure/u
    )
    manager.store.write = write
    assert.equal((await manager.runDetails(run.id)).spent, 0)
    const admissions = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        manager.start({ ...request, run: run.id })
      )
    )
    assert.equal(
      admissions.filter((entry) => entry.status === 'fulfilled').length,
      4
    )
    assert.equal((await manager.runDetails(run.id)).remaining, 0)
    await manager.shutdown()
    const restarted = new JobManager(config, [provider])
    try
    {
      assert.equal((await restarted.runDetails(run.id)).spent, 4)
      await assert.rejects(
        restarted.start({ ...request, run: run.id }),
        /budget/u
      )
      await restarted.closeRun(run.id)
      await assert.rejects(
        restarted.start({ ...request, run: run.id }),
        /closed/u
      )
      const expired = await restarted.createRun({
        repo,
        targets: [{ provider: 'codex', model: 'fixture' }],
      })
      await new RunStore(state).write({
        ...expired,
        expires_at: new Date(0).toISOString(),
      })
      await assert.rejects(
        restarted.start({ ...request, run: expired.id }),
        /expired/u
      )
    }
    finally
    {
      await restarted.shutdown()
    }
  }
  finally
  {
    await manager.shutdown()
    await rm(repo, { recursive: true, force: true })
    await rm(state, { recursive: true, force: true })
  }
})

test('local workers serialize across runs and unplug cancels queued and running work without resuming', async () =>
{
  const repo = await initializeTestRepo()
  const state = await mkdtemp(path.join(os.tmpdir(), 'broker-power-policy-'))
  let power: PowerState = 'ac'
  const started: string[] = []
  const provider: WorkerProvider = {
    name: 'coral',
    run: async (context) =>
    {
      started.push(context.job_id)
      return await new Promise((resolve) =>
        context.signal.addEventListener(
          'abort',
          () => resolve({ exit_code: null, signal: 'SIGTERM' }),
          { once: true }
        )
      )
    },
  }
  const manager = new JobManager(
    { ...defaultBrokerConfig({}), state_dir: state },
    [provider],
    {
      power: async () => power,
      models: async () => ['local-fixture'],
    }
  )
  try
  {
    const input = {
      repo,
      targets: [{ provider: 'coral', model: 'local-fixture' }],
    }
    const first = await manager.createRun(input)
    const second = await manager.createRun(input)
    const request = {
      provider: 'coral',
      mode: 'read',
      repo,
      allowed_paths: [],
      task: 'read fixture',
    }
    const a = await manager.start({ ...request, run: first.id })
    const b = await manager.start({ ...request, run: second.id })
    await waitUntil(() => started.length === 1)
    assert.equal((await manager.getSummary(b.job.job_id)).status, 'queued')
    power = 'battery'
    await manager.enforceLocalPower()
    assert.equal(
      (await manager.waitForTerminal(a.job.job_id)).status,
      'cancelled'
    )
    assert.equal(
      (await manager.waitForTerminal(b.job.job_id)).status,
      'cancelled'
    )
    assert.match(
      (await manager.get(a.job.job_id)).result?.error ?? '',
      /battery/u
    )
    power = 'ac'
    await manager.enforceLocalPower()
    assert.equal(started.length, 1)
    power = 'battery'
    await assert.rejects(manager.createRun(input), /battery/u)
    await manager.createRun({ ...input, allow_battery: true })
    power = 'unknown'
    await assert.rejects(
      manager.createRun({ ...input, allow_battery: true }),
      /unknown/u
    )
  }
  finally
  {
    await manager.shutdown()
    await rm(repo, { recursive: true, force: true })
    await rm(state, { recursive: true, force: true })
  }
})

test('a power change during final local metadata validation prevents provider execution', async () =>
{
  const repo = await initializeTestRepo()
  const state = await mkdtemp(path.join(os.tmpdir(), 'broker-launch-race-'))
  let power: PowerState = 'ac'
  let lookups = 0
  let started = false
  const manager = new JobManager(
    { ...defaultBrokerConfig({}), state_dir: state },
    [
      {
        name: 'coral',
        run: async () =>
        {
          started = true
          return success
        },
      },
    ],
    {
      power: async () => power,
      models: async () =>
      {
        lookups += 1
        if (lookups === 4) power = 'battery'
        return ['local-fixture']
      },
    }
  )
  try
  {
    const run = await manager.createRun({
      repo,
      targets: [{ provider: 'coral', model: 'local-fixture' }],
    })
    const admission = await manager.start({
      run: run.id,
      provider: 'coral',
      mode: 'read',
      repo,
      allowed_paths: [],
      task: 'read fixture',
    })
    const terminal = await manager.waitForTerminal(admission.job.job_id)
    assert.notEqual(terminal.status, 'completed')
    assert.equal(started, false)
    assert.match(
      (await manager.get(admission.job.job_id)).result?.error ?? '',
      /battery/u
    )
    assert.equal((await manager.runDetails(run.id)).spent, 1)
  }
  finally
  {
    await manager.shutdown()
    await rm(repo, { recursive: true, force: true })
    await rm(state, { recursive: true, force: true })
  }
})
