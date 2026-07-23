// tools/worker-broker/tests/process-runner.test.ts
// prove host subprocess cancellation & spawn failures settle without orphaning work

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runProcess } from '../src/process-runner.js'

test('abort terminates a running process group promptly', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  const controller = new AbortController()
  try
  {
    const running = runProcess({
      command: '/bin/zsh',
      args: ['-lc', 'sleep 30'],
      cwd: directory,
      stdout_path: path.join(directory, 'stdout.log'),
      stderr_path: path.join(directory, 'stderr.log'),
      signal: controller.signal,
      on_process_started: () => controller.abort(),
    })
    const result = await running
    assert.ok(result.elapsed_ms < 5_000)
    assert.equal(result.signal, 'SIGTERM')
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a missing executable rejects cleanly', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  try
  {
    await assert.rejects(
      runProcess({
        command: path.join(directory, 'missing-binary'),
        args: [],
        cwd: directory,
        stdout_path: path.join(directory, 'stdout.log'),
        stderr_path: path.join(directory, 'stderr.log'),
      }),
      /ENOENT/u
    )
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})
