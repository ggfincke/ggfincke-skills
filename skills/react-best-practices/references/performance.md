# Performance routing

Establish a user-visible or measured cost before optimizing: render duration and cause, input/scroll latency, request waterfalls, emitted bundle size, or repeated browser work. Compare the same workload after the change. Remove unnecessary work before adding caches or indirection; a microbenchmark is not an application measurement.

Read the matching individual rules in `../rules/performance/`. For broad audits, the [generated performance collection](performance-rules.md) contains all 70 rules and links to their sources.

| Concern | Start here |
| --- | --- |
| Independent or conditional async work | [Parallel reads](../rules/performance/async-parallel.md), [partial dependencies](../rules/performance/async-dependencies.md), [conditional await](../rules/performance/async-defer-await.md) |
| Initial bundle or optional features | [Import boundaries](../rules/performance/bundle-barrel-imports.md), [conditional loading](../rules/performance/bundle-conditional.md), [analyzable paths](../rules/performance/bundle-analyzable-paths.md) |
| Client data and browser subscriptions | [Existing data layer](../rules/performance/client-swr-dedup.md), [listeners](../rules/performance/client-event-listeners.md), [storage](../rules/performance/client-localstorage-schema.md) |
| Expensive renders or lagging input | [Memoization](../rules/performance/rerender-memo.md), [derived state](../rules/performance/rerender-derived-state-no-effect.md), [deferred values](../rules/performance/rerender-use-deferred-value.md) |
| Layout, long pages, or hot JavaScript | [Offscreen content](../rules/performance/rendering-content-visibility.md), [DOM writes](../rules/performance/js-batch-dom-css.md), [lookup indexes](../rules/performance/js-index-maps.md) |

Keep framework-neutral React neutral. Use `React.lazy`/Suspense for optional client UI only where the existing loading model supports it. Check cancellation and stale-result handling for Effect-based fetching. Preserve loading dimensions, subscription cleanup, passive-listener semantics, cache bounds/invalidation, and first-match/tie behavior during optimization. Use existing virtualization when justified by list size and interaction cost.

For SSR outside Next.js, retain request-local state, deterministic hydration, safe per-request caching, and bounded serialization without importing Next APIs. Client-only apps skip server rules. For Next-specific examples, first read [Next.js](nextjs.md). Controlled input remains urgent; transitions and deferred values must preserve ordering and correctness.
