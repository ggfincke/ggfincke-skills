// tools/worker-broker/src/doctor.ts
// inspect native launch compatibility and run explicitly requested disposable smoke probes

import { spawn, execFile } from 'node:child_process'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { capabilityEvidence } from './capabilities.js'
import {
  PROVIDER_NAMES,
  type BrokerConfig,
  type ProviderName,
  type WorkerProvider,
} from './contracts.js'
import { readBuildId } from './daemon/protocol.js'
import { defaultBrokerConfig } from './config.js'
import { normalizeRequest } from './request.js'
import { ensureDaemonClient } from './daemon/client.js'
import { waitForOneTerminal } from './wait-command.js'
import { CodexProvider } from './providers/codex.js'
import { ClaudeProvider } from './providers/claude.js'
import { CursorProvider } from './providers/cursor.js'
import { AgyProvider } from './providers/agy.js'
import {
  installedLocalModels,
  localEndpoint,
  readPowerState,
  requireLocalPower,
} from './local-policy.js'
import { discoverTargets } from './targets.js'
import { CoralProvider } from './providers/coral.js'

interface ToolProbe
{
  status: 'ok' | 'failed' | 'timeout' | 'missing'
  output: string
}

const execFileAsync = promisify(execFile)
const MAX_PROBE_BYTES = 262_144

export async function probeTool(
  binary: string,
  args: string[],
  timeoutMs = 8_000
): Promise<ToolProbe>
{
  return await new Promise((resolve) =>
  {
    const child = spawn(binary, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let timedOut = false
    let settled = false
    let forceTimer: ReturnType<typeof setTimeout> | undefined
    const stop = (signal: NodeJS.Signals): void =>
    {
      if (child.pid === undefined) return
      try
      {
        process.kill(-child.pid, signal)
      }
      catch
      {
        /* process group already exited */
      }
    }
    const finish = (status: ToolProbe['status']): void =>
    {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      stop('SIGKILL')
      resolve({ status, output })
    }
    const timer = setTimeout(() =>
    {
      timedOut = true
      stop('SIGTERM')
      forceTimer = setTimeout(() =>
      {
        stop('SIGKILL')
        child.stdout.destroy()
        child.stderr.destroy()
        finish('timeout')
      }, 1_000)
    }, timeoutMs)
    const append = (data: Buffer): void =>
    {
      output = (output + data.toString('utf8')).slice(0, MAX_PROBE_BYTES)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.on('error', () => finish('missing'))
    child.on('close', (code) =>
      finish(timedOut ? 'timeout' : code === 0 ? 'ok' : 'failed')
    )
  })
}

async function resolveBinary(binary: string): Promise<string | null>
{
  const candidates = binary.includes(path.sep)
    ? [binary]
    : (process.env.PATH ?? '')
        .split(path.delimiter)
        .map((directory) => path.join(directory, binary))
  for (const candidate of candidates)
  {
    try
    {
      return await realpath(candidate)
    }
    catch
    {
      /* try the next path entry */
    }
  }
  return null
}

function binaryFor(config: BrokerConfig, provider: ProviderName): string
{
  return config[`${provider}_binary`] ?? provider
}

function modelFor(
  config: BrokerConfig,
  provider: ProviderName
): string | undefined
{
  return config[`default_${provider}_model`]
}

async function smokeProvider(
  config: BrokerConfig,
  provider: ProviderName
): Promise<Record<string, unknown>>
{
  if (provider === 'coral' && modelFor(config, provider) === undefined)
    return {
      status: 'unverified',
      reason: 'Coral has no configured model binding.',
    }
  if (provider === 'coral')
  {
    try
    {
      requireLocalPower(await readPowerState(), false)
      const endpoint = localEndpoint(
        config.coral_host ?? 'http://127.0.0.1:11434'
      )
      if (
        !(await installedLocalModels(endpoint)).includes(
          modelFor(config, provider) ?? ''
        )
      )
        throw new Error('installed local model unavailable')
    }
    catch (error)
    {
      return { status: 'blocked', reason: String(error) }
    }
  }
  const directory = await mkdtemp(
    path.join(os.tmpdir(), `worker-broker-smoke-${provider}-`)
  )
  const marker = 'broker-native-smoke-fixture'
  await writeFile(path.join(directory, 'README.md'), `${marker}\n`)
  for (const args of [
    ['init', '-q'],
    ['config', 'user.name', 'Worker Broker Smoke'],
    ['config', 'user.email', 'smoke@example.invalid'],
    ['add', 'README.md'],
    ['commit', '-qm', 'fixture'],
  ])
    await execFileAsync('git', args, { cwd: directory, timeout: 8_000 })
  const initialHead = (
    await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      timeout: 8_000,
    })
  ).stdout
  const request = normalizeRequest({
    provider,
    run: 'doctor-disposable-smoke',
    mode: 'read',
    repo: directory,
    allowed_paths: [],
    task: 'Read README.md. Return one JSON object with summary containing its exact marker, and assumptions, risks, follow_ups as empty arrays. Do not modify files or delegate.',
    ...(modelFor(config, provider) === undefined
      ? {}
      : { model: modelFor(config, provider) }),
  })
  if (provider === 'coral')
  {
    const client = await ensureDaemonClient(config)
    let runId: string | undefined
    let timer: NodeJS.Timeout | undefined
    try
    {
      const run = await client.call('create_run', {
        repo: directory,
        targets: [{ provider, model: request.model! }],
        max_assignments: 1,
      })
      runId = run.id
      const admission = await client.call('start_worker', {
        ...request,
        run: run.id,
      })
      timer = setTimeout(() =>
      {
        void client
          .call('close_run', { run: run.id, cancel_active: true })
          .catch(() => undefined)
      }, 60000)
      const summary = await waitForOneTerminal(
        client,
        admission.worker.job_id,
        70
      )
      const job = await client.call('get_worker_result', {
        job_id: summary.job_id,
      })
      const result = job.result
      return {
        status:
          summary.status === 'completed' && result?.summary?.includes(marker)
            ? 'passed'
            : 'failed',
        directory,
        run: run.id,
        job_id: job.job_id,
        requested_model: request.model,
        observed_model: result?.effective_model,
        source_unchanged: result?.changed_files.length === 0,
        reason: result?.error,
        enforcement_verified: false,
      }
    }
    finally
    {
      clearTimeout(timer)
      if (runId)
        await client
          .call('close_run', { run: runId, cancel_active: true })
          .catch(() => undefined)
      await client.close()
    }
  }
  const providers: Record<ProviderName, WorkerProvider> = {
    codex: new CodexProvider(config),
    claude: new ClaudeProvider(config),
    cursor: new CursorProvider(config),
    coral: new CoralProvider(config),
    agy: new AgyProvider(config),
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)

  try
  {
    const outcome = await providers[provider].run({
      job_id: `doctor-${provider}`,
      request,
      worktree: directory,
      job_dir: directory,
      prompt_path: path.join(directory, 'prompt.txt'),
      event_log_path: path.join(directory, 'events.jsonl'),
      stderr_path: path.join(directory, 'stderr.log'),
      model_result_path: path.join(directory, 'result.json'),
      signal: controller.signal,
      on_process_started: async (identity) =>
        await writeFile(
          path.join(directory, 'process.json'),
          JSON.stringify(identity)
        ),
      on_process_finished: async () =>
        await writeFile(path.join(directory, 'process.json'), 'null\n'),
    })
    const sourceUnchanged =
      (await readFile(path.join(directory, 'README.md'), 'utf8')) ===
        `${marker}\n` &&
      (
        await execFileAsync('git', ['diff', 'HEAD', '--', 'README.md'], {
          cwd: directory,
          timeout: 8_000,
        })
      ).stdout === '' &&
      (
        await execFileAsync('git', ['rev-parse', 'HEAD'], {
          cwd: directory,
          timeout: 8_000,
        })
      ).stdout === initialHead
    const observed = outcome.effective_model
    const requested = modelFor(config, provider)
    const successful =
      outcome.exit_code === 0 &&
      outcome.model_result?.summary.includes(marker) === true &&
      sourceUnchanged &&
      (requested === undefined ||
        observed === undefined ||
        requested === observed)
    return {
      status: controller.signal.aborted
        ? 'timeout'
        : successful
          ? 'passed'
          : 'failed',
      directory,
      requested_model: requested ?? null,
      observed_model: observed ?? null,
      model_binding:
        observed === undefined
          ? 'unverified'
          : requested === undefined
            ? 'observed_default'
            : requested === observed
              ? 'matched'
              : 'different',
      source_unchanged: sourceUnchanged,
      enforcement_verified: false,
      note: 'A successful protocol smoke does not certify filesystem or network containment.',
    }
  }
  catch
  {
    return {
      status: controller.signal.aborted ? 'timeout' : 'failed',
      directory,
      reason: 'Inspect the retained native event and stderr logs.',
    }
  }
  finally
  {
    clearTimeout(timeout)
  }
}

export async function runDoctor(
  config: BrokerConfig = defaultBrokerConfig(),
  smoke = false,
  selected: readonly ProviderName[] = PROVIDER_NAMES
): Promise<Record<string, unknown>>
{
  const providers = []
  for (const provider of selected)
  {
    const binary = binaryFor(config, provider)
    const version = await probeTool(binary, ['--version'])
    const help =
      version.status === 'ok'
        ? await probeTool(
            binary,
            provider === 'codex' ? ['exec', '--help'] : ['--help']
          )
        : { status: version.status, output: '' }
    const request = normalizeRequest({
      provider,
      mode: 'read',
      repo: process.cwd(),
      task: 'doctor',
      run: 'doctor-passive-probe',
      allowed_paths: [],
    })
    const flags = [
      '--sandbox',
      '--disable',
      '--permission-mode',
      '--verbose',
      '--ignore-user-config',
      '--tools',
      '--strict-mcp-config',
    ].filter((flag) =>
      new RegExp(`(?:^|\\s)${flag}(?=\\s|=|,|$)`, 'u').test(help.output)
    )
    const capabilities = capabilityEvidence(request).map((entry) =>
      entry.status === 'enforced' &&
      (help.status !== 'ok' || !flags.includes('--disable'))
        ? {
            ...entry,
            status: 'unverified',
            evidence: `${entry.evidence} The installed CLI did not confirm the required flag.`,
          }
        : entry
    )
    providers.push({
      provider,
      binary: await resolveBinary(binary),
      version_status: version.status,
      version:
        version.status === 'ok'
          ? version.output.trim().split('\n')[0]?.slice(0, 160)
          : null,
      help_status: help.status,
      supported_flags: flags,
      configured_model: modelFor(config, provider) ?? null,
      model_binding: 'unverified_until_native_execution',
      capability_evidence: capabilities,
      ...(smoke && help.status === 'ok'
        ? { smoke: await smokeProvider(config, provider) }
        : {}),
    })
  }
  return {
    schema_version: 1,
    build_id: readBuildId(),
    node: process.version,
    providers,
    targets: await discoverTargets(config),
  }
}
