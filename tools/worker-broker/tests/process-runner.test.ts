// tools/worker-broker/tests/process-runner.test.ts
// prove subprocess lifecycle & text decoding settle without corrupting evidence

import assert from 'node:assert/strict'
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  processGroupExists,
  runCaptured,
  runProcess,
  runStdoutToFile,
  STDOUT_LINE_MAX_BYTES,
  terminateOwnedProcessGroup,
  terminateProcessGroup,
} from '../src/process-runner.js'

const SPLIT_STDOUT_SCRIPT =
  'const bytes=Buffer.from([240,159,152,128,10]);' +
  'process.stdout.write(bytes.subarray(0,2));' +
  'setTimeout(()=>process.stdout.write(bytes.subarray(2)),50)'

const SPLIT_STDERR_SCRIPT =
  'const bytes=Buffer.from([240,159,152,128,10]);' +
  'process.stderr.write(bytes.subarray(0,2));' +
  'setTimeout(()=>{process.stderr.write(bytes.subarray(2));process.exitCode=1},50)'

async function readRange(
  filePath: string,
  position: number,
  length: number
): Promise<Buffer>
{
  const file = await open(filePath, 'r')
  const bytes = Buffer.allocUnsafe(length)
  let bytesRead = 0
  try
  {
    while (bytesRead < length)
    {
      const result = await file.read(
        bytes,
        bytesRead,
        length - bytesRead,
        position + bytesRead
      )
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    return bytes.subarray(0, bytesRead)
  }
  finally
  {
    await file.close()
  }
}

test('abort terminates a running process group promptly', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  const controller = new AbortController()
  try
  {
    const running = runProcess({
      command: '/bin/sh',
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

test('run waits for a leaderless background process group to drain', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  const descendantPath = path.join(directory, 'descendant.pid')
  let processId: number | undefined
  let groupExistedAtFinish: boolean | undefined
  try
  {
    const result = await runProcess({
      command: process.execPath,
      args: [
        '-e',
        [
          "const { spawn } = require('node:child_process')",
          "const { writeFileSync } = require('node:fs')",
          "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' })",
          'descendant.unref()',
          'writeFileSync(process.argv[1], String(descendant.pid))',
        ].join(';'),
        descendantPath,
      ],
      cwd: directory,
      stdout_path: path.join(directory, 'stdout.log'),
      stderr_path: path.join(directory, 'stderr.log'),
      on_process_started: (identity) =>
      {
        processId = identity.pid
        assert.match(identity.token, /^[a-f0-9]{32}$/u)
      },
      on_process_finished: (identity) =>
      {
        groupExistedAtFinish = processGroupExists(identity.pid)
      },
    })
    assert.equal(result.exit_code, 0)
    assert.ok(Number(await readFile(descendantPath, 'utf8')) > 1)
    assert.ok(processId)
    assert.equal(groupExistedAtFinish, false)
    assert.equal(processGroupExists(processId), false)
  }
  finally
  {
    if (processId !== undefined)
    {
      await terminateProcessGroup(processId).catch(() => undefined)
    }
    await rm(directory, { recursive: true, force: true })
  }
})

test('persisted supervisor identity gates process-group signalling', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  let identity: { pid: number; token: string } | undefined
  let resolveIdentity = (_identity: { pid: number; token: string }): void =>
    undefined
  const identityStarted = new Promise<{ pid: number; token: string }>(
    (resolve) =>
    {
      resolveIdentity = resolve
    }
  )
  const running = runProcess({
    command: '/bin/sh',
    args: ['-lc', 'sleep 30'],
    cwd: directory,
    stdout_path: path.join(directory, 'stdout.log'),
    stderr_path: path.join(directory, 'stderr.log'),
    on_process_started: (started) => resolveIdentity(started),
  })
  const settled = running.then(
    () => undefined,
    () => undefined
  )
  try
  {
    identity = await identityStarted
    const mismatchedToken = `${identity.token[0] === '0' ? '1' : '0'}${identity.token.slice(1)}`
    await assert.rejects(
      terminateOwnedProcessGroup({
        pid: identity.pid,
        token: mismatchedToken,
      }),
      /does not match the persisted broker supervisor token/u
    )
    assert.equal(processGroupExists(identity.pid), true)

    await terminateOwnedProcessGroup(identity)
    await settled
    assert.equal(processGroupExists(identity.pid), false)
  }
  finally
  {
    if (identity !== undefined)
    {
      await terminateProcessGroup(identity.pid).catch(() => undefined)
    }
    await settled
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

test('text decoders preserve UTF-8 split across child-process chunks', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  const stdoutPath = path.join(directory, 'stdout.log')
  const stderrPath = path.join(directory, 'stderr.log')
  const lines: string[] = []
  try
  {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', SPLIT_STDOUT_SCRIPT],
      cwd: directory,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      on_stdout_line: (line) => lines.push(line),
    })
    assert.equal(result.exit_code, 0)
    assert.deepEqual(lines, ['😀'])
    assert.deepEqual(await readFile(stdoutPath), Buffer.from('😀\n'))

    assert.equal(
      await runCaptured(
        process.execPath,
        ['-e', SPLIT_STDOUT_SCRIPT],
        directory
      ),
      '😀\n'
    )
    await assert.rejects(
      runCaptured(process.execPath, ['-e', SPLIT_STDERR_SCRIPT], directory),
      /😀/u
    )
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})

test('stdout-to-file streams large raw bytes privately and preserves command errors', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  const outputPath = path.join(directory, 'raw-output.bin')
  const failedOutputPath = path.join(directory, 'failed-output.bin')
  const chunkLength = 64 * 1024
  const outputLength = 84 * 1024 * 1024
  const chunkCount = outputLength / chunkLength
  const expectedChunk = Buffer.allocUnsafe(chunkLength)
  for (let index = 0; index < expectedChunk.length; index += 1)
  {
    expectedChunk[index] = index & 0xff
  }
  try
  {
    await runStdoutToFile(
      process.execPath,
      [
        '-e',
        [
          "const { writeSync } = require('node:fs')",
          `const chunk = Buffer.allocUnsafe(${chunkLength})`,
          'for (let index = 0; index < chunk.length; index += 1) chunk[index] = index & 0xff',
          `for (let index = 0; index < ${chunkCount}; index += 1) { let offset = 0; while (offset < chunk.length) offset += writeSync(1, chunk, offset, chunk.length - offset) }`,
        ].join(';'),
      ],
      directory,
      outputPath
    )
    const output = await stat(outputPath)
    assert.equal(output.size, outputLength)
    assert.deepEqual(await readRange(outputPath, 0, chunkLength), expectedChunk)
    assert.deepEqual(
      await readRange(outputPath, outputLength - chunkLength, chunkLength),
      expectedChunk
    )
    assert.equal(output.mode & 0o777, 0o600)

    await assert.rejects(
      runStdoutToFile(
        process.execPath,
        ['-e', SPLIT_STDERR_SCRIPT],
        directory,
        failedOutputPath
      ),
      /failed \(1\): 😀/u
    )
    assert.equal((await stat(failedOutputPath)).mode & 0o777, 0o600)
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})

test('oversized newline-free stdout is not delivered as a line', async () =>
{
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'worker-broker-process-')
  )
  const stdoutPath = path.join(directory, 'stdout.log')
  const lines: string[] = []
  const oversized = STDOUT_LINE_MAX_BYTES + 1
  try
  {
    const result = await runProcess({
      command: process.execPath,
      args: [
        '-e',
        [
          `process.stdout.write('x'.repeat(${oversized}))`,
          "process.stdout.write('\\nsmall\\n')",
        ].join(';'),
      ],
      cwd: directory,
      stdout_path: stdoutPath,
      stderr_path: path.join(directory, 'stderr.log'),
      on_stdout_line: (line) => lines.push(line),
    })
    assert.equal(result.exit_code, 0)
    assert.deepEqual(lines, ['small'])
    assert.equal(
      await readFile(stdoutPath, 'utf8'),
      `${'x'.repeat(oversized)}\nsmall\n`
    )
  }
  finally
  {
    await rm(directory, { recursive: true, force: true })
  }
})
