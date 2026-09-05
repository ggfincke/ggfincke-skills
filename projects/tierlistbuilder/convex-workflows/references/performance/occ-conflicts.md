# OCC conflicts

Use this reference when evidence shows transaction conflicts, repeated mutation
retries, or contention-related latency. Read the [performance guide](guide.md)
first. A static contention risk is not proof that a deployment is experiencing
OCC errors.

## Identify the conflicting dependency

Convex uses optimistic concurrency control to provide serializable mutations.
A transaction records the documents and ranges it reads; a conflicting change
before commit can force a retry. Merely overlapping two reads is not a conflict,
and OCC is not limited to two explicit writes to the same document.

Distinguish these observations:

| Observation | Investigation |
| --- | --- |
| Reported OCC conflicts or retries | The mutation's read/write set and concurrent writers |
| A hot shared counter or parent timestamp | Which mutations depend on that document |
| A broad read followed by a write | Which unrelated writes intersect the scanned range |
| Many reactive query updates | Subscription invalidation, not automatically mutation contention |
| Slow requests without conflict evidence | Function work, network, client rendering, and other causes |

Use existing logs or explicitly authorized read-only deployment diagnostics.
Do not fetch an unpinned CLI or contact a production deployment just to make the
audit look measured. Record the target, observation window, and available rate
or latency data without copying sensitive document contents.

## Reduce the read set first

An indexed owner/range lookup can avoid reading unrelated rows before a
mutation. Preserve the required set and order; an indexed `.collect()` can still
grow too large. Use a bounded read only when the operation's semantics permit
it. See [hot path rules](hot-path-rules.md) and
[function budget](function-budget.md).

Inspect transaction-local helpers and triggers, not only the top-level handler.
Their extra reads and writes participate in the same transaction. Independently
scheduled mutations are separate transactions and can compete with one another.
A read/write feedback loop in the UI can create redundant mutations; do not
mistake ordinary reactive reads for additional writes.

## Split a proven contention point carefully

A single global count, shared settings row, or parent activity timestamp can
couple unrelated writers. A narrower document boundary or sharded counter may
help when the measured conflict pattern justifies the added state.

Before proposing sharding, define exact versus approximate totals, reads across
shards, initialization, update/delete symmetry, authorization, and any required
atomic invariant. A random-shard sketch is not a complete counter design. Reuse
an appropriate installed owner when available; adding a counter package or
changing the schema needs approval and the current data-policy gate.

## Schedule only work allowed to lag or fail independently

Analytics, noncritical notifications, or cache warming may not belong in the
primary write transaction. Required projections, ownership changes, or data
whose consistency is part of the operation must remain atomic unless the user
approves a new consistency contract.

For approved deferred work, schedule the minimum necessary payload. Do not copy
names, tokens, or other sensitive values when a stable identifier and event kind
will do. Specify retry/idempotency, failure visibility, and whether the consumer
may see a later document state. A committed schedule is not proof that an
external side effect has completed or occurred exactly once.

## Combine operations only when their boundary matches

If one user action requires two updates to commit together, a single mutation
can avoid a race between separate calls. Do not combine independent operations
solely to reduce invocation counts, or remove component/subtransaction
boundaries that provide needed rollback behavior. Artificial locks and queues
add failure modes; introduce them only for a concrete requirement after simpler
read-set and state-boundary changes have been assessed.

Splitting high-churn data can also reduce live query invalidation, but measure
that separately. See [subscription cost](subscription-cost.md).

## Verification

1. Compare conflicts/retries and latency over comparable workloads when those
   observations are available; otherwise label the result a static risk review.
2. Check atomicity, exact counts, permissions, retry safety, and deferred-work
   failure behavior for the approved change.
3. Inspect sibling writers within scope and report remaining shared causes.
4. Run existing relevant checks; add only tests included in the approved plan.

Source: [Convex OCC and atomicity](https://docs.convex.dev/database/advanced/occ).
