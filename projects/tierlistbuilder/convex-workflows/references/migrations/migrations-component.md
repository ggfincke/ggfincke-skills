# Migrations component

Read the [data-change guide](guide.md) and [project scope gates](../../SKILL.md)
before considering this package. It was not installed in TierListBuilder at the
maintenance check. The current disposable-alpha policy does not require adding
it; use it only for an approved retained-data migration or another explicit need.

Primary references: [component overview](https://www.convex.dev/components/migrations)
and the [maintained source guide](https://github.com/get-convex/migrations).

## Adoption and setup

Confirm the selected package version, installed SDK compatibility, task need and
dependency approval. Mount its exported component config through the existing
`app.use(...)` while preserving other mounts/env declarations. Generate through
the authorized target workflow and inspect the generated `components.migrations`
reference rather than hand-writing it.

The app owns migration functions and table access; the component stores progress
and coordinates batches. Instantiate `Migrations` using the selected version's
actual constructor and schema contract. Current source supports a `schema`
option, which is required for `customRange` pagination; the old guide's generic
type parameter alone is not sufficient evidence of that setup. If existing app
wrappers enforce write behavior, preserve that behavior through the documented
custom internal-mutation integration instead of bypassing it.

## Definitions and progress

`migrations.define` identifies the table and a `migrateOne` operation. Design the
operation to be deterministic for its inputs, idempotent on retry, bounded per
document and consistent with all existing projections and lifecycle writes.
Returning a patch is a supported shorthand in the current guide; verify the
installed version before adopting it.

Do not add external network effects inside a database migration or treat a
successful cursor as proof of domain correctness. New live writes must already
populate the target shape before backfill starts. Keep migration identities and
code stable during a run, or explicitly plan cancellation/restart/versioning.

## Operations are separate actions

The selected component's documented operation shapes include:

| Need | API or CLI function shape to verify for the installed version |
|---|---|
| Start one migration | Its exported migration function; `runOne` from app code |
| Named general runner | `migrations.runner()` with a full migration name |
| Ordered series | A runner with a function list, `next`, or `runSerially` |
| Read status | Component `lib:getStatus` or `getStatus` |
| Cancel progress | Component `lib:cancel` or `cancel` |
| Restart | `reset: true`, potentially affecting an entire specified series |

Inspect the generated function and target before invoking any of these. A status
query is not equivalent to start/cancel/reset. Do not create a watch or recurring
monitor unless requested. A canceled migration may already have committed earlier
batches; cancel is not data rollback.

Retries resume from recorded progress; completed or already running migrations
can be skipped/no-ops. Overlapping series need deliberate ordering, because a
shared in-progress migration can prevent later work in one series from running.
Record which migrations and cursors actually completed, not only the CLI exit.

## Dry-run and recovery boundary

The documented `dryRun: true` path executes one batch and throws so its database
writes do not commit. It is not a full-dataset proof or a guarantee of no reads,
logs or other effects. Use isolated fixtures first, inspect the installed
implementation, and obtain target-specific approval for a live dry run.

Restart/reset can revisit previously processed rows. Prove idempotency and
understand group-wide cursor resets before using it. A chosen cursor must come
from valid recorded progress; do not invent one. Preserve recovery data and
source state, and never revert unrelated work to unwind a failed migration.

## Batches, subsets and concurrency

Choose batch size from document bytes, touched rows, indexes, scheduled work and
contention, not a universal count. Reduce the batch for heavy rows. `customRange`
needs the actual schema/index setup and must not omit the population the
migration is intended to cover.

Keep per-document work serial unless it is independent. `parallelize: true`
does not make read-modify-write updates to a shared counter safe; callbacks in
the same batch can overwrite assumptions about prior updates. Preserve order
where stateful transformations depend on it.

## Release integration and completion

Do not paste a generic deploy-and-run production shell chain into this project.
Its release controller and current data policy own the operation sequence.
After an approved run, verify business invariants, remaining old-shape rows,
projections and live-write behavior before narrowing. Record status, failures,
resumption and the remaining deployment step. No package or live migration was
installed or run merely by maintaining this reference.
