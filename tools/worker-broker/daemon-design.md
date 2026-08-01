# Worker-broker daemon design

Single-writer architecture: exactly one daemon process owns a state directory
(`JobManager`, scheduler, reconciliation, git worktree operations, state writes).
Every consumer — stdio MCP servers, the CLI — is a thin client over a unix
socket. Motivated by the 2026-08-01 postmortem
(`456code/dev-docs/orchestrate-workflow-review-2026-08-01.md`): mixed-version
broker processes sharing one state dir crashed fresh jobs, raced worktree
checkouts, and orphaned in-flight work.

## Ownership & lifecycle

- The socket bind is the lock: the daemon binds `state_dir/daemon.sock`
  exclusively; `EADDRINUSE` with a live peer means another daemon owns the dir.
  A dead socket file (connect refused) is cleaned up and rebound.
- On start the daemon writes `state_dir/daemon.json` (`DaemonIdentity`: pid,
  build id, protocol version, state schema version, started_at) and runs the
  existing initialize/reconcile pass. Reconciliation snapshots any surviving
  worktree to `change.patch` BEFORE cleanup so restarts never discard work.
- Clients connect-or-spawn: try the socket; on failure spawn the daemon
  detached from the client's own dist and retry until hello succeeds.
- Upgrade drain: hello carries the client's build id. On mismatch the client
  may call `shutdown {when_idle: true}` — the daemon stops admitting
  `start_worker` (`draining` errors), exits once no job is active, and the next
  client spawn brings up the new build. A busy daemon is never killed; the
  mismatch surfaces as an actionable error naming active jobs.
- Protocol mismatch (frame shape changes) rejects hello outright.

## Wire protocol

One JSON object per line over the socket (`daemon/protocol.ts` is the pinned
contract). Requests are multiplexed by numeric id and answered in completion
order, so a long `wait_for_workers` does not block other calls on the same
connection. First frame must be `hello`. No push events in v1; waits are plain
requests with a server-side timeout clamp.

## Concurrency

- Job admission is unchanged: `scopesOverlap` FIFO lanes per repo. No global
  edit cap — properly disjoint scopes run in parallel (deliberate decision).
- The daemon serializes `git worktree add`/removal per repository through one
  internal queue; checkout races between concurrent starts cannot recur.

## Failure taxonomy

`WorkerResult.failure_class` (`environment | model | broker_fault | scope |
verification`) is assigned wherever a job is failed: setup failures and
verification exits 126/127 → environment; provider spawn/output defects →
model; restart/state/ownership issues → broker_fault; allowed-path violations
→ scope; genuine nonzero verification → verification. Patch capture is
atomic (temp file + rename) and happens after provider exit, before
verification, so every classified failure preserves whatever the model built.

## Versioning

- `DAEMON_PROTOCOL_VERSION` — wire compatibility, checked at hello.
- `STATE_SCHEMA_VERSION` — stamped on persisted job records; the daemon
  refuses to adopt a state dir stamped newer than itself and migrates older
  records in place while holding ownership.
- `dist/build-id.json` — content hash emitted by the build; `readBuildId()`
  returns `dev` for unbuilt source runs.
