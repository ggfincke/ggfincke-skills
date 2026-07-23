---
name: orchestrate
description: Lead multi-part repository work by establishing architecture and acceptance criteria, dividing it into non-overlapping packages, delegating bounded research, review, or implementation through the worker-broker MCP tools, inspecting broker-computed Git and verification evidence, and owning final integration. Use when work spans independent subsystems, benefits from native Codex, Cursor, or Coral workers, or needs parallel read-only exploration, review fan-outs, or isolated implementation worktrees.
---

# Orchestrate

Own the overall design, delegation boundaries, integration, and final correctness. Treat workers as bounded executors; never delegate architectural ownership or accept their prose as evidence.

## Establish the change

1. Inspect the repository instructions and enough live code to understand the relevant boundaries.
2. State the intended behavior, invariants, acceptance criteria, and final validation commands.
3. Identify independent work packages. Keep cross-cutting interfaces and integration sequencing in the lead session.
4. Delegate only when a package has a concrete objective and an unambiguous file or directory scope.

Do not delegate merely to avoid understanding the change. Keep tightly coupled edits in one package or perform them in the lead session.

## Define each assignment

Include every field required by [worker-contract.md](references/worker-contract.md):

- objective and relevant architectural context;
- provider, mode, repository, and immutable base reference;
- normalized repository-relative allowed path prefixes;
- forbidden behavior and scope boundaries;
- acceptance criteria and broker-run verification commands;
- model and effort only when the assignment needs an explicit override.

Use configured providers according to [routing-policy.md](references/routing-policy.md). Never request a provider that the broker does not currently expose.

## Run workers

1. Call `start_worker` once per bounded assignment and retain each returned job ID.
2. Use `list_workers` for a compact dashboard and `get_worker_status` when one job needs attention.
3. Let read-only work run concurrently. Launch overlapping edit scopes sequentially; the broker also queues them conservatively.
4. Use `cancel_worker` when an assignment is obsolete, mis-scoped, or no longer safe.
5. Call `get_worker_result` only for terminal jobs.

Do not expand a running assignment. Cancel it and start a replacement with the corrected contract.

## Evaluate results

Treat these broker-computed fields as authoritative:

- status and process exit information;
- base and head commit identities;
- changed paths, scope violations, and binary patch;
- verification commands, exit codes, timeouts, and output artifacts.

Treat the worker summary, assumptions, risks, and follow-ups as leads to inspect. Reject `failed`, `rejected`, or unverified results; never integrate them as successful work.

Read [integration-checklist.md](references/integration-checklist.md) before applying or merging a worker result. The full normalized result shape is available at [worker-result.schema.json](assets/worker-result.schema.json).

## Complete the change

1. Inspect every patch and resolve cross-package assumptions yourself.
2. Integrate only accepted, in-scope results in the intended dependency order.
3. Run repository-wide validation from the integrated checkout; worker-local checks are not final proof.
4. Report failed or cancelled workers, unverified assumptions, deferred work, and residual risk.

Do not push, publish, or open pull requests unless the user separately authorizes that action.

## Commit discipline

Never leave orchestration commits behind. The broker requires a clean checkout and
sequenced waves need prior work in the base commit, so temporary integration commits
during a run are acceptable — but once the final wave is integrated and validated,
soft-reset them (`git reset <pre-orchestration-base>`) so the user reviews one dirty
working-tree diff. Commit permanently only when the user explicitly asks, and then
propose logically-grouped commits per the working-conventions skill.
