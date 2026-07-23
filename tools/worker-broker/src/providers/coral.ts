// tools/worker-broker/src/providers/coral.ts
// invoke Coral's headless Agent surface & normalize its native result evidence

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { securePrivateFile, writePrivateFile } from '../artifact.js'
import { assignmentPrompt } from '../assignment-prompt.js'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../contracts.js'
import { parseModelResultText } from '../model-result.js'
import { runProcess } from '../process-runner.js'

export interface CoralExecResult
{
  version: 1
  run_id: string
  status: 'completed' | 'failed' | 'cancelled'
  model: string
  response: string
  error?: string
}

export function parseCoralExecResult(value: unknown): CoralExecResult
{
  if (typeof value !== 'object' || value === null || Array.isArray(value))
  {
    throw new Error('Coral exec result must be an object')
  }
  const result = value as Record<string, unknown>
  if (result.version !== 1)
    throw new Error('Coral exec result version must be 1')
  if (typeof result.run_id !== 'string' || result.run_id === '')
  {
    throw new Error('Coral exec result run_id must be a nonempty string')
  }
  if (
    result.status !== 'completed' &&
    result.status !== 'failed' &&
    result.status !== 'cancelled'
  )
  {
    throw new Error('Coral exec result status is invalid')
  }
  if (typeof result.model !== 'string' || typeof result.response !== 'string')
  {
    throw new Error('Coral exec result model and response must be strings')
  }
  const parsed: CoralExecResult = {
    version: 1,
    run_id: result.run_id,
    status: result.status,
    model: result.model,
    response: result.response,
  }
  if (typeof result.error === 'string') parsed.error = result.error
  return parsed
}

export function buildCoralArgs(
  context: ProviderRunContext,
  config: BrokerConfig,
  nativeResultPath: string
): string[]
{
  const model = context.request.model ?? config.default_coral_model
  if (model === undefined)
  {
    throw new Error(
      'Coral requires a model override or WORKER_BROKER_CORAL_MODEL'
    )
  }
  const args = ['exec', '--cwd', context.worktree, '--model', model]
  if (config.coral_host !== undefined) args.push('--host', config.coral_host)
  args.push(
    '--permission-profile',
    context.request.mode === 'edit' ? 'workspace-write' : 'read-only',
    '--output-format',
    'stream-json',
    '--result-file',
    nativeResultPath,
    '--prompt-file',
    context.prompt_path,
    '--ephemeral',
    '--no-mcp'
  )
  return args
}

export class CoralProvider implements WorkerProvider
{
  readonly name = 'coral' as const

  constructor(private readonly config: BrokerConfig)
  {}

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    const prompt = assignmentPrompt(context)
    await writePrivateFile(context.prompt_path, prompt)
    const nativeResultPath = path.join(context.job_dir, 'coral-result.json')
    let workerSessionId: string | undefined
    const processResult = await runProcess({
      command: this.config.coral_binary,
      args: buildCoralArgs(context, this.config, nativeResultPath),
      cwd: context.worktree,
      stdout_path: context.event_log_path,
      stderr_path: context.stderr_path,
      signal: context.signal,
      on_process_started: context.on_process_started,
      on_stdout_line: (line) =>
      {
        try
        {
          const event = JSON.parse(line) as Record<string, unknown>
          if (typeof event.run_id === 'string') workerSessionId = event.run_id
        }
        catch
        {
          // malformed provider events remain available in the raw log
        }
      },
    }).finally(async () => await securePrivateFile(nativeResultPath, true))

    const outcome: ProviderOutcome = {
      exit_code: processResult.exit_code,
      signal: processResult.signal,
    }
    if (workerSessionId !== undefined)
      outcome.worker_session_id = workerSessionId
    if (processResult.exit_code === 0)
    {
      const nativeResult = parseCoralExecResult(
        JSON.parse(await readFile(nativeResultPath, 'utf8')) as unknown
      )
      if (nativeResult.status !== 'completed')
      {
        throw new Error(`Coral exec ended with ${nativeResult.status}`)
      }
      const modelResult = parseModelResultText(nativeResult.response, 'Coral')
      await writePrivateFile(
        context.model_result_path,
        `${JSON.stringify(modelResult, null, 2)}\n`
      )
      outcome.model_result = modelResult
      outcome.worker_session_id = nativeResult.run_id
    }
    return outcome
  }
}
