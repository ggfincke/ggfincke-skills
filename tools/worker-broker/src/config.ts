// tools/worker-broker/src/config.ts
// resolve stable broker storage & provider defaults from explicit environment inputs

import os from 'node:os'
import path from 'node:path'
import type { BrokerConfig } from './contracts.js'

function defaultStateDirectory(
  environment: NodeJS.ProcessEnv = process.env
): string
{
  if (environment.WORKER_BROKER_HOME !== undefined)
  {
    return path.resolve(environment.WORKER_BROKER_HOME)
  }
  const stateHome =
    environment.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, 'worker-broker')
}

export function defaultBrokerConfig(
  environment: NodeJS.ProcessEnv = process.env
): BrokerConfig
{
  const config: BrokerConfig = {
    state_dir: defaultStateDirectory(environment),
    codex_binary: environment.WORKER_BROKER_CODEX_BINARY ?? 'codex',
    cursor_binary: environment.WORKER_BROKER_CURSOR_BINARY ?? 'cursor-agent',
    coral_binary: environment.WORKER_BROKER_CORAL_BINARY ?? 'coral',
    agy_binary: environment.WORKER_BROKER_AGY_BINARY ?? 'agy',
    default_agy_model:
      environment.WORKER_BROKER_AGY_MODEL ?? 'gemini-3.8-flash-high',
    default_coral_model: 'qwen3.8:27b-mlx',
    coral_host: 'http://127.0.0.1:11434',
    claude_binary: environment.WORKER_BROKER_CLAUDE_BINARY ?? 'claude',
  }
  if (environment.WORKER_BROKER_CODEX_MODEL !== undefined)
  {
    config.default_codex_model = environment.WORKER_BROKER_CODEX_MODEL
  }
  if (environment.WORKER_BROKER_CURSOR_MODEL !== undefined)
  {
    config.default_cursor_model = environment.WORKER_BROKER_CURSOR_MODEL
  }
  if (environment.WORKER_BROKER_CORAL_MODEL !== undefined)
  {
    config.default_coral_model = environment.WORKER_BROKER_CORAL_MODEL
  }
  if (environment.WORKER_BROKER_CLAUDE_MODEL !== undefined)
  {
    config.default_claude_model = environment.WORKER_BROKER_CLAUDE_MODEL
  }
  if (environment.WORKER_BROKER_CORAL_HOST !== undefined)
  {
    config.coral_host = environment.WORKER_BROKER_CORAL_HOST
  }
  return config
}
