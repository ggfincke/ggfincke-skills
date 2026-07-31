// tools/worker-broker/src/providers/codex.ts
// invoke Codex noninteractively with broker-owned boundaries & structured prose output

import { fileURLToPath } from 'node:url'
import { securePrivateFile, writePrivateFile } from '../artifact.js'
import { assignmentPrompt } from '../assignment-prompt.js'
import type {
  BrokerConfig,
  ProviderOutcome,
  ProviderRunContext,
  WorkerProvider,
} from '../contracts.js'
import { readJson } from '../json.js'
import { parseModelResult } from '../model-result.js'
import { runProcess } from '../process-runner.js'

const MODEL_RESULT_SCHEMA = fileURLToPath(
  new URL('../../../schemas/model-result.schema.json', import.meta.url)
)

export function buildCodexArgs(
  context: ProviderRunContext,
  config: BrokerConfig
): string[]
{
  const { request } = context
  const args = [
    'exec',
    '--cd',
    context.worktree,
    '--sandbox',
    request.mode === 'edit' ? 'workspace-write' : 'read-only',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--output-schema',
    MODEL_RESULT_SCHEMA,
    '--output-last-message',
    context.model_result_path,
  ]
  if (!request.allow_nested_agents) args.push('--disable', 'multi_agent')
  const model = request.model ?? config.default_codex_model
  if (model !== undefined) args.push('--model', model)
  if (request.effort !== undefined)
  {
    args.push(
      '--config',
      `model_reasoning_effort=${JSON.stringify(request.effort)}`
    )
  }
  args.push('-')
  return args
}

export class CodexProvider implements WorkerProvider
{
  readonly name = 'codex' as const

  constructor(private readonly config: BrokerConfig)
  {}

  async run(context: ProviderRunContext): Promise<ProviderOutcome>
  {
    const prompt = assignmentPrompt(context)
    await writePrivateFile(context.prompt_path, prompt)
    let workerSessionId: string | undefined
    let effectiveModel: string | undefined
    const processResult = await runProcess({
      command: this.config.codex_binary,
      args: buildCodexArgs(context, this.config),
      cwd: context.worktree,
      stdin: prompt,
      stdout_path: context.event_log_path,
      stderr_path: context.stderr_path,
      signal: context.signal,
      on_process_started: context.on_process_started,
      on_stdout_line: (line) =>
      {
        try
        {
          const event = JSON.parse(line) as Record<string, unknown>
          if (
            event.type === 'thread.started' &&
            typeof event.thread_id === 'string'
          )
          {
            workerSessionId = event.thread_id
          }
          if (typeof event.model === 'string') effectiveModel = event.model
        }
        catch
        {
          // malformed provider events remain available in the raw log
        }
      },
    }).finally(
      async () => await securePrivateFile(context.model_result_path, true)
    )

    const outcome: ProviderOutcome = {
      exit_code: processResult.exit_code,
      signal: processResult.signal,
    }
    if (workerSessionId !== undefined)
      outcome.worker_session_id = workerSessionId
    if (effectiveModel !== undefined) outcome.effective_model = effectiveModel
    if (processResult.exit_code === 0)
    {
      const modelResult = await readJson(context.model_result_path)
      outcome.model_result = parseModelResult(modelResult, 'Codex')
    }
    return outcome
  }
}
