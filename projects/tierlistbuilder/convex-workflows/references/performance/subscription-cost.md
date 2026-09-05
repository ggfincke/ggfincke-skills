# Subscription cost

Use this reference for repeated invalidations, unnecessary live queries, loaded
pagination pages, or UI churn associated with Convex state. Begin with the
[performance guide](guide.md); keep live behavior when the product needs it.

## Count actual query work

`useQuery` observes live data, but hook count is not a one-to-one count of
independent backend subscriptions. The installed Convex client shares identical
query paths and serialized arguments within the same client. Distinct argument
sets and separate clients need separate accounting. A page with twenty cards
does not necessarily make twenty distinct backend queries if some cards request
the same data.

Estimate work from distinct active queries, invalidation frequency, cache reuse,
and each query's read set. This is not a price formula. Separate server query
executions, database bytes, client subscriptions, React renders, and visible
latency; none is a complete proxy for the others.

Loaded `usePaginatedQuery` pages remain live while retained by the hook. Inspect
the actual loaded pages and argument changes, not just a source count of hook
calls. A query can depend on scanned index ranges and joined documents beyond
the fields returned to the UI.

## Choose freshness explicitly

Keep live queries for collaborative editing, presence, live dashboards, and
other surfaces that promise automatic updates. A snapshot may suit a report,
low-churn browse page, or explicit-refresh flow when the product permits stale
data and measurements justify the change.

Use the project's existing authenticated client or server data layer. Do not
create a new unauthenticated `ConvexHttpClient` in a React effect as a substitute
for the current auth/session path. A server fetch requires the appropriate
request identity; a client snapshot must preserve auth changes, logout, and
permission failures. Follow TierListBuilder's UI -> model -> data boundaries.

Any asynchronous snapshot implementation must handle loading, rejection,
unmount, argument changes, and stale responses arriving after a newer request.
Never display the old user's cached data after a session change. Prefer the
existing data abstraction when it already owns these cases.

## Combine related queries only when total work falls

A parent query can return related display fields and avoid many distinct
per-card lookups. It can use a justified join or maintained projection. However,
the combined query may have a broader read set, more frequent invalidations,
larger payloads, or less cache reuse than several narrow queries.

Compare distinct argument sets and shared foreign records before estimating the
benefit. Preserve authorization for each joined record and the list's ordering,
pagination, and missing-record behavior. Do not denormalize or batch solely to
make the hook count smaller.

## Skip requests whose inputs are not ready

Use Convex's literal `"skip"` argument where the existing model/data layer does
not yet have a required ID or authenticated state. An assertion such as
`selectedId!` changes the TypeScript type, not the runtime value; invalid
arguments can fail validation rather than create a useful request.

Contextual hook fragment, inside the appropriate existing model/data boundary:

```ts
const profile = useQuery(
  api.users.getProfile,
  selectedId ? { userId: selectedId } : 'skip'
)
```

The illustrative function and argument names must be replaced with generated
references and actual validators. This is not a request to add a new endpoint.

## Isolate unrelated write churn

If most readers need stable profile fields but not a frequently changing
heartbeat, an approved separate presence document can reduce invalidation.
Inspect all writers and the subscription's actual dependencies. Returning fewer
fields from the same source document does not by itself narrow its database
dependency to those fields.

A coarse online/offline state may update less frequently than a timestamp, but
it changes freshness and expiry behavior. Define that contract and reuse the
existing presence owner before proposing new documents, crons, or components.
Check actual no-op behavior and any trigger wrappers; do not assume every
identical write produces a database invalidation.

OCC retries and subscription invalidations are different measurements. A write
may commit successfully while causing expensive query updates. See
[OCC conflicts](occ-conflicts.md).

## Counts, summaries, and bounded lists

A full reactive scan for a global count can become expensive. Compare an
existing maintained summary, an appropriate aggregate component, or a snapshot
against the required freshness and update load. `@convex-dev/aggregate` is not
an assumed dependency: check the selected version's supported operations and
approve installation and schema ownership before adopting it.

A smaller digest table helps only if it omits unrelated churn and all required
writers maintain it. Bound or paginate its reads too; an unbounded digest scan
is still unbounded. Preserve privacy and visibility updates in the required
transaction. See [hot path rules](hot-path-rules.md).

For long lists, decide whether older loaded pages must stay fresh. Limiting or
evicting pages changes navigation, scroll restoration, and offline expectations;
obtain the intended UX contract before doing it. Snapshot pagination is an
option only when live consistency is not required.

## Make time dependence explicit

`Date.now()` in a query does not cause that subscription to rerun merely because
wall time passes, so a time-dependent result can become stale. Convex also warns
that time-dependent query caching can expire more frequently, adding database
work. These are compatible limitations; do not promise either automatic timer
updates or permanent cache reuse.

An explicit coarsely rounded time argument can define a shared snapshot window,
but the caller must update it and accept its precision. A maintained release or
expiry flag can support indexed reads, but scheduled updates add a state owner,
delay/failure behavior, and operations scope. Pick the existing contract; do not
add a scheduler merely to remove `Date.now()` from a source scan.

## Separate UI churn from backend cost

Loading flashes or render churn on argument changes may call for better state
transitions in the existing model. They do not prove the query is expensive or
that live updates should be removed. Retain honest loading and error state and
do not mask stale or unauthorized data to avoid a spinner.

## Verification

1. Record distinct active query/argument sets and representative workload;
   compare backend execution and read metrics when authorized and available.
2. Check freshness, pagination, joins, auth transitions, errors, and stale-result
   handling after the approved change.
3. Use React profiling or visible interaction evidence for UI claims rather than
   treating fewer subscriptions as proof of a faster interface.
4. Run existing relevant checks and only approved new tests; report unmeasured
   cost and production behavior explicitly.

Sources: [React client](https://docs.convex.dev/client/react/overview),
[best practices](https://docs.convex.dev/understanding/best-practices/), and the
installed `convex` client's `src/browser/sync/local_state.ts` `subscribe` method.
The source/version verification is recorded in [provenance](../provenance.json).
