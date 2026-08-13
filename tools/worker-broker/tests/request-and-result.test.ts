// tools/worker-broker/tests/request-and-result.test.ts
// verify canonical assignment parsing & model-result code-point bounds

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { BrokerConfig } from '../src/contracts.js'
import { JobManager } from '../src/job-manager.js'
import {
  MODEL_RESULT_ITEM_MAX_CODE_POINTS,
  MODEL_RESULT_SUMMARY_MAX_CODE_POINTS,
  parseModelResult,
} from '../src/model-result.js'
import { parseStartWorkerRequest } from '../src/request.js'

const BASE_REQUEST = {
  mode: 'read',
  repo: '/repo',
  task: 'inspect the fixture',
  allowed_paths: [],
} as const

test('request parser accepts provider semantics and rejects malformed input', () =>
{
  const valid = [
    {
      ...BASE_REQUEST,
      provider: 'codex',
      effort: 'ultra',
      allow_nested_agents: true,
    },
    { ...BASE_REQUEST, provider: 'claude', effort: 'max' },
    { ...BASE_REQUEST, provider: 'cursor', model: 'composer-thinking' },
    { ...BASE_REQUEST, provider: 'coral', model: 'qwen-fixture' },
  ]
  for (const request of valid)
  {
    assert.equal(parseStartWorkerRequest(request).provider, request.provider)
  }

  const invalid: Array<{ value: unknown; message: RegExp }> = [
    { value: 'not an object', message: /expected object/iu },
    {
      value: { ...BASE_REQUEST, provider: 'codex', unexpected: true },
      message: /unrecognized key/iu,
    },
    {
      value: { ...BASE_REQUEST, provider: 'codex', effort: 'banana' },
      message: /invalid option/iu,
    },
    {
      value: {
        ...BASE_REQUEST,
        provider: 'codex',
        allow_nested_agents: 'yes',
      },
      message: /expected boolean/iu,
    },
    {
      value: { ...BASE_REQUEST, provider: 'cursor', effort: 'high' },
      message: /cursor reasoning effort/iu,
    },
    {
      value: { ...BASE_REQUEST, provider: 'coral', effort: 'low' },
      message: /coral does not support/iu,
    },
    {
      value: {
        ...BASE_REQUEST,
        provider: 'coral',
        allow_nested_agents: true,
      },
      message: /coral headless workers/iu,
    },
  ]
  for (const { value, message } of invalid)
  {
    assert.throws(() => parseStartWorkerRequest(value), message)
  }
})

test('strict parser guards direct JobManager admission', async () =>
{
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'worker-request-'))
  const config: BrokerConfig = {
    state_dir: stateDir,
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
    claude_binary: 'claude',
  }
  const manager = new JobManager(config, [])
  try
  {
    await assert.rejects(
      manager.start({
        ...BASE_REQUEST,
        provider: 'codex',
        allow_nested_agents: 'yes',
      }),
      /expected boolean/iu
    )
    assert.deepEqual(await manager.list(), [])
  }
  finally
  {
    await manager.shutdown().catch(() => undefined)
    await rm(stateDir, { recursive: true, force: true })
  }
})

test('model-result bounds count Unicode code points at the exact limits', () =>
{
  const summary = '😀'.repeat(MODEL_RESULT_SUMMARY_MAX_CODE_POINTS)
  const item = '😀'.repeat(MODEL_RESULT_ITEM_MAX_CODE_POINTS)
  assert.deepEqual(
    parseModelResult(
      {
        summary,
        assumptions: [item],
        risks: [],
        follow_ups: [],
      },
      'fixture'
    ),
    { summary, assumptions: [item], risks: [], follow_ups: [] }
  )

  assert.throws(
    () =>
      parseModelResult(
        {
          summary: `${summary}😀`,
          assumptions: [],
          risks: [],
          follow_ups: [],
        },
        'fixture'
      ),
    /summary must be at most 8000 code points/u
  )
  assert.throws(
    () =>
      parseModelResult(
        {
          summary: '',
          assumptions: [`${item}😀`],
          risks: [],
          follow_ups: [],
        },
        'fixture'
      ),
    /assumptions items must be at most 500 code points/u
  )
})
