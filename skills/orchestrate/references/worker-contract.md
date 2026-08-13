# Worker contract

Use the worker broker as an asynchronous execution boundary. The lead agent owns the assignment; the broker owns worktree isolation, process lifecycle, Git evidence, and configured verification.

## Tools

### `start_worker`

Submit one assignment and return immediately with a job ID and compact worker metadata.

Required inputs:

- `provider`: a provider currently exposed by the broker;
- `mode`: `read` or `edit`;
- `repo`: absolute path to the source Git repository;
- `task`: narrow objective with enough context for independent execution;
- `allowed_paths`: normalized repository-relative file or directory prefixes.

Optional inputs:

- `base_ref`: Git reference, default `HEAD`; the broker resolves it to an immutable commit when the job is *submitted*, not when it is dispatched — a queued job's base does not follow later integration, so never submit a job whose base does not exist yet;
- `acceptance_criteria`: observable conditions the result must satisfy;
- `setup_commands`: trusted shell commands, optionally with `timeout_seconds`, run in the worktree after creation and before the provider starts (e.g. `pnpm install` for a JS monorepo). A setup failure ends the job in seconds with no model work spent; results are recorded in `setup` with `setup-N.*` artifacts. The broker captures their exact Git tree as an attribution boundary: unchanged setup-only paths stay out of worker evidence, while any later Git-visible delta involving one is rejected because a setup-free worker patch cannot be proven;
- `verification_commands`: trusted shell commands, optionally with `timeout_seconds`;
- `model` and `effort`: provider-specific overrides; Cursor encodes effort in `model` and rejects the generic `effort` field;
- `depends_on`: job IDs that must reach `completed` before this job leaves the queue. Dependencies must exist at submit time, so submit in topological order or the call fails with `unknown dependency job`. Any non-completed dependency rejects the dependent and the rejection cascades down the chain, so triage the first terminal failure in a chain before letting the rest of the phase drain. Declaring a phase pyramid up front is what collapses N waits into one; the exception is a phase that needs an earlier phase's integrated output, whose base ref would already be stale;
- `allow_nested_agents`: default `false` and mechanically disabled where the provider supports it.

Every edit assignment must include an environment plan. Supply `setup_commands` that provision everything broker verification needs, or put an explicit no-broker-verification declaration in the task or acceptance criteria naming the lead's central verification command and when it will run. “Do not run tests” without either declaration is invalid. Worktrees are bare; for a monorepo whose dependencies are already installed centrally, the standard setup pattern is to create `<worktree>/node_modules` as a symlink to the valid shared `node_modules` tree, then run the broker commands. Use a repository-appropriate relative or absolute target and do not assume a worktree inherits the source checkout's dependencies.

Coral headless workers reject nested-agent requests and use deterministic read-only or workspace-write tool catalogs. The workspace-write catalog includes shell execution but excludes Coral's task subagent and direct Git mutation tools; broker scope evidence remains authoritative.

Edit jobs require at least one allowed path. Prefixes are literal, not globs: use `src/auth`, not `src/auth/**`. The broker rejects absolute paths, traversal, Git metadata, and glob characters.

Parent dirt does not block `start_worker`. Worktrees are created from the resolved `base_sha` only; uncommitted parent changes are not copied in. Integration evidence remains base-relative after unchanged setup-only effects are removed. A setup-attribution rejection instead preserves the full `base_sha` to final-worktree patch, including setup effects, as salvage evidence only. The lead owns integrating accepted worker patches onto whatever the parent tree has become, including merge conflicts.

Worktrees start bare: nothing is installed in them. Setup and verification commands run via `/bin/sh -lc` in the worktree with `<worktree>/node_modules/.bin` prepended to `PATH`, so repo-local tool shims resolve once `setup_commands` has installed dependencies.

The atomic start response includes `serializes_behind`: the earlier active edit jobs present at admission in the same repository whose `allowed_paths` overlap the new job's, with the shared paths. Group a wave into these repository/path lanes, estimate each lane including setup and verification, and declare an ETA threshold before launching (30 minutes by default). A non-empty list means this job waits for those jobs FIFO; narrow the scopes or re-gate if the projected lane exceeds the threshold.

### `list_workers`

Return the compact persisted job inventory. Optionally filter by lifecycle status, `run`, or `workflow`.

A job summary carries bounded lifecycle and assignment metadata: `task_preview` (the first 160 code points), `task_bytes`, elapsed time, changed-file and scope-violation counts, `failure_class`, and a bounded error preview when present. It never carries the full task, full error, or result arrays: the lead authored that prompt, and replaying it plus terminal evidence in every list or wait response cost hundreds of kilobytes per wave. Read the full assignment with `get_worker_artifact({ job_id, artifact: 'prompt' })` and fetch full terminal evidence with `get_worker_result` only when needed.

### `get_run_status`

Input: `{ run }`. Return totals by status and per-stage rollups for a run. Use this for dashboards.

### `get_worker_status`

Return the same bounded lifecycle and assignment summary for one job. Use it when one worker is delayed or needs a decision.

### `get_worker_result`

Return the authoritative full terminal broker result, including computed file, scope, setup, and verification arrays. Calling it before the job finishes returns an error rather than partial evidence.

### `wait_for_workers`

Input: `{ run? | job_ids?, timeout_seconds? }`. Target a run or explicit job IDs, including jobs submitted through another client of the same daemon. `timeout_seconds` defaults to 300 and has a maximum of 900. Block until all targeted jobs are terminal or the timeout expires; return `timed_out`, bounded terminal summaries, and `pending`: one entry per still-running worker with `job_id`, `status`, `stage`, `phase`, `elapsed_ms`, and `last_message`.

This is a bounded liveness probe, not a completion channel. Call it once after a launch and read `pending`; re-calling it on an unchanged pending set buys nothing and costs a full response. For a wave that outlives the probe, use the broker's wait CLI below.

### `get_worker_artifact`

Input: `{ job_id, artifact, max_bytes, tail }`, where `artifact` is `prompt|events|stderr|patch|model_result|verification|activity`. Return a bounded content read. Use this instead of shell reads of broker artifact paths.

`activity` is readable while the job is still running: `{ artifact: 'activity', tail: true, max_bytes: 2000 }` is the cheap liveness read for one worker mid-flight. Every other artifact is meaningful only once the job is terminal.

### `cancel_worker`

Cancel queued work immediately or request process-group termination for running work. Cancellation retains the job record and any final Git evidence the broker can safely collect.

## `worker-broker wait` (background completion wake)

The out-of-process wait for a wave that outlives one `wait_for_workers` probe. Run it as a background shell command and treat its exit as the single wake for the wave, instead of re-polling. The `worker-broker` bin is not on `PATH`, so run the absolute form and never the bare name:

```
/opt/homebrew/bin/node /Users/ggfincke/Projects/ggfincke-skills/tools/worker-broker/dist/src/cli.js wait --run <run> --json
```

Select with `--run <run>` or one or more `--job-id <id>`; `--timeout <seconds>` sets the per-call daemon wait (default 900) and the command keeps waiting across calls until the selection is terminal. It connects to the daemon the workers were started on and never spawns one — a spawned daemon would carry a different provider config, so a missing daemon is reported rather than papered over.

The terminal JSON projection is aggregate-only: `selected`, `completed`, `failed`, `rejected`, `cancelled`, `pending`, and `timed_out`, plus `run` when that selector was used. It never repeats per-job summaries or result arrays. Use `get_worker_result` for the selected jobs whose full evidence you need.

Exit codes are the contract a detached caller branches on:

- `0`: every selected worker reached `completed`;
- `1`: every selected worker is terminal but at least one did not complete — triage with `get_worker_result`;
- `2`: terminality was never observed — a malformed invocation, no daemon listening, a selector that matched no workers, or transport loss. Never read `2` as "the wave finished".

## Statuses

- `queued`: accepted but waiting for a non-overlapping edit scope;
- `running`: provider or broker verification is active;
- `completed`: provider and every broker verification command succeeded with no scope drift;
- `failed`: launch, setup, provider, broker, or verification failed;
- `rejected`: final Git-visible paths escaped the assignment or later evidence contains a delta involving a setup-attributed path;
- `cancelled`: the lead or server shutdown stopped the assignment.

Only `completed` is a successful implementation result. A read-only research job may complete with an empty patch. A non-completed result is not automatically disposable: use the salvage gate in [integration-checklist.md](integration-checklist.md) before canceling, relaunching, or discarding it.

A verification exit of 126/127 is reported as an environment failure (command not found or not executable), not a test failure: the worker's patch is preserved at `change.patch`, so fix the environment via `setup_commands`, centrally verify, and salvage the patch instead of re-running the worker.

Queued jobs survive broker restart. Once the replacement daemon owns the state directory, it adopts every nonterminal record, verifies the recorded PID and supervisor token before signalling any surviving broker-owned process group, durably clears that identity, and snapshots the interrupted worktree to `change.patch`. A snapshot with Git-visible changes ends `failed` with `failure_class: broker_fault`; its base-applicable patch remains salvage evidence instead of being overwritten by a retry. Only a proven-clean snapshot may requeue a running job once with a fresh worktree; a second interruption or recovery failure ends durably as `failed`. If ownership or process-group exit cannot be confirmed, or the cleared identity cannot be persisted, startup fail-stops without snapshotting the still-mutable worktree or changing the durable nonterminal owner record. After restart, inventory with `list_workers` and apply the salvage gate to every requeued or failed job. Do not launch a replacement while the original is queued or being requeued. Conflicting edit jobs start FIFO.

Setup, provider, and verification subprocesses use the same ownership contract: exec remains gated until the detached process-group PID and supervisor token are durable, leader exit drains any remaining descendants, and the matching identity is durably cleared before the next phase starts. An ownership-write failure prevents the command or next phase from running and terminalizes without process identity as a `broker_fault` once the group is gone.

## Evidence boundary

The broker captures an exact synthetic Git tree after setup, then compares that tree with the provider and post-verification worktrees for attribution. It calculates integration changes through a temporary index based on `base_sha` and apply-checks each nonempty patch against that immutable base. This captures committed and uncommitted tracked changes, untracked files, deletions, renames, binary changes, mode changes, and Unicode paths without altering either repository index.

If later Git-visible evidence differs at a setup-attributed path, the job is rejected rather than silently excluding the delta. Its `change.patch` is the complete `base_sha` to final-worktree delta and therefore includes setup effects; treat it as salvage evidence only, not a clean worker-only patch. If the post-setup tree itself is unavailable, the same full patch is preserved but the job ends `failed` with `failure_class: broker_fault` because attribution could not be proven.

Scope is checked once after provider execution and again after verification commands. This detects final Git-visible scope drift; it is not hostile-worker containment and does not prove a worker never touched and reverted another file.

Model prose is advisory. Git data, command exit codes, timeouts, and broker status are authoritative.

One daemon owns a state directory and all clients use it through the socket; do not run multiple broker processes against the same state directory or perform manual single-writer/version workarounds.

Terminal results echo the requested `model` and `effort`, plus `effective_model` when the provider reports it.
