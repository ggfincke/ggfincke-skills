---
name: orchestrate
description: Opt-in worker-broker orchestration for multi-part repository work that needs an explicit provider, model, worker-budget, and approval plan. Use only when the user affirmatively asks to run or invoke orchestrate for the current task, such as `/orchestrate`, an imperative `$orchestrate` directive, or an unambiguous natural-language request to use orchestrate. Do not activate for contextual mentions, prior use, inspection or discussion of the skill, generic requests to use workflows or subagents, or while a current instruction not to orchestrate remains unreversed.
---

# Orchestrate

## Activation boundary

Treat loading or mentioning this skill as distinct from invoking its worker workflow. Activate only from an affirmative current-task directive such as `/orchestrate ...`, `$orchestrate ...` used imperatively, or “use orchestrate for this.”

Do not activate for:

- a contextual link, prior-use reference, or comparison involving orchestrate;
- a request to inspect, discuss, debug, or modify the skill itself;
- generic permission to use workflows, agents, subagents, delegation, or parallel work;
- an acknowledgment such as “lgtm” after the user has said not to orchestrate.

A current instruction not to orchestrate wins and remains binding until the user explicitly reverses it. Ordinary subagents remain independent of this skill and follow the host's normal delegation policy without an orchestrate plan.

Own the overall design, delegation boundaries, integration, and final correctness. Treat workers as bounded executors; never delegate architectural ownership or accept their prose as evidence.

## Run discipline

A host may inject these as a collaboration-mode block (456code does); this list is the portable statement for hosts that do not. Each line is normative: run one phase at a time and hold the rest with `depends_on`; address a wave by `run` and read evidence through broker tools rather than the shell; announce a wave before launching it and never leave a running wave silent; keep one durable run checkpoint; stop lead-side shell work at six consecutive commands with no intervening `start_worker`, `get_worker_result`, or user turn; salvage a non-completed result before relaunching it; never claim a self-scheduled resume. The rest of this file supplies the mechanisms and formats, not a second copy of the rules.

## Establish the change

1. Inspect the repository instructions and enough live code to understand the relevant boundaries.
2. State the intended behavior, invariants, acceptance criteria, and final validation commands.
3. Identify independent work packages. Keep cross-cutting interfaces and integration sequencing in the lead session.
4. Delegate only when a package has a concrete objective and an unambiguous file or directory scope.

Before the first wave, run a lightweight broker preflight with `daemon_status` (or an equivalent read call). Confirm the client and daemon build IDs match and that the daemon is not draining. The daemon owns single-writer access plus build, protocol, and state-schema compatibility; surface `build_mismatch` or `draining` errors and resolve them through the daemon lifecycle, never by working around them.

Do not delegate merely to avoid understanding the change. Keep tightly coupled edits in one package or perform them in the lead session.

After intake, continue the orchestrate workflow only when at least one bounded worker-broker assignment meets the routing-policy conditions. If none does, do not emit a zero-worker plan: state that no broker run is warranted and continue under the ordinary lead or subagent workflow unless the user asked only for an orchestration proposal.

## Model plan and approval gate

Before any `start_worker` call, resolve and present a model plan per [model-plan.md](references/model-plan.md):

1. Parse `workflow=`, per-stage `<stage>=provider[:model[:effort]]` overrides, and `--yes` from the invocation; infer the workflow template when not pinned.
2. Resolve each stage's provider, model, effort, mode, and worker count from the precedence chain (broker defaults, global and repository profile bindings, gate edits, inline arguments).
3. Emit the resolved plan — persist via the host's `orchestrate_plan_upsert` tool when exposed and then print the `orchestrate-plan` fenced block as its render anchor, else the fenced block alone — and gate on user approval (which may arrive as an `<orchestrate_plan_response>` envelope; see model-plan.md). Launch workers without approval only on an explicit `--yes`; with no responsive user and no `--yes`, report the plan and stop.
4. Treat the approved plan as a budget: exceeding `maxWorkers` or changing a stage's provider or model re-gates before more workers launch.

The session model is the orchestrator; the plan governs the approved broker execution path and its workers. It does not gate lead-owned work or ordinary subagents.

## Run checkpoint

One file per run, in the integration checkout: `.plans/runs/<runId>.md` where the repository has a plan directory (456code does, and that path is git-ignored), otherwise an untracked `.orchestrate/runs/<runId>.md`. Never a numerically ordered plan file — those are durable designs, not run state. Template:

```markdown
# run <runId> — <task>

- integration: <absolute repo path> @ <branch> (base <sha>)
- plan: revision <n>, maxWorkers <n>, used <n>
- validation: <exact commands>
- next: <one action>

## phases
| phase | status | gate |
|---|---|---|

## jobs
| job id | stage | phase | scope | disposition |
|---|---|---|---|---|
```

`disposition` is one of accepted / salvaged / rejected / cancelled / outstanding. Job status itself stays the broker's to answer: keep the mapping here and read status from `get_run_status`, so a missed write cannot make this file lie.

## Define each assignment

Include every field required by [worker-contract.md](references/worker-contract.md):

- objective and relevant architectural context;
- provider, mode, repository, and immutable base reference;
- normalized repository-relative allowed path prefixes;
- forbidden behavior and scope boundaries;
- acceptance criteria and broker-run verification commands;
- setup commands whenever verification needs the repository toolchain — worktrees start bare with no installed dependencies, so a bare tool name fails with exit 127 no matter how good the patch is;
- model and effort from the approved model plan's stage binding, or an explicit per-assignment override.

Every edit assignment must carry an environment plan: either `setup_commands` that provision the broker verification environment, or an explicit no-broker-verification declaration naming the lead's central verification command and when it will run. A bare “do not run tests” instruction is invalid. Use the standard monorepo `node_modules` symlink setup described in [worker-contract.md](references/worker-contract.md) when a shared install is appropriate.

Scope discipline: never grant one shared file — a lockfile, a root manifest such as a shared `tests/package.json` — to every worker in a wave. Any shared prefix makes the edit scopes overlap, and overlapping edit jobs serialize FIFO, turning a parallel wave into a multi-hour chain. Have workers report missing shared-file changes (new dependency declarations, manifest entries) as follow-ups, and apply them centrally in the lead during integration.

Use configured providers according to [routing-policy.md](references/routing-policy.md). Never request a provider that the broker does not currently expose.

## Run workers

1. Before an edit wave, group jobs by repository and overlapping `allowed_paths` into serialization lanes. Include setup and verification in each lane's wall-clock estimate, declare an ETA threshold in the plan (30 minutes by default), and account for shared manifests such as `tests/package.json` that can turn a whole wave into one FIFO lane.
2. Call `start_worker` once per bounded assignment and retain each returned job ID. Inspect `serializes_behind` in every start response; stop and re-gate the wave if its projected lane ETA exceeds the declared threshold. Use `depends_on` when a worker must wait for prior jobs to complete; a non-completed dependency rejects the dependent and the rejection cascades down the chain. Dependencies must already exist at submit time, so submit in topological order. Only one phase runs at a time; declaring the whole pyramid up front is what collapses N waits into one. The exception is a phase that needs an earlier phase's integrated output: `base_ref` resolves to an immutable commit when a job is submitted, so submit that phase after the integration lands rather than queueing it ahead.
3. Use `get_run_status` for run dashboards, `list_workers` with optional `run` or `workflow` filters for inventory, and `get_worker_status` when one job needs attention. On the first terminal failure in a wave, pause new launches, classify it from `failure_class` and broker evidence, record the classification and chosen action, then continue. Unrelated read-only jobs may proceed; do not defer triage to wave end.
4. Let read-only work run concurrently. Conflicting edit jobs start FIFO; keep semantic conflicts and integration order explicit with `depends_on`.
5. Use `cancel_worker` when an assignment is obsolete, mis-scoped, or no longer safe, but apply the salvage gate below before canceling, relaunching, or discarding any non-completed terminal job.
6. Call `get_worker_result` only for terminal jobs.

Do not expand a running assignment. Cancel it and start a replacement with the corrected contract.

## Progress visibility

The run-discipline list above carries the norms; these are the mechanics that satisfy them.

1. Immediately after launching, call `wait_for_workers` once with the `run` and a bounded timeout (default 300 seconds, maximum 900). It is a liveness probe, not a completion channel: read its `pending` entries — `job_id`, `status`, `stage`, `phase`, `elapsed_ms`, `last_message` — as the wave's first real snapshot, and never re-call it on an unchanged pending set.
2. For any wave that outlives that probe, start `worker-broker wait --run <run> --json` as a background shell command and let its exit be the single wake; [worker-contract.md](references/worker-contract.md) carries the absolute command and its three exit codes. For one job mid-flight, `get_worker_artifact` with `artifact: "activity"`, `tail: true`, `max_bytes: 2000` is the cheap liveness read.
3. On every wake — a completion exit, monitor event, or user message — lead with a one-to-two-line progress line: `N/M workers done; <what just finished>; next: <step>; ~<time> remaining`. Then continue working.
4. At each wave boundary (all results collected, integration starting, validation running), post the same short progress line unprompted.
5. For waves expected to run 15+ minutes while the user is likely away, send a PushNotification on wave completion or first failure.

Keep updates to one or two lines; the audit/plan artifact holds the detail. Never fabricate progress for a worker whose result has not arrived.

## Evaluate results

Treat these broker-computed fields as authoritative:

- status and process exit information;
- requested model and effort, plus `effective_model` when the provider reports it;
- base and head commit identities;
- changed paths, scope violations, and binary patch;
- verification commands, exit codes, timeouts, and output artifacts.

Treat the worker summary, assumptions, risks, and follow-ups as leads to inspect. Apply the salvage gate in [integration-checklist.md](references/integration-checklist.md) to every non-completed terminal result before canceling, relaunching, or discarding it.

Use `get_worker_artifact` for bounded patch, event, stderr, model-result, prompt, and verification reads; do not read broker artifact paths through the shell. Read [integration-checklist.md](references/integration-checklist.md) before applying or merging a worker result. The full normalized result shape is available at [worker-result.schema.json](assets/worker-result.schema.json).

## Recovery after a daemon restart or a context compaction

After a compaction, reconcile in this order: the run checkpoint, then `get_run_status`, then `list_workers({ run })`. The broker is authoritative for job status and evidence; the checkpoint is authoritative for intent — which job belonged to which package, what you had already accepted, and what the next action was. Relaunch nothing until the two agree.

The daemon reconciles automatically: it snapshots each interrupted worktree to `change.patch` before cleanup and performs one automatic requeue. Inventory the run with `list_workers`, apply the salvage gate to every requeued or failed job, and never launch a replacement while the original is queued or being requeued. For a build upgrade, use `worker-broker daemon status` and `worker-broker daemon stop --when-idle`; do not kill a busy daemon or bypass its drain.

## Complete the change

1. Inspect every patch and resolve cross-package assumptions yourself.
2. Integrate only accepted, in-scope results in the intended dependency order.
3. Run repository-wide validation from the integrated checkout; worker-local checks are not final proof.
4. Report failed or cancelled workers, unverified assumptions, deferred work, and residual risk.

Do not push, publish, or open pull requests unless the user separately authorizes that action.

## Commit discipline

Never leave orchestration commits behind. Temporary integration commits during a
run are for sequenced waves that must share prior integrated work in the next
base — not because the broker demands a clean checkout. Once the final wave is
integrated and validated, soft-reset them (`git reset <pre-orchestration-base>`)
so the user reviews one dirty working-tree diff. Commit permanently only when the
user explicitly asks, and then propose logically-grouped commits per the
working-conventions skill, each carrying the harness attribution defined in
[integration-checklist.md](references/integration-checklist.md).
