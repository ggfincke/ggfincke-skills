# Performance investigation

Follow the [project workflow](../../SKILL.md). An audit diagnoses and proposes;
it does not apply fixes. An approved optimization implements only the agreed
behavior and files. Trace siblings for correctness, then ask before expanding
the change to unrelated flows.

## Start with one observed problem

Choose a real user flow and record its client callsites, registered functions,
tables, read/write sets, payload sizes, frequency and expected freshness. Prefer
existing user-provided Health/Insights evidence, local traces or a reproducible
failure over guesses. Lack of runtime data is neither proof of health nor a
reason for a large refactor.

The installed Convex CLI supports `insights --details` for cloud deployments.
If the user authorized inspecting that deployment, verify the selector first
and use the installed CLI's documented target option. Local deployments have no
cloud Insights data. Do not fetch `convex@latest`, install `convex-doctor`, change
login/deployment configuration, or create a monitor just to obtain audit data.
Existing optional diagnostics are hints to verify against source and runtime.

| Signal | Reference |
|---|---|
| High documents/bytes read, filtering, repeated joins | [Hot paths](hot-path-rules.md) |
| OCC errors, retries, contended writes | [OCC conflicts](occ-conflicts.md) |
| Many subscriptions, invalidation or React churn | [Subscription cost](subscription-cost.md) |
| Timeouts, payloads, transaction limits | [Function budget](function-budget.md) |

## Trace before proposing

For the scoped flow, inspect reads (`get`, indexed ranges, pagination), writes
(`insert`, `patch`, `replace`, `delete`), cross-component calls, foreign-key reads,
auth/legal guards and denormalized projections. Identify sibling readers and
writers so a proposed optimization does not silently miss a lifecycle branch.

Keep server reads, returned network bytes, cache reuse, client subscriptions,
invalidations and React renders separate. A smaller response does not imply a
smaller database read set. Raw hook counts are not distinct backend query counts.

## Right-size the recommendation

Prefer bounded indexed reads and simple existing helpers before new summary
tables, document splits, components, caches or fetch strategies. A structural
change needs a measured hot path, a clearly unbounded failure mode, or other
concrete evidence; estimate added write/consistency/maintenance costs too.

Preserve exact result membership, ordering, pagination behavior, authorization,
freshness and atomicity. Replacing all results with `take(20)` is not a harmless
optimization. An index prefix can answer a filter while changing tie/order
semantics. A helper can remove a nested rollback boundary. A scheduled derived
write can break an invariant that previously committed atomically.

If an optimization changes persisted shapes, read the
[data-change guide](../migrations/guide.md). Do not automatically add backfills or
compatibility to the current friends-alpha app. Provider, dependency, schema and
architecture changes outside the accepted scope need a separate decision.

## Deliver and verify

For an audit, report each supported issue with source locations, actual evidence,
impact, the smallest proposed change and a focused validation plan. Separate a
measured regression from a code-only risk and reject unsupported speedup claims.

For approved implementation, run existing relevant tests and the project's
surface gates. Add tests only when approved. Compare the same workload before
and after; verify result/order/auth and error paths as well as cost. Report
sibling paths inspected, changed or deliberately left outside scope. If no live
metrics were available, do not label a source simplification a measured win.
