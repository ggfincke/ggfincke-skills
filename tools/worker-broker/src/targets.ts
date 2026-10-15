// tools/worker-broker/src/targets.ts
// report passive provider readiness and reject unverified Antigravity execution

import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROVIDER_NAMES,
  type BrokerConfig,
  type ProviderName,
} from './contracts.js'
import { installedLocalModels, readPowerState } from './local-policy.js'
import { errorMessage } from './errors.js'

export const AGY_AGENT_NAME = 'ggfincke-worker-broker-readonly-v1'
export const AGY_READ_TOOLS = ['view_file', 'grep_search']

export function agyAgentSource(): string
{
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(
    here,
    here.includes(`${path.sep}dist${path.sep}`) ? '../../agents' : '../agents',
    `${AGY_AGENT_NAME}.md`
  )
}

export async function binaryAvailable(binary: string): Promise<boolean>
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
      await access(candidate, constants.X_OK)
      return true
    }
    catch
    {
      /* try the next executable path */
    }
  }
  return false
}

export async function agyReadiness(
  config: BrokerConfig,
  repo?: string
): Promise<string | undefined>
{
  if (!(await binaryAvailable(config.agy_binary ?? 'agy')))
    return 'Antigravity executable unavailable'
  try
  {
    const installed = path.join(
      os.homedir(),
      '.gemini/config/agents',
      `${AGY_AGENT_NAME}.md`
    )
    if (
      (await readFile(installed, 'utf8')) !==
      (await readFile(agyAgentSource(), 'utf8'))
    )
      return 'Antigravity broker agent differs from the canonical definition'
    if (repo)
    {
      for (const suffix of [
        `${AGY_AGENT_NAME}.md`,
        `${AGY_AGENT_NAME}/agent.md`,
      ])
      {
        try
        {
          await access(path.join(repo, '.agents/agents', suffix))
          return 'workspace shadows the broker Antigravity agent'
        }
        catch (error)
        {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    }
  }
  catch (error)
  {
    return `Antigravity agent installation unavailable: ${errorMessage(error)}`
  }
  // remove this release gate only after native tool and ambient hook isolation are verified
  return 'Antigravity read-only release gate failed with agy 1.2.0: the effective tool list included write, command, MCP, and nested-agent tools. No verified runtime is enabled.'
}

export interface WorkerTarget
{
  provider: ProviderName
  model?: string
  inference: 'local' | 'cloud'
  modes: string[]
  available: boolean
  reasons: string[]
}

export async function discoverTargets(
  config: BrokerConfig
): Promise<WorkerTarget[]>
{
  const targets: WorkerTarget[] = []
  for (const provider of PROVIDER_NAMES)
  {
    const model = config[`default_${provider}_model`]
    const target: WorkerTarget = {
      provider,
      ...(model ? { model } : {}),
      inference: provider === 'coral' ? 'local' : 'cloud',
      modes: ['coral', 'agy'].includes(provider) ? ['read'] : ['read', 'edit'],
      available: false,
      reasons: [],
    }
    if (!(await binaryAvailable(config[`${provider}_binary`] ?? provider)))
      target.reasons.push('executable unavailable')
    if (!model)
      target.reasons.push('select an explicit model when creating the run')
    if (provider === 'agy')
    {
      const reason = await agyReadiness(config)
      if (reason) target.reasons.push(reason)
    }
    if (provider === 'coral')
    {
      try
      {
        const models = await installedLocalModels(
          config.coral_host ?? 'http://127.0.0.1:11434'
        )
        const power = await readPowerState()
        if (power !== 'ac')
          target.reasons.push(
            `power is ${power}; AC required unless explicitly authorized on battery`
          )
        if (!models.length) target.reasons.push('no installed local models')
        for (const installed of models)
        {
          targets.push({
            ...target,
            model: installed,
            reasons: [...target.reasons],
            available: target.reasons.length === 0,
          })
        }
        if (models.length) continue
      }
      catch (error)
      {
        target.reasons.push(errorMessage(error))
      }
    }
    target.available = target.reasons.length === 0
    targets.push(target)
  }
  return targets
}
