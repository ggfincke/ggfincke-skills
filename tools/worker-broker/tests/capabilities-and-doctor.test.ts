// tools/worker-broker/tests/capabilities-and-doctor.test.ts
// protect fail-closed admission and bounded native diagnostics

import assert from 'node:assert/strict'
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { capabilityEvidence, requireCapabilities } from '../src/capabilities.js'
import { probeTool, runDoctor } from '../src/doctor.js'
import { JobManager } from '../src/job-manager.js'
import { normalizeRequest } from '../src/request.js'
import { initializeTestRepo, waitUntil } from './helpers.js'

test('unsupported required capabilities launch nothing and legacy requests remain usable', async () =>
{
  const repo = await initializeTestRepo()
  const state = await mkdtemp(path.join(os.tmpdir(), 'capability-admission-'))
  let starts = 0
  const manager = new JobManager(
    {
      state_dir: state,
      codex_binary: 'codex',
      cursor_binary: 'cursor-agent',
      coral_binary: 'coral',
      claude_binary: 'claude',
    },
    [
      {
        name: 'codex',
        async run()
        {
          starts += 1
          return {
            exit_code: 0,
            signal: null,
            model_result: {
              summary: 'read fixture',
              assumptions: [],
              risks: [],
              follow_ups: [],
            },
          }
        },
      },
    ]
  )
  try
  {
    const input = {
      provider: 'codex',
      mode: 'read',
      repo,
      task: 'inspect fixture',
      allowed_paths: [],
    }
    await assert.rejects(
      manager.start({
        ...input,
        required_capabilities: ['filesystem_read_only'],
        setup_commands: ['exit 99'],
      }),
      /required capabilities unavailable/u
    )
    assert.equal(starts, 0)
    assert.deepEqual(await readdir(state), [])
    assert.throws(
      () =>
        normalizeRequest({
          ...input,
          allow_nested_agents: true,
          required_capabilities: ['native_no_nesting'],
        }),
      /conflicts/u
    )
    const nativeRequest = normalizeRequest({
      ...input,
      required_capabilities: ['native_no_nesting'],
    })
    assert.throws(() => requireCapabilities(nativeRequest), /unverified/u)
    const nativeOnly = capabilityEvidence(nativeRequest)
    assert.equal(
      nativeOnly.find((entry) => entry.capability === 'no_nested_agents')
        ?.status,
      'unverified'
    )
    const admission = await manager.start(input)
    await waitUntil(
      async () =>
        (await manager.get(admission.job.job_id)).status === 'completed'
    )
    assert.equal(starts, 1)
    const job = await manager.get(admission.job.job_id)
    assert.equal(
      job.result?.capability_evidence?.find(
        (entry) => entry.capability === 'network_disabled'
      )?.status,
      'unverified'
    )
  }
  finally
  {
    await manager.shutdown()
    await rm(repo, { recursive: true, force: true })
    await rm(state, { recursive: true, force: true })
  }
})

test('native probes distinguish successful output, missing binaries, and bounded timeouts', async () =>
{
  const ok = await probeTool(process.execPath, [
    '-e',
    'process.stdout.write("fixture-version")',
  ])
  assert.equal(ok.status, 'ok')
  assert.equal(ok.output, 'fixture-version')
  assert.equal(
    (await probeTool('/missing/worker-broker-doctor-fixture', [])).status,
    'missing'
  )
  const start = Date.now()
  assert.equal(
    (
      await probeTool(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        40
      )
    ).status,
    'timeout'
  )
  assert.ok(Date.now() - start < 3_000)
})

test('doctor treats advertised flags as support without certifying enforcement or launching a model', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'doctor-advertised-flags-')
  )
  const binary = path.join(directory, 'fake-codex')
  const calls = path.join(directory, 'calls.jsonl')
  try
  {
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n')
if (args.length === 1 && args[0] === '--version') process.stdout.write('fixture-codex 1.0')
else if (JSON.stringify(args) === JSON.stringify(['exec', '--help'])) process.stdout.write('--disable --sandbox --toolshed')
else process.exit(99)
`
    )
    await chmod(binary, 0o755)
    const report = await runDoctor(
      {
        state_dir: path.join(directory, 'state'),
        codex_binary: binary,
        cursor_binary: '/missing/fixture-cursor',
        coral_binary: '/missing/fixture-coral',
        claude_binary: '/missing/fixture-claude',
        default_codex_model: 'fixture-model',
      },
      false,
      ['codex']
    )
    const provider = (report.providers as Array<Record<string, unknown>>)[0]!
    assert.equal(provider.version_status, 'ok')
    assert.ok((provider.supported_flags as string[]).includes('--disable'))
    assert.equal(
      (provider.supported_flags as string[]).includes('--tools'),
      false
    )
    assert.equal(provider.model_binding, 'unverified_until_native_execution')
    assert.equal(provider.smoke, undefined)
    const evidence = provider.capability_evidence as Array<{
      capability: string
      status: string
    }>
    assert.ok(evidence.every((entry) => entry.status !== 'enforced'))
    assert.equal(
      evidence.find((entry) => entry.capability === 'native_no_nesting')
        ?.status,
      'unverified'
    )
    assert.deepEqual(
      (await readFile(calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      [['--version'], ['exec', '--help']]
    )
    assert.deepEqual((await readdir(directory)).sort(), [
      'calls.jsonl',
      'fake-codex',
    ])
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})
