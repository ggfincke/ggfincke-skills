# Function budget

Use this reference for execution/read/write limits, excessive payloads, or
unbounded work. Start with the [performance guide](guide.md). A function can be
slow well below a hard limit; a static count is not a latency measurement.

## Current limits are a dated reference

The official [limits page](https://docs.convex.dev/production/state/limits) was
checked on 2026-08-27. Recheck it and the target runtime before quoting a limit
in a finding or designing a batch size.

| Resource | Published limit at that check |
| --- | --- |
| Query/mutation user-code execution | 1 second, excluding database-operation time |
| Action execution | Convex runtime: 30 minutes; Node.js runtime: 10 minutes |
| Transaction data read / written | 16 MiB read and 16 MiB written |
| Scanned documents / index ranges | 32,000 documents, including filtered-out rows; 4,096 ranges |
| Documents written per transaction | 16,000 |
| Individual document / function return | 1 MiB per document; 16 MiB return value |
| Function arguments | 16 MiB, except 5 MiB for Node.js actions |
| Scheduling from one mutation | 1,000 functions; 4 MiB per arguments object, 16 MiB total |
| HTTP action response body | 20 MiB |

These are service limits, not target budgets or a statement of pricing. Actions
are not database transactions; each query/mutation they call has its own
transaction and applicable limits. Runtime-specific constraints still apply.

## Bound the actual read

Review `.collect()` calls whose table or index range can grow, broad residual
filters, repeated foreign-document reads, and large fields read for small list
items. An index narrows a range; it does not establish a fixed maximum size.
Use top-N only for a top-N contract and pagination for a complete browsable set.

A small row count does not prove a small byte count. Size representative
documents without exposing their sensitive values. Mapping a document to a
small returned object saves network payload but not the database read already
performed. Consider a maintained digest only when the read saving justifies its
write and consistency costs. See [hot path rules](hot-path-rules.md).

## Batch changes with durable progress when policy requires them

First read the [migration guide](../migrations/guide.md): the current disposable
alpha policy prefers an approved clean code/data cutover, not an automatic
backfill. Retained-data work requires an approved migration plan.

For an approved batch job, validate the cursor and batch arguments, use a
bounded internal operation, persist or pass the returned continuation cursor,
and stop only when the source reports completion. A cron that repeatedly takes
the first page does not establish progress. Make the transform safe to retry
and define duplicate/concurrent-run behavior.

Treat pagination `numItems` as the requested page size, not a universal hard
bound in every reactive pagination state. Check the installed API's maximum
rows/bytes options where needed, the project's pagination constraints, and
actual read/write work per page. Include per-row lookups and derived writes in
the budget. Do not copy a fixed batch size from an example as capacity proof.

The final batch, empty table, partially transformed rows, restart, failure, and
completion verification matter. Scheduling continuation is not proof that every
row was processed. Keep status and operational target evidence in the approved
migration receipt.

## Choose the action boundary for required work

External APIs, large-file processing, or computation unsuited to a query/mutation
may need an action. Keep database invariants in a validated internal mutation;
an action's separate calls do not form one atomic transaction. Specify retries,
idempotency, and external side effects before moving work across that boundary.

Do not select Node.js merely because an example does. Use it when the needed
library/runtime requires it, and honor the selected runtime's time, memory, and
argument limits. Avoid passing huge or sensitive documents when a stable ID and
an authorized lookup suffice.

## Trim responses without claiming a smaller read set

Return only the fields the client needs, with appropriate return validators and
auth filtering. Preserve required IDs, ordering, nullability, and pagination
metadata. A smaller response is useful, but prove database-read reductions
separately. Do not remove fields or truncate results solely to satisfy a budget
without checking every approved caller.

## Preserve meaningful function-call boundaries

Within a query/mutation, a plain helper can avoid an unnecessary nested
`ctx.runQuery` or `ctx.runMutation` call when it operates in the same context and
no isolation boundary is required. Do not apply that substitution blindly.
Components require calls through their generated references. Nested mutation
calls can also provide partial rollback on a caught failure; inlining their
writes changes that behavior. Any explicitly selected separate transaction is
another boundary to preserve.

Inside an action, a same-runtime helper may avoid an unnecessary `runAction`
invocation. Retain calls that need a different runtime or another required
execution boundary. A separate call has its own overhead and failure behavior;
replacing it can change retries, observability, resource use, and side-effect
ordering. Validate the reason before optimizing invocation counts.

## Verification

1. Record which limit or measured cost motivated the change and which runtime
   and deployment the evidence describes.
2. Check result/auth parity, transaction and rollback behavior, retry safety,
   and batch completion for the affected path.
3. Compare bytes, execution, payload, and latency separately when observations
   are available; otherwise describe only the static improvement or risk.
4. Inspect sibling patterns within scope and run existing focused checks plus
   only tests already approved for the implementation.

Sources: [service limits](https://docs.convex.dev/production/state/limits),
[best practices](https://docs.convex.dev/understanding/best-practices/), and
[pagination](https://docs.convex.dev/database/pagination).
