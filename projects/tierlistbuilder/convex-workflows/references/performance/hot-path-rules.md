# Hot path rules

Use this reference for read amplification, indexes, denormalization, document
size, or writes that invalidate many live queries. Start with the
[performance guide](guide.md); an audit does not authorize source changes.

## Measure the complete path

Trace the entrypoint, auth checks, table/index ranges, joined documents, result
size, and writers that can invalidate those reads. Read volume per request
multiplied by request and invalidation frequency is a useful estimate, not a
billing formula or proof of a performance win. Distinguish database bytes,
network bytes, server work, and browser rendering.

Inspect sibling list/search endpoints and writers that share the same tables or
helpers. Report the shared cause, but change siblings only within the approved
scope. Do not expand a focused fix into a schema redesign automatically.

## Narrow storage reads without changing results

An index range can reduce scanned documents. A residual Convex `.filter()` or
JavaScript filter does not turn a broad scan into a narrow index read; documents
scanned and rejected still consume the applicable read budget. Residual filters
can be appropriate after a sufficiently narrow indexed range. Text search needs
the matching search index and has different ordering and matching semantics.

For a paged list, use the existing index whose leading fields match the equality
conditions, then the intended range and ordering. Use a bounded top-N read only
when the contract is top-N; use pagination when every result must remain
reachable. Replacing `.collect()` with `.take(20)` silently drops results when
the original contract required the complete set. Even an indexed `.collect()`
can be unbounded.

### Missing values and index cutover

An absent optional boolean does not equal `false`. An index equality on `false`
can omit older rows without that field. Verify actual shapes and the required
membership before switching a read; comments claiming a backfill completed are
not evidence.

Read the [data-policy gate](../migrations/guide.md) before proposing a migration.
TierListBuilder's disposable alpha policy does not authorize adding dual reads
or backfills to preserve old alpha data. If durable retained data is now required,
approve the widen/write/backfill/verify/cutover sequence before changing reads.

### Index overlap is not identical ordering

A compound index can serve a query constrained by its leading field. However,
`[team]` orders equal-team rows by `_creationTime`, whereas `[team, user]` orders
them by `user` before `_creationTime`. Keep both when callers need both orders.
Check all consumers, pagination cursors, uniqueness assumptions, and write/storage
cost before recommending index removal. No index deletion follows from matching
prefixes alone.

## Reduce repeated joins deliberately

A hot list that loads a large foreign document for one display field may benefit
from an existing maintained projection. First identify its owner and freshness
contract. Small indexed joins may already be cheap enough; a new projection adds
writes, invariants, and schema lifecycle work.

When an existing contract treats a denormalized field as an optional cache, a
missing or null value must take the defined authoritative fallback. Preserve
valid falsy values. A lookup map must distinguish a usable cached record from a
present key containing incomplete data; otherwise it can suppress that fallback.
Do not replace missing data with a placeholder when the existing behavior
requires a live lookup. Apply auth and deletion rules to any fallback read.

This is not a universal instruction to introduce legacy-shape compatibility.
If the projection is required by the current clean schema, fix its writer or
surface the invariant failure according to the app contract. Choose rollout
behavior under the current [migration policy](../migrations/guide.md).

## Read smaller documents when the saving warrants the owner

Mapping a full document to a small response reduces its outgoing payload; it
does not undo reading the original document from the database. A digest or
summary table can reduce database reads when the source rows are much larger
than a high-volume list needs. It is not the default for a small table or a
cheap indexed query.

Before adding one, establish measured or estimated row sizes and traffic,
identify all writers, and specify which fields must change atomically with the
source. Consider an existing companion table before creating another parallel
representation. Bound the digest query too. Required privacy, ownership, and
visibility changes must reach the digest within the promised consistency model.

## Keep unrelated churn out of widely read documents

Real changes to a frequently read document can invalidate readers even if their
returned fields did not change. Separating heartbeat or ephemeral status from
stable profile data can reduce that coupling when evidence warrants it. Trace
every writer; moving one heartbeat while other paths still patch the original
document leaves the same invalidation source.

Do not justify a new no-op guard with an unsupported claim that every identical
patch invalidates subscriptions. Distinguish Convex's database behavior from
custom wrappers or triggers: a wrapper may perform additional reads, derived
writes, or external work even when the intended source value is unchanged.
Compare the relevant old/new values where needed, and check the actual installed
wrapper rather than assuming a trigger implementation exists.

## Preserve consistency when moving work

Live queries remain appropriate for collaboration, presence, and dashboards
that promise immediate freshness. A snapshot or explicit refresh can suit
reports or lower-freshness lists only when the product contract permits it and
the ongoing cost is material. See [subscription cost](subscription-cost.md).

Transaction-local triggers add their reads and writes to the initiating
transaction. Keep required projections and authorization-sensitive state
atomic. Only move genuinely independent bookkeeping to scheduled work after its
delay, retry, failure, and payload contract is approved. Scheduling a required
projection is a behavior change, not a free optimization.

Global statistics can use a maintained summary, an approved aggregate component,
or a snapshot depending on freshness and volume. `@convex-dev/aggregate` and
`convex-helpers` are not assumed dependencies. Evaluate the pinned package API
and obtain approval before adding a component, cron, or trigger framework.

For retained-data backfills, use bounded progress and a verified cursor or
selected migrations component. Writers must preserve the approved transition
invariant, readers must handle only the states the plan permits, and completion
must be demonstrated before removing transition code. Do not apply that pattern
to disposable alpha data without a policy change.

## Evidence to close an approved fix

1. Compare result membership, ordering, auth, and missing-value behavior before
   and after, including any permitted transition state.
2. Show which database reads or invalidations were removed; distinguish response
   projection from reduced database work.
3. Check projection writers, transaction boundaries, and sibling callers within
   scope; report unapproved follow-ups separately.
4. Run the existing focused checks and only the tests approved for this change.
5. State measured results separately from estimates and untested production
   behavior. Do not promise cost savings from source inspection alone.

Sources: [Convex best practices](https://docs.convex.dev/understanding/best-practices/),
[indexes](https://docs.convex.dev/database/reading-data/indexes/), and
[transaction limits](https://docs.convex.dev/production/state/limits).
