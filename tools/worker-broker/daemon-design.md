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
  existing initialize/reconcile pass. Reconciliation signals a recorded group
  only after its PID and supervisor token positively identify broker-owned work,
  then durably clears both before snapshotting the interrupted worktree. A
  Git-dirty snapshot ends `failed` with a base-applicable salvage patch; only a
  proven-clean snapshot may requeue once. If ownership or group exit cannot be
  confirmed, or the cleared identity cannot be persisted, startup fail-stops
  without snapshotting or changing the durable nonterminal owner record.
- Every setup, provider, and verification process is a detached group whose exec
  gate opens only after its PID and supervisor token are durable. The runner
  terminates and awaits any descendants left after the group leader exits, then
  the matching finish callback durably clears the identity before the next phase
  may start.
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
connection. First frame must be `hello`. Protocol 3 carries bounded worker
summaries on routine lifecycle methods; waits are plain requests with a
server-side timeout clamp. Full records cross the wire only through the
explicit `get_worker_result` method.

## Persistence

- `job.json` is the authoritative full record. The manager retains full jobs
  only while they are nonterminal and evicts them after the terminal write.
- Versioned `job.json` records serialize the reserved top-level
  `state_schema_version` as the final property. The bounded cache fingerprint
  treats true absence as an unversioned legacy record and rejects any detected
  version newer than this build.
- A terminal `summary.json` is an additive cache with its own schema version,
  the writer's supported state-schema version, and the authoritative file's
  stat fingerprint. It is trusted only when its structure, both versions, job
  ID, terminal status, and fingerprint all match.
- Missing, corrupt, newer, stale, or cache-only summaries fall back to
  `job.json`; terminal fallback may repair the cache without rewriting the
  authoritative record. The full write commits first, and a later summary
  failure never rejects that durable mutation or leaves an older cache trusted.

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
- `STATE_SCHEMA_VERSION` — owned by `job-store.ts` and stamped on authoritative
  job records. The store rejects newer records and normalizes absent legacy
  list fields only in memory while reading; it never migrates `job.json` in
  place.
- `SUMMARY_SCHEMA_VERSION` — owned independently by `job-store.ts`; an
  unsupported summary is discarded as cache and rebuilt from `job.json`.
- `dist/build-id.json` — content hash emitted by the build; `readBuildId()`
  returns `dev` for unbuilt source runs.
