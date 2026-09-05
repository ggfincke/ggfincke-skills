# Schema and data changes

Follow the [project workflow](../../SKILL.md). This guide plans retention-aware
changes only after the current TierListBuilder data policy and user scope permit
them. Reading a migration guide does not authorize data writes or a deployment.

## Decide whether migration is appropriate

Read `convex/README.md` and `docs/deployment.md#current-data-posture` before each
schema or persistence break. At this maintenance check, friends-alpha breaking
changes used a clean contract and disposable data, without legacy aliases,
dual-read compatibility or migrations merely to preserve alpha rows. Local/dev
reset is guarded; production uses a fresh deployment and the release controller,
never `db:reset` on `prod:*`.

After the explicit durability-promotion gate, retained data uses
`widen -> migrate -> narrow`, with recovery credentials, sealed artifacts and
retention policy established. Do not assume that promotion occurred, or decide
to reset data because the app is pre-1.0. Either operational path needs approval
for the exact target and effects.

## Classify the requested change

| Change | Questions before implementation |
|---|---|
| Optional field or new table | Is a backfill actually needed? Which current writers/readers change? |
| Required field, removed field or changed type | What data exists, which policy applies, and how is the cutover verified? |
| Index change | Does ordering, missing-field behavior or rollout readiness change? |
| Split/merge or nested-to-relational data | What owns every lifecycle write and reference? |
| No existing data | Prefer the intended schema; do not add migration scaffolding without a need |

Convex schema validation checks existing data when enabled. A widened shape can
allow old/new states during an approved retained-data rollout; it is not a reason
to disable validation. Required fields cannot be deployed over missing values
without a compatible data/cutover plan.

## Approved retained-data sequence

1. Define the invariant, source/target shape, dataset/deployment identity,
   recovery route, expected volume and verification query. Capture dirty source
   state; never use a whole-tree reset as migration rollback.
2. Deploy a widened schema and the necessary read/write handling using the
   authorized release process. Ensure new writes cannot recreate unmigrated rows.
3. Backfill in bounded, resumable, idempotent batches. Reuse existing job machinery
   or consider the [migrations component](migrations-component.md) only when an
   approved dependency/adoption decision warrants it.
4. Verify completion and domain invariants, including live writes, orphan or
   duplicate references, permissions and required denormalized projections. A
   component's finished cursor alone does not prove every business invariant.
5. Narrow in a later authorized deploy and remove temporary compatibility only
   after its exit condition is proven. Review recovery after narrowing; old code
   may no longer safely interpret the new data.

## Preserve data deliberately

Prefer a new field when it makes conversion and rollback clearer, but do not
keep deprecated fields indefinitely. Deletion, archival and retention follow
the approved policy and legal holds. A schema rollback cannot recreate deleted
data; recovery must cover both code and state.

For common conversions, see [migration patterns](migration-patterns.md). It
retains required-field, deletion, type-change, table-extraction, orphan-cleanup,
dual-read/write, small-table and verification guidance. Those are conditional
tools, not the default policy for today's disposable alpha.

## Operational safeguards

Do not run a migration because a command is labeled `dryRun`. Inspect the
installed implementation: a dry run may execute one batch against live data and
write logs or external effects even when its database transaction rolls back.
Use controlled fixtures first. Deployment, start, reset, cancel and import/export
all have distinct effects; approve and record each target-bound action.

Do not schedule a cron to repeatedly process the first page. Continuations must
carry progress or prove processed rows leave the next selection. Do not change
the migration body while an old run is still executing without a compatibility
and cancellation/resumption decision.

## Completion evidence

Report source hashes, target identity, accepted policy, batches/cursor or job
status, invariant checks, error/retry handling, recovery state and the exact
remaining deploy step. If only a plan or local fixture was completed, say so;
do not claim deployed data is migrated.
