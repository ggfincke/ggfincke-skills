// tools/worker-broker/tests/ccusage.test.ts
// prove Codex usage identity, backfill idempotency, & wrapper mutation safety

import assert from 'node:assert/strict'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  codexUsageSidecarDirectory,
  materializeCodexUsageSidecar,
  persistCodexUsageEvent,
  runCcusage,
} from '../src/ccusage.js'
import type { BrokerConfig, ProviderRunContext } from '../src/contracts.js'
import { CodexProvider } from '../src/providers/codex.js'

const TURN_EVENT = {
  type: 'turn.completed',
  timestamp: '2026-08-01T00:00:00.000Z',
  model: 'event-model',
  usage: {
    input_tokens: 11,
    cached_input_tokens: 2,
    output_tokens: 3,
    reasoning_output_tokens: 1,
  },
}

async function sidecarFiles(stateDir: string): Promise<string[]>
{
  return (await readdir(codexUsageSidecarDirectory(stateDir)))
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
}

async function sidecarSnapshot(stateDir: string): Promise<Map<string, Buffer>>
{
  const directory = codexUsageSidecarDirectory(stateDir)
  const entries = (await readdir(directory)).sort()
  return new Map(
    await Promise.all(
      entries.map(
        async (name) =>
          [name, await readFile(path.join(directory, name))] as const
      )
    )
  )
}

async function assertNoSidecar(stateDir: string): Promise<void>
{
  await assert.rejects(
    access(path.join(stateDir, 'ccusage')),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
  )
}

test('Codex provider capture separates attempts and preserves event model authority', async () =>
{
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccusage-capture-'))
  const stateDir = path.join(root, 'state')
  const worktree = path.join(root, 'worktree')
  const fakeCodex = path.join(root, 'fake-codex')
  try
  {
    await mkdir(worktree)
    await writeFile(
      fakeCodex,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs')",
        'const args = process.argv.slice(2)',
        "const output = args[args.indexOf('--output-last-message') + 1]",
        "fs.writeFileSync(output, JSON.stringify({summary:'ok',assumptions:[],risks:[],follow_ups:[]}))",
        `process.stdout.write(${JSON.stringify(`${JSON.stringify(TURN_EVENT)}\n`)})`,
      ].join('\n')
    )
    await chmod(fakeCodex, 0o755)
    const config: BrokerConfig = {
      state_dir: stateDir,
      codex_binary: fakeCodex,
      cursor_binary: 'unused-cursor',
      coral_binary: 'unused-coral',
      claude_binary: 'unused-claude',
      default_codex_model: 'default-model',
    }
    const provider = new CodexProvider(config)

    for (const attempt of [0, 1])
    {
      const jobDir = path.join(root, `job-${attempt}`)
      await mkdir(jobDir)
      const context: ProviderRunContext = {
        job_id: 'capture-job',
        provider_attempt: attempt,
        request: {
          provider: 'codex',
          mode: 'read',
          repo: worktree,
          base_ref: 'HEAD',
          task: 'capture usage',
          allowed_paths: [],
          acceptance_criteria: [],
          setup_commands: [],
          verification_commands: [],
          model: 'request-model',
          depends_on: [],
          allow_nested_agents: false,
        },
        worktree,
        job_dir: jobDir,
        prompt_path: path.join(jobDir, 'prompt.md'),
        event_log_path: path.join(jobDir, 'events.jsonl'),
        stderr_path: path.join(jobDir, 'stderr.log'),
        model_result_path: path.join(jobDir, 'model-result.json'),
        signal: new AbortController().signal,
        on_process_started: () => undefined,
        on_process_finished: () => undefined,
      }
      const outcome = await provider.run(context)
      assert.equal(outcome.exit_code, 0)
      assert.equal(outcome.effective_model, 'event-model')
    }

    const initialFiles = await sidecarFiles(stateDir)
    assert.equal(initialFiles.length, 2)
    const initialRecords = await Promise.all(
      initialFiles.map(
        async (name) =>
          JSON.parse(
            await readFile(
              path.join(codexUsageSidecarDirectory(stateDir), name),
              'utf8'
            )
          ) as Record<string, unknown>
      )
    )
    assert.deepEqual(
      initialRecords
        .map((record) => (record.worker_broker as { attempt: number }).attempt)
        .sort(),
      [0, 1]
    )
    assert.deepEqual(
      initialRecords.map((record) => record.model),
      ['event-model', 'event-model']
    )

    await persistCodexUsageEvent(
      stateDir,
      {
        ...TURN_EVENT,
        model: 'replacement-event-model',
        usage: { ...TURN_EVENT.usage, input_tokens: 101 },
      },
      {
        job_id: 'capture-job',
        attempt: 0,
        turn_index: 0,
        timestamp: TURN_EVENT.timestamp,
        model: 'ignored-source-model',
        provenance: 'captured',
      }
    )
    assert.equal((await sidecarFiles(stateDir)).length, 2)
    const summary = await materializeCodexUsageSidecar(stateDir)
    assert.equal(summary.records, 2)
    assert.equal(summary.input_tokens, 112)
  }
  finally
  {
    await rm(root, { recursive: true, force: true })
  }
})

test('terminal backfill recovers earlier retry attempts without overriding captured records', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'ccusage-backfill-'))
  const jobId = 'backfill-job'
  const jobDir = path.join(stateDir, 'jobs', jobId)
  try
  {
    await mkdir(jobDir, { recursive: true })
    await writeFile(
      path.join(jobDir, 'job.json'),
      `${JSON.stringify({
        job_id: jobId,
        status: 'completed',
        restart_requeues: 1,
        request: { provider: 'codex', model: 'request-model' },
        result: { effective_model: 'effective-model' },
      })}\n`
    )
    await writeFile(
      path.join(jobDir, 'events.jsonl'),
      `${JSON.stringify({
        ...TURN_EVENT,
        model: undefined,
        usage: { ...TURN_EVENT.usage, input_tokens: 5 },
      })}\n`
    )
    await writeFile(
      path.join(jobDir, 'events.attempt-1.jsonl'),
      `${JSON.stringify({
        ...TURN_EVENT,
        model: 'backfill-should-not-win',
        usage: { ...TURN_EVENT.usage, input_tokens: 7 },
      })}\n`
    )
    await persistCodexUsageEvent(
      stateDir,
      { ...TURN_EVENT, usage: { ...TURN_EVENT.usage, input_tokens: 77 } },
      {
        job_id: jobId,
        attempt: 1,
        turn_index: 0,
        timestamp: TURN_EVENT.timestamp,
        provenance: 'captured',
      }
    )

    const first = await materializeCodexUsageSidecar(stateDir)
    assert.equal(first.backfilled_records, 1)
    assert.equal(first.records, 2)
    assert.equal(first.input_tokens, 82)
    const records = await Promise.all(
      (await sidecarFiles(stateDir)).map(
        async (name) =>
          JSON.parse(
            await readFile(
              path.join(codexUsageSidecarDirectory(stateDir), name),
              'utf8'
            )
          ) as {
            model?: string
            usage: { input_tokens: number }
            worker_broker: {
              attempt: number
              provenance: string
            }
          }
      )
    )
    records.sort(
      (left, right) => left.worker_broker.attempt - right.worker_broker.attempt
    )
    assert.deepEqual(
      records.map((record) => ({
        attempt: record.worker_broker.attempt,
        provenance: record.worker_broker.provenance,
        model: record.model,
        input_tokens: record.usage.input_tokens,
      })),
      [
        {
          attempt: 0,
          provenance: 'backfilled',
          model: 'effective-model',
          input_tokens: 5,
        },
        {
          attempt: 1,
          provenance: 'captured',
          model: 'event-model',
          input_tokens: 77,
        },
      ]
    )
    const firstBytes = await sidecarSnapshot(stateDir)
    assert.equal(
      [...firstBytes.keys()].filter((name) => name.endsWith('.complete'))
        .length,
      2
    )

    const second = await materializeCodexUsageSidecar(stateDir)
    assert.equal(second.backfilled_records, 0)
    assert.equal(second.records, 2)
    assert.equal(second.input_tokens, 82)
    assert.deepEqual(await sidecarSnapshot(stateDir), firstBytes)
  }
  finally
  {
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('ccusage validates stock-binary ownership before sidecar mutation', async () =>
{
  const root = await mkdtemp(path.join(os.tmpdir(), 'ccusage-wrapper-'))
  try
  {
    const nonExecutable = path.join(root, 'not-executable')
    await writeFile(nonExecutable, '#!/bin/sh\nexit 0\n')
    const reentering = path.join(root, 'reentering')
    await writeFile(reentering, '#!/bin/sh\n# worker-broker\nexit 0\n')
    await chmod(reentering, 0o755)
    const invalidEnvironments: NodeJS.ProcessEnv[] = [
      {
        WORKER_BROKER_CCUSAGE_WRAPPED: '1',
        PATH: '',
      },
      {
        WORKER_BROKER_CCUSAGE_BINARY: 'relative-ccusage',
        PATH: '',
      },
      {
        WORKER_BROKER_CCUSAGE_BINARY: nonExecutable,
        PATH: '',
      },
      {
        WORKER_BROKER_CCUSAGE_BINARY: reentering,
        PATH: '',
      },
      { PATH: '' },
    ]
    for (const [index, environment] of invalidEnvironments.entries())
    {
      const stateDir = path.join(root, `invalid-state-${index}`)
      await assert.rejects(runCcusage(stateDir, [], environment))
      await assertNoSidecar(stateDir)
    }

    const stock = path.join(root, 'stock-ccusage')
    const capture = path.join(root, 'stock-capture.json')
    await writeFile(
      stock,
      [
        '#!/usr/bin/env node',
        "const fs = require('node:fs')",
        'fs.writeFileSync(process.env.CC_CAPTURE, JSON.stringify({args:process.argv.slice(2),home:process.env.CODEX_HOME,marker:process.env.WORKER_BROKER_CCUSAGE_WRAPPED}))',
      ].join('\n')
    )
    await chmod(stock, 0o755)
    const stateDir = path.join(root, 'valid-state')
    assert.equal(
      await runCcusage(stateDir, ['--json'], {
        HOME: path.join(root, 'home'),
        PATH: path.dirname(process.execPath),
        WORKER_BROKER_CCUSAGE_BINARY: stock,
        CC_CAPTURE: capture,
      }),
      0
    )
    const captured = JSON.parse(await readFile(capture, 'utf8')) as {
      args: string[]
      home: string
      marker: string
    }
    assert.deepEqual(captured.args, ['--json'])
    assert.equal(captured.marker, '1')
    assert.deepEqual(captured.home.split(','), [
      path.join(root, 'home', '.codex'),
      codexUsageSidecarDirectory(stateDir),
    ])
  }
  finally
  {
    await rm(root, { recursive: true, force: true })
  }
})
