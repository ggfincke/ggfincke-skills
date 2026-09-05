# Retained-data migration patterns

Read the [data-change guide](guide.md) first. These patterns apply only when the
current policy and approved task require retaining data across a change. They
are not a directive to add compatibility to TierListBuilder's disposable alpha.

## Common transformations

| Transformation | Required sequence and invariant |
|---|---|
| Add a required field | Widen to optional, make all new writers populate it, backfill a justified value, verify missing/invalid rows, then require it |
| Delete a field | Make removal schema-compatible, stop dependent readers/writers, remove data under the approved retention policy, verify, then remove the schema field |
| Change a type | Prefer a distinct target field when that makes conversion/recovery explicit; validate the source and target rather than inventing fallback values |
| Split nested data into a table | Define a stable parent/key relation and idempotent insertion/update; copy allowed fields explicitly, handle existing target rows, then remove the old representation when safe |
| Remove orphans | Prove the relationship is absent using the correct index and current lifecycle rules; respect legal holds, soft deletion and cleanup ownership |

In a validated migration, removing an optional field uses a patch with
`undefined`, not `null`; these are different data states. A context fragment is:

```ts
await ctx.db.patch('teams', team._id, { legacyField: undefined })
```

The actual table, field and deletion policy must exist in the approved schema.
Do not expose an unrestricted public cleanup endpoint. If a target value already
exists, verify it before removing its source; a guard that skips every existing
target can leave old fields behind and block narrowing.

## Extracting related records

Use an indexed lookup for the parent/key pair and an explicit duplicate policy.
Within the same transaction, create or update the target and remove/mark the
source only after successful conversion. Copy a validated allowlist of fields;
do not spread a source object after a trusted owner ID where it could overwrite
that ID. New writes must use the target owner during the rollout too.

Preserve parent/child delete, restore, import, seed, projection and legal-hold
paths. A successful one-time backfill cannot compensate for a writer still
creating the old shape.

## Dual-write versus dual-read

Use either only for a bounded approved retention window with an exit condition.

**Dual-write:** write both representations atomically while readers stay on the
old format; backfill; switch readers; finally stop old writes. This may preserve
rollback to specific compatible releases, but it does not guarantee rollback
after destructive cleanup or to arbitrary old code. Account for added write and
consistency cost.

**Dual-read:** readers understand both representations and prefer a validated
new one, while writers produce only the new format. This avoids duplicate writes
but can make rollback to old-only readers unsafe. Distinguish a missing value
from a legitimate `false`, `0` or empty value; do not replace valid data using
truthiness fallback.

Temporary handling must have a removal condition and tracked owner. Do not
leave a permanent compatibility layer merely because it was once needed.

## Small bounded transformations

A single internal mutation can suffice if the entire read/write/byte workload
is proven within transaction limits and the input is truly bounded. A claim
such as "a few thousand rows" is insufficient because row sizes and secondary
writes vary. Reuse current job/transaction machinery; avoid an unbounded
`.collect()` example as the default shortcut.

For larger work, use cursor-based bounded continuation or an approved
[migrations component](migrations-component.md). Carry the returned cursor,
handle partial pages, await scheduling and ensure idempotency. Do not use a cron
that repeatedly reads the first unchanged batch.

## Verification

1. Check both the component/job state and the domain invariant. Use an internal,
   bounded query or existing operator path rather than adding a public audit API.
2. An indexed `take(1)` for remaining missing values can prove absence for that
   predicate if the index and predicate are correct; a sample of converted rows
   cannot prove global completion. Verify invalid values and duplicates too.
3. Recheck concurrent/new writers, relationship integrity, permissions, required
   projections and recovery availability before narrowing.
4. Run existing relevant tests and controlled fixtures. New tests require an
   approved plan; live commands require a verified authorized target.
5. Record what was actually checked and the remaining release action. Do not
   report a planned or local-only conversion as a completed live migration.
