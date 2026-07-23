// tools/worker-broker/src/process-runner.ts
// run cancellable process groups while preserving stdout & stderr artifacts

import { constants as fsConstants, createWriteStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { preparePrivateFile, PRIVATE_FILE_MODE } from './artifact.js'

export interface ProcessRunOptions
{
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  stdin?: string
  stdout_path: string
  stderr_path: string
  signal?: AbortSignal
  timeout_ms?: number
  on_stdout_line?: (line: string) => void
  on_process_started?: (pid: number) => void | Promise<void>
}

export interface ProcessRunResult
{
  exit_code: number | null
  signal: NodeJS.Signals | null
  timed_out: boolean
  elapsed_ms: number
}

const TERMINATION_GRACE_MS = 2_000

// hold the detached process at exec until durable ownership is recorded
const PROCESS_START_WRAPPER =
  'IFS= read -r ready <&3 || exit 125; [ "$ready" = start ] || exit 125; exec "$@"'

async function resolveExecutable(
  command: string,
  cwd: string,
  environment: NodeJS.ProcessEnv
): Promise<string>
{
  const candidates = command.includes('/')
    ? [path.resolve(cwd, command)]
    : (environment.PATH ?? '/usr/bin:/bin')
        .split(path.delimiter)
        .map((directory) =>
          path.resolve(directory === '' ? cwd : directory, command)
        )
  let lastError: unknown
  for (const candidate of candidates)
  {
    try
    {
      await access(candidate, fsConstants.X_OK)
      return candidate
    }
    catch (error)
    {
      lastError = error
    }
  }
  throw lastError
}

async function releaseProcessGate(gate: Writable): Promise<void>
{
  await new Promise<void>((resolve, reject) =>
  {
    const rejectOnError = (error: Error): void => reject(error)
    gate.once('error', rejectOnError)
    gate.end('start\n', () =>
    {
      gate.off('error', rejectOnError)
      resolve()
    })
  })
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void
{
  try
  {
    process.kill(-pid, signal)
  }
  catch (error)
  {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ESRCH') throw error
  }
}

export function processGroupExists(pid: number): boolean
{
  try
  {
    process.kill(-pid, 0)
    return true
  }
  catch (error)
  {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    throw error
  }
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number
): Promise<boolean>
{
  const deadline = Date.now() + timeoutMs
  while (processGroupExists(pid))
  {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)))
  }
  return true
}

export async function terminateProcessGroup(pid: number): Promise<void>
{
  if (!Number.isSafeInteger(pid) || pid <= 1)
  {
    throw new Error(`invalid persisted process group id: ${pid}`)
  }
  killProcessGroup(pid, 'SIGTERM')
  if (await waitForProcessGroupExit(pid, TERMINATION_GRACE_MS)) return
  killProcessGroup(pid, 'SIGKILL')
  if (!(await waitForProcessGroupExit(pid, TERMINATION_GRACE_MS)))
  {
    throw new Error(`process group ${pid} survived SIGKILL`)
  }
}

export async function runProcess(
  options: ProcessRunOptions
): Promise<ProcessRunResult>
{
  const environment = options.env ?? process.env
  const executable = await resolveExecutable(
    options.command,
    options.cwd,
    environment
  )
  await Promise.all([
    preparePrivateFile(options.stdout_path),
    preparePrivateFile(options.stderr_path),
  ])

  const stdout = createWriteStream(options.stdout_path, {
    flags: 'w',
    mode: PRIVATE_FILE_MODE,
  })
  const stderr = createWriteStream(options.stderr_path, {
    flags: 'w',
    mode: PRIVATE_FILE_MODE,
  })
  const artifactStreams = [finished(stdout), finished(stderr)]
  const startedAt = Date.now()
  let timedOut = false
  let stdoutBuffer = ''

  return await new Promise<ProcessRunResult>((resolve, reject) =>
  {
    const child = spawn(
      '/bin/sh',
      [
        '-c',
        PROCESS_START_WRAPPER,
        'worker-broker-process',
        executable,
        ...options.args,
      ],
      {
        cwd: options.cwd,
        env: environment,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      }
    )
    const pid = child.pid
    const processGate = child.stdio[3] as Writable
    let forceKillTimer: NodeJS.Timeout | undefined
    let timeoutTimer: NodeJS.Timeout | undefined
    let artifactError: unknown
    let executionError: unknown
    let processStartError: unknown
    let processStarted = Promise.resolve()
    let settled = false

    const cleanup = (): void =>
    {
      clearTimeout(timeoutTimer)
      clearTimeout(forceKillTimer)
      options.signal?.removeEventListener('abort', abortHandler)
    }

    const closeArtifacts = (): void =>
    {
      stdout.end()
      stderr.end()
    }

    const terminate = (): void =>
    {
      if (pid === undefined) return
      killProcessGroup(pid, 'SIGTERM')
      forceKillTimer ??= setTimeout(
        () => killProcessGroup(pid, 'SIGKILL'),
        TERMINATION_GRACE_MS
      )
      forceKillTimer.unref()
    }
    const abortHandler = (): void => terminate()
    const artifactsFinished = Promise.all(artifactStreams).catch(
      (error: unknown) =>
      {
        artifactError = error
        terminate()
        child.stdout.resume()
      }
    )

    const settle = async (result: ProcessRunResult): Promise<void> =>
    {
      if (settled) return
      settled = true
      cleanup()
      closeArtifacts()
      await Promise.all([processStarted, artifactsFinished])
      if (artifactError !== undefined) reject(artifactError)
      else if (processStartError !== undefined) reject(processStartError)
      else if (executionError !== undefined) reject(executionError)
      else resolve(result)
    }

    if (pid !== undefined)
    {
      processStarted = Promise.resolve()
        .then(async () => await options.on_process_started?.(pid))
        .then(async () =>
        {
          if (options.signal?.aborted || timedOut)
          {
            processGate.destroy()
            return
          }
          await releaseProcessGate(processGate)
        })
        .catch((error: unknown) =>
        {
          processStartError = error
          terminate()
        })
    }
    else
    {
      processGate.destroy()
    }
    if (options.signal?.aborted) terminate()
    options.signal?.addEventListener('abort', abortHandler, { once: true })
    if (options.timeout_ms !== undefined)
    {
      timeoutTimer = setTimeout(() =>
      {
        timedOut = true
        terminate()
      }, options.timeout_ms)
      timeoutTimer.unref()
    }

    child.stdout.on('data', (chunk: Buffer) =>
    {
      if (!stdout.write(chunk))
      {
        child.stdout.pause()
        stdout.once('drain', () => child.stdout.resume())
      }
      if (options.on_stdout_line === undefined) return

      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) options.on_stdout_line(line)
    })
    child.stderr.pipe(stderr)
    child.stdin.on('error', (error: NodeJS.ErrnoException) =>
    {
      if (
        error.code !== 'EPIPE' &&
        error.code !== 'ERR_STREAM_DESTROYED' &&
        !settled
      )
      {
        executionError = error
        terminate()
      }
    })

    child.once('error', (error) =>
    {
      executionError = error
    })
    child.once('close', (exitCode, signal) =>
    {
      if (settled) return
      if (stdoutBuffer !== '') options.on_stdout_line?.(stdoutBuffer)
      void settle({
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        elapsed_ms: Date.now() - startedAt,
      })
    })

    if (options.stdin !== undefined) child.stdin.end(options.stdin)
    else child.stdin.end()
  })
}

export async function runCaptured(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<string>
{
  return await new Promise<string>((resolve, reject) =>
  {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) =>
    {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) =>
    {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (exitCode, signal) =>
    {
      if (exitCode === 0) resolve(stdout)
      else
      {
        reject(
          new Error(
            `${command} ${args.join(' ')} failed (${signal ?? exitCode ?? 'unknown'}): ${stderr.trim()}`
          )
        )
      }
    })
  })
}
