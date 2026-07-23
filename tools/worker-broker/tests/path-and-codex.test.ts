// tools/worker-broker/tests/path-and-codex.test.ts
// protect path-prefix semantics & the safety-critical Codex invocation contract

import assert from 'node:assert/strict'
import test from 'node:test'
import type { BrokerConfig, ProviderRunContext } from '../src/contracts.js'
import {
  normalizeAllowedPaths,
  scopeViolations,
  scopesOverlap,
} from '../src/path-scope.js'
import { buildCodexArgs } from '../src/providers/codex.js'

test('path prefixes normalize, collapse children, and reject drift', () => {
  assert.deepEqual(normalizeAllowedPaths(['src/auth/session.ts', 'src/auth']), ['src/auth'])
  assert.deepEqual(scopeViolations(['src/auth/a.ts', 'README.md'], ['src/auth']), [
    'README.md',
  ])
  assert.equal(scopesOverlap(['src/auth'], ['src/auth/session.ts']), true)
  assert.equal(scopesOverlap(['src/auth'], ['src/catalog']), false)
  assert.throws(() => normalizeAllowedPaths(['src/**']), /glob characters/u)
  assert.throws(() => normalizeAllowedPaths(['../outside']), /not normalized/u)
  assert.throws(() => normalizeAllowedPaths(['.git/config']), /Git metadata/u)
})

test('Codex arguments enforce the requested sandbox and nested-agent policy', () => {
  const context: ProviderRunContext = {
    job_id: 'job-1',
    request: {
      provider: 'codex',
      mode: 'edit',
      repo: '/repo',
      base_ref: 'HEAD',
      task: 'change auth',
      allowed_paths: ['src/auth'],
      acceptance_criteria: [],
      verification_commands: [],
      effort: 'high',
      allow_nested_agents: false,
    },
    worktree: '/worktree',
    job_dir: '/job',
    prompt_path: '/job/prompt.md',
    event_log_path: '/job/events.jsonl',
    stderr_path: '/job/stderr.log',
    model_result_path: '/job/result.json',
    signal: new AbortController().signal,
    on_process_started: () => undefined,
  }
  const config: BrokerConfig = {
    state_dir: '/state',
    codex_binary: 'codex',
    cursor_binary: 'cursor-agent',
    coral_binary: 'coral',
    default_codex_model: 'gpt-test',
  }
  const args = buildCodexArgs(context, config)

  assert.deepEqual(args.slice(0, 7), [
    'exec',
    '--cd',
    '/worktree',
    '--sandbox',
    'workspace-write',
    '--json',
    '--ephemeral',
  ])
  assert.ok(args.includes('--ignore-user-config'))
  assert.deepEqual(args.slice(args.indexOf('--disable'), args.indexOf('--disable') + 2), [
    '--disable',
    'multi_agent',
  ])
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), [
    '--model',
    'gpt-test',
  ])
  assert.equal(args.at(-1), '-')
})
