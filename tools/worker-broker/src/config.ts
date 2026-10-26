// tools/worker-broker/src/config.ts
// resolve broker storage from the environment & provider settings from one machine-local file

import { createHash } from 'node:crypto'
import { accessSync, constants, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import {
  PROVIDER_NAMES,
  type BrokerConfig,
  type ProviderName,
} from './contracts.js'

// bare names resolve through PATH; anything with a separator must be absolute
const ExecutableSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.includes(path.sep) || path.isAbsolute(value),
    'binary must be a bare command name or an absolute path'
  )

const ConfigFileSchema = z
  .object({
    providers: z
      .partialRecord(
        z.enum(PROVIDER_NAMES),
        z
          .object({
            binary: ExecutableSchema.optional(),
            model: z.string().min(1).optional(),
          })
          .strict()
      )
      .default({}),
    coral_host: z.string().url().optional(),
  })
  .strict()

const BrokerConfigSchema = z
  .object({
    state_dir: z.string().min(1),
    codex_binary: z.string().min(1),
    cursor_binary: z.string().min(1),
    coral_binary: z.string().min(1),
    claude_binary: z.string().min(1),
    agy_binary: z.string().min(1).optional(),
    default_codex_model: z.string().min(1).optional(),
    default_cursor_model: z.string().min(1).optional(),
    default_coral_model: z.string().min(1).optional(),
    default_claude_model: z.string().min(1).optional(),
    default_agy_model: z.string().min(1).optional(),
    coral_host: z.string().min(1).optional(),
  })
  .strict()

// the spawning frontend hands its resolved config to the daemon through this variable
export const DAEMON_CONFIG_VARIABLE = 'WORKER_BROKER_DAEMON_CONFIG'

function defaultStateDirectory(environment: NodeJS.ProcessEnv): string
{
  if (environment.WORKER_BROKER_HOME !== undefined)
  {
    return path.resolve(environment.WORKER_BROKER_HOME)
  }
  const stateHome =
    environment.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state')
  return path.join(stateHome, 'worker-broker')
}

export function brokerConfigFile(
  environment: NodeJS.ProcessEnv = process.env
): string
{
  const configHome =
    environment.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config')
  return path.join(configHome, 'worker-broker', 'config.json')
}

// a missing file means built-in defaults; an unreadable or invalid one fails loudly
function readConfigFile(file: string): z.infer<typeof ConfigFileSchema>
{
  let raw: string
  try
  {
    raw = readFileSync(file, 'utf8')
  }
  catch (error)
  {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return ConfigFileSchema.parse({})
    throw error
  }
  try
  {
    return ConfigFileSchema.parse(JSON.parse(raw))
  }
  catch (error)
  {
    throw new Error(
      `invalid worker-broker config ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    )
  }
}

// pin bare names to their PATH location so the daemon never depends on its inherited PATH;
// symlinks stay unresolved so self-updating CLIs keep working
function resolveExecutable(
  binary: string,
  searchPath: string | undefined
): string
{
  if (binary.includes(path.sep)) return binary
  for (const directory of (searchPath ?? '').split(path.delimiter))
  {
    if (!directory) continue
    const candidate = path.join(directory, binary)
    try
    {
      accessSync(candidate, constants.X_OK)
      return candidate
    }
    catch
    {
      /* try the next PATH entry */
    }
  }
  return binary
}

export function defaultBrokerConfig(
  environment: NodeJS.ProcessEnv = process.env
): BrokerConfig
{
  const file = readConfigFile(brokerConfigFile(environment))
  const binary = (provider: ProviderName, fallback: string): string =>
    resolveExecutable(
      file.providers[provider]?.binary ?? fallback,
      environment.PATH
    )
  const config: BrokerConfig = {
    state_dir: defaultStateDirectory(environment),
    codex_binary: binary('codex', 'codex'),
    cursor_binary: binary('cursor', 'cursor-agent'),
    coral_binary: binary('coral', 'coral'),
    agy_binary: binary('agy', 'agy'),
    claude_binary: binary('claude', 'claude'),
    default_agy_model: file.providers.agy?.model ?? 'gemini-3.8-flash-high',
    default_coral_model: file.providers.coral?.model ?? 'qwen3.8:27b-mlx',
    coral_host: file.coral_host ?? 'http://127.0.0.1:11434',
  }
  for (const provider of ['codex', 'cursor', 'claude'] as const)
  {
    const model = file.providers[provider]?.model
    if (model !== undefined) config[`default_${provider}_model`] = model
  }
  return config
}

export function parseDaemonConfig(raw: string | undefined): BrokerConfig
{
  if (raw === undefined)
    throw new Error(
      `${DAEMON_CONFIG_VARIABLE} is required; start the daemon through a broker frontend`
    )
  // JSON never carries undefined, so optional keys are absent rather than undefined
  return BrokerConfigSchema.parse(JSON.parse(raw)) as BrokerConfig
}

// state_dir is excluded because the socket path already identifies it
export function configFingerprint(config: BrokerConfig): string
{
  const settings = Object.entries(config)
    .filter(([key, value]) => key !== 'state_dir' && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return createHash('sha256')
    .update(JSON.stringify(settings))
    .digest('hex')
    .slice(0, 16)
}

export function configDifferences(
  left: BrokerConfig,
  right: BrokerConfig
): string[]
{
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys]
    .filter(
      (key) =>
        key !== 'state_dir' &&
        left[key as keyof BrokerConfig] !== right[key as keyof BrokerConfig]
    )
    .sort()
}
