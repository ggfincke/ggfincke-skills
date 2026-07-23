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

- `base_ref`: Git reference, default `HEAD`; the broker resolves it to an immutable commit before launch;
- `acceptance_criteria`: observable conditions the result must satisfy;
- `verification_commands`: trusted shell commands, optionally with `timeout_seconds`;
- `model` and `effort`: provider-specific overrides; Cursor encodes effort in `model` and rejects the generic `effort` field;
- `allow_nested_agents`: default `false` and mechanically disabled where the provider supports it.

Coral headless workers reject nested-agent requests and use deterministic read-only or workspace-write tool catalogs. The workspace-write catalog includes shell execution but excludes Coral's task subagent and direct Git mutation tools; broker scope evidence remains authoritative.

Edit jobs require at least one allowed path. Prefixes are literal, not globs: use `src/auth`, not `src/auth/**`. The broker rejects absolute paths, traversal, Git metadata, and glob characters.

Version 1 requires a clean source checkout. Commit or otherwise reconcile parent changes before starting a job; do not ask the broker to guess which dirty state belongs in the assignment.

### `list_workers`

Return the compact persisted job inventory. Optionally filter by lifecycle status. Use this as the normal dashboard instead of polling every worker individually.

### `get_worker_status`

Return current lifecycle and assignment metadata for one job. Use it when one worker is delayed or needs a decision.

### `get_worker_result`

Return the terminal broker result. Calling it before the job finishes returns an error rather than partial evidence.

### `cancel_worker`

Cancel queued work immediately or request process-group termination for running work. Cancellation retains the job record and any final Git evidence the broker can safely collect.

## Statuses

- `queued`: accepted but waiting for a non-overlapping edit scope;
- `running`: provider or broker verification is active;
- `completed`: provider and every broker verification command succeeded with no scope drift;
- `failed`: launch, provider, broker, or verification failed;
- `rejected`: final Git-visible paths escaped the assignment;
- `cancelled`: the lead or server shutdown stopped the assignment.

Only `completed` is a successful implementation result. A read-only research job may complete with an empty patch.

## Evidence boundary

The broker calculates Git changes from the final worktree through a temporary index based on `base_sha`. This captures committed and uncommitted tracked changes, untracked files, deletions, renames, binary changes, and mode changes without altering either repository index.

Scope is checked once after provider execution and again after verification commands. This detects final Git-visible scope drift; it is not hostile-worker containment and does not prove a worker never touched and reverted another file.

Model prose is advisory. Git data, command exit codes, timeouts, and broker status are authoritative.
