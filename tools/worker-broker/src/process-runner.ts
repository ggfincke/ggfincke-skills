// tools/worker-broker/src/process-runner.ts
// run cancellable process groups while preserving stdout & stderr artifacts

import { constants as fsConstants, createWriteStream } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { access, open } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { Writable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { StringDecoder } from 'node:string_decoder'
import { preparePrivateFile, PRIVATE_FILE_MODE } from './artifact.js'
import type { ProcessIdentity } from './contracts.js'

interface ProcessRunOptions
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
  on_process_started?: (identity: ProcessIdentity) => void | Promise<void>
  on_process_finished?: (identity: ProcessIdentity) => void | Promise<void>
}

interface ProcessRunResult
{
  exit_code: number | null
  signal: NodeJS.Signals | null
  timed_out: boolean
  elapsed_ms: number
}

const TERMINATION_GRACE_MS = 2_000
const PROCESS_TOKEN_PATTERN = /^[a-f0-9]{32}$/u
const PROCESS_SUPERVISOR_PREFIX = 'worker-broker-supervisor:'
export const STDOUT_LINE_MAX_BYTES = 256 * 1024

// keep a token-bearing group leader until the direct command exits; the node
// supervisor preserves the child's exact code-vs-signal outcome
const PROCESS_SUPERVISOR_SCRIPT = [
  "const { spawn } = require('node:child_process')",
  "const { readFileSync } = require('node:fs')",
  'const [marker, executable, ...args] = process.argv.slice(1)',
  'process.title = marker',
  'let child',
  'let pendingSignal',
  "for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { pendingSignal = signal; child?.kill(signal) })",
  "if (readFileSync(3, 'utf8').trim() !== 'start') process.exit(125)",
  "child = spawn(executable, args, { stdio: 'inherit' })",
  'if (pendingSignal !== undefined) child.kill(pendingSignal)',
  "child.once('error', (error) => { process.stderr.write(`${error.message}\\n`); process.exitCode = 126 })",
  "child.once('exit', (code, signal) => { if (signal !== null) { process.removeAllListeners(signal); process.kill(process.pid, signal); return }; process.exitCode = code ?? 126 })",
].join('; ')

function stdoutLineTooLarge(value: string): boolean
{
  return (
    value.length > STDOUT_LINE_MAX_BYTES ||
    Buffer.byteLength(value, 'utf8') > STDOUT_LINE_MAX_BYTES
  )
}

// skip oversized lines in the callback; the artifact file still gets every byte
function createStdoutLineBuffer(onLine: ((line: string) => void) | undefined)
{
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let skipping = false

  function accept(text: string): void
  {
    if (onLine === undefined || text === '') return
    let incoming = text
    if (skipping)
    {
      const newline = incoming.indexOf('\n')
      if (newline === -1) return
      skipping = false
      incoming = incoming.slice(newline + 1)
      if (incoming === '') return
    }

    if (
      !incoming.includes('\n') &&
      buffer.length + incoming.length > STDOUT_LINE_MAX_BYTES
    )
    {
      buffer = ''
      skipping = true
      return
    }

    const lines = `${buffer}${incoming}`.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines)
    {
      if (!stdoutLineTooLarge(line)) onLine(line)
    }
    if (stdoutLineTooLarge(buffer))
    {
      buffer = ''
      skipping = true
    }
  }

  return {
    write(chunk: Buffer): void
    {
      accept(decoder.write(chunk))
    },
    end(): void
    {
      accept(decoder.end())
      if (onLine === undefined || skipping || buffer === '') return
      if (!stdoutLineTooLarge(buffer)) onLine(buffer)
      buffer = ''
    },
  }
}

export class UnconfirmedProcessGroupExitError extends Error
{
  readonly process_id: number

  constructor(processId: number, detail: string)
  {
    super(`could not confirm process group ${processId} exited: ${detail}`)
    this.name = 'UnconfirmedProcessGroupExitError'
    this.process_id = processId
  }
}

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

function errorDetail(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}

export async function terminateProcessGroup(pid: number): Promise<void>
{
  try
  {
    if (!Number.isSafeInteger(pid) || pid <= 1)
    {
      throw new Error(`invalid process group id: ${pid}`)
    }
    killProcessGroup(pid, 'SIGTERM')
    if (await waitForProcessGroupExit(pid, TERMINATION_GRACE_MS)) return
    killProcessGroup(pid, 'SIGKILL')
    if (!(await waitForProcessGroupExit(pid, TERMINATION_GRACE_MS)))
    {
      throw new Error('the group survived SIGKILL')
    }
  }
  catch (error)
  {
    if (error instanceof UnconfirmedProcessGroupExitError) throw error
    throw new UnconfirmedProcessGroupExitError(pid, errorDetail(error))
  }
}

async function processCommand(processId: number): Promise<string | undefined>
{
  try
  {
    return (
      await runCaptured(
        'ps',
        ['-ww', '-p', String(processId), '-o', 'command='],
        process.cwd()
      )
    ).trim()
  }
  catch
  {
    return undefined
  }
}

export async function terminateOwnedProcessGroup(
  identity: ProcessIdentity
): Promise<void>
{
  const { pid, token } = identity
  if (!Number.isSafeInteger(pid) || pid <= 1)
  {
    throw new UnconfirmedProcessGroupExitError(
      pid,
      `invalid persisted process group id: ${pid}`
    )
  }
  if (!PROCESS_TOKEN_PATTERN.test(token))
  {
    throw new UnconfirmedProcessGroupExitError(
      pid,
      'the persisted supervisor token is invalid'
    )
  }
  let groupExists: boolean
  try
  {
    groupExists = processGroupExists(pid)
  }
  catch (error)
  {
    throw new UnconfirmedProcessGroupExitError(pid, errorDetail(error))
  }
  if (!groupExists) return

  const command = await processCommand(pid)
  const marker = `${PROCESS_SUPERVISOR_PREFIX}${token}`
  if (command === undefined || !command.includes(marker))
  {
    // the leader can disappear between the group probe and ps; absence is safe,
    // but a surviving leaderless or reused group must never be signalled
    try
    {
      if (!processGroupExists(pid)) return
    }
    catch (error)
    {
      throw new UnconfirmedProcessGroupExitError(pid, errorDetail(error))
    }
    throw new UnconfirmedProcessGroupExitError(
      pid,
      'the live process-group leader does not match the persisted broker supervisor token'
    )
  }
  await terminateProcessGroup(pid)
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
  const stdoutLines = createStdoutLineBuffer(options.on_stdout_line)

  return await new Promise<ProcessRunResult>((resolve, reject) =>
  {
    const processToken = randomBytes(16).toString('hex')
    const child = spawn(
      process.execPath,
      [
        '-e',
        PROCESS_SUPERVISOR_SCRIPT,
        `${PROCESS_SUPERVISOR_PREFIX}${processToken}`,
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
    const identity: ProcessIdentity | undefined =
      pid === undefined ? undefined : { pid, token: processToken }
    const processGate = child.stdio[3] as Writable
    let forceKillTimer: NodeJS.Timeout | undefined
    let timeoutTimer: NodeJS.Timeout | undefined
    let artifactError: unknown
    let executionError: unknown
    let processStartError: unknown
    let processFinishError: unknown
    let processStarted = Promise.resolve()
    let settled = false
    let markChildClosed = (): void => undefined
    const childClosed = new Promise<void>((resolve) =>
    {
      markChildClosed = resolve
    })

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
      await processStarted
      if (identity !== undefined)
      {
        try
        {
          // the leader can exit while detached descendants still own its
          // process group, so drain the group before releasing durable ownership
          await terminateProcessGroup(identity.pid)
          await options.on_process_finished?.(identity)
        }
        catch (error)
        {
          processFinishError = error
          child.stdout.destroy()
          child.stderr.destroy()
        }
      }
      await childClosed
      stdoutLines.end()
      cleanup()
      closeArtifacts()
      await artifactsFinished
      if (artifactError !== undefined) reject(artifactError)
      else if (processStartError !== undefined) reject(processStartError)
      else if (processFinishError !== undefined) reject(processFinishError)
      else if (executionError !== undefined) reject(executionError)
      else resolve(result)
    }

    if (identity !== undefined)
    {
      processStarted = Promise.resolve()
        .then(async () => await options.on_process_started?.(identity))
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
      stdoutLines.write(chunk)
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
    child.once('exit', (exitCode, signal) =>
    {
      if (settled) return
      void settle({
        exit_code: exitCode,
        signal,
        timed_out: timedOut,
        elapsed_ms: Date.now() - startedAt,
      })
    })
    child.once('close', (exitCode, signal) =>
    {
      markChildClosed()
      if (settled) return
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
    const stdoutDecoder = new StringDecoder('utf8')
    const stderrDecoder = new StringDecoder('utf8')
    child.stdout.on('data', (chunk: Buffer) =>
    {
      stdout += stdoutDecoder.write(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) =>
    {
      stderr += stderrDecoder.write(chunk)
    })
    child.once('error', reject)
    child.once('close', (exitCode, signal) =>
    {
      stdout += stdoutDecoder.end()
      stderr += stderrDecoder.end()
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

export async function runStdoutToFile(
  command: string,
  args: string[],
  cwd: string,
  stdoutPath: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<void>
{
  await preparePrivateFile(stdoutPath)
  const stdout = await open(stdoutPath, 'w', PRIVATE_FILE_MODE)
  try
  {
    const output = createWriteStream(stdoutPath, {
      fd: stdout.fd,
      autoClose: false,
    })
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let spawnError: unknown
    let commandError: unknown
    let outputError: unknown
    const stderrDecoder = new StringDecoder('utf8')
    child.stderr.on('data', (chunk: Buffer) =>
    {
      stderr += stderrDecoder.write(chunk)
    })
    const commandFinished = new Promise<void>((resolve) =>
    {
      child.once('error', (error) =>
      {
        spawnError = error
      })
      child.once('close', (exitCode, signal) =>
      {
        stderr += stderrDecoder.end()
        if (exitCode !== 0)
        {
          commandError = new Error(
            `${command} ${args.join(' ')} failed (${signal ?? exitCode ?? 'unknown'}): ${stderr.trim()}`
          )
        }
        resolve()
      })
    })
    const outputFinished = pipeline(child.stdout, output).catch(
      (error: unknown) =>
      {
        outputError = error
        child.kill('SIGTERM')
      }
    )
    await Promise.all([commandFinished, outputFinished])
    if (spawnError !== undefined) throw spawnError
    if (outputError !== undefined) throw outputError
    if (commandError !== undefined) throw commandError
  }
  finally
  {
    await stdout.close().catch((error: NodeJS.ErrnoException) =>
    {
      if (error.code !== 'EBADF') throw error
    })
  }
}
