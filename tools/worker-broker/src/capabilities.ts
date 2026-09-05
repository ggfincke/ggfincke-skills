// tools/worker-broker/src/capabilities.ts
// distinguish native controls from instructions and reject unproven guarantees

import type {
  CapabilityEvidence,
  NormalizedWorkerRequest,
} from './contracts.js'
import { RequestValidationError } from './request.js'

export function capabilityEvidence(
  request: NormalizedWorkerRequest
): CapabilityEvidence[]
{
  const nativeDisabled =
    request.provider === 'codex' && !request.allow_nested_agents
  const shellPhases =
    request.setup_commands.length > 0 ||
    request.verification_commands.length > 0
  return [
    {
      capability: 'native_no_nesting',
      scope:
        'provider-native delegation tools only; excludes shell-launched agent binaries',
      status: 'unverified',
      layer: nativeDisabled ? 'prevention' : 'instructions',
      evidence: nativeDisabled
        ? 'The Codex adapter requests native prevention with --disable multi_agent. Flag support and a protocol smoke do not verify effective tool exclusion in the installed runtime. Shell-launched agents are outside this control.'
        : 'No verified native delegation prohibition is established by this adapter.',
    },
    {
      capability: 'no_nested_agents',
      scope:
        'all provider, setup, and verification subprocesses, including shell-launched agents',
      status: 'unverified',
      layer: 'instructions',
      evidence:
        'The prompt prohibits unauthorized nesting; agent binaries are not removed from every subprocess capability set.',
    },
    {
      capability: 'filesystem_read_only',
      scope:
        'filesystem writes by provider, setup, and verification subprocesses',
      status:
        shellPhases || request.mode === 'edit' ? 'unsupported' : 'unverified',
      layer: 'detection',
      evidence: shellPhases
        ? 'Broker shell phases are not wrapped in an enforced read-only filesystem boundary.'
        : 'Read/plan flags and an empty final Git patch do not establish an effective filesystem-wide write prohibition.',
    },
    {
      capability: 'filesystem_workspace_only',
      scope:
        'filesystem access by every job subprocess, restricted to its worktree',
      status: shellPhases ? 'unsupported' : 'unverified',
      layer: 'detection',
      evidence:
        'Native sandbox flags do not prove worktree-only access; allowed_paths checks only the final Git-visible delta. Runtime, temporary, and user-configuration access must also be accounted for.',
    },
    {
      capability: 'network_disabled',
      scope:
        'tool and shell network access in all job phases; excludes provider model transport',
      status: shellPhases ? 'unsupported' : 'unverified',
      layer: 'instructions',
      evidence:
        'No verified network prohibition covers every tool and broker shell subprocess.',
    },
  ]
}

export function requireCapabilities(
  request: NormalizedWorkerRequest
): CapabilityEvidence[]
{
  const evidence = capabilityEvidence(request)
  const unmet = evidence.filter(
    (entry) =>
      request.required_capabilities?.includes(entry.capability) &&
      entry.status !== 'enforced'
  )
  if (unmet.length > 0)
  {
    throw new RequestValidationError(
      `required capabilities unavailable: ${unmet.map((entry) => `${entry.capability} (${entry.status}): ${entry.evidence}`).join('; ')}`
    )
  }
  return evidence
}
