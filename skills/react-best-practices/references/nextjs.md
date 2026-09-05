# Next.js scope and prerequisites

Load this route only when the repository already uses Next.js and the task touches its routes, server/client boundary, cache, or build behavior. Inspect the installed version, App versus Pages Router, runtime, and project data/cache conventions before applying examples. Verify version-sensitive APIs against the target's installed code or current primary documentation.

Use the same [performance collection](performance-rules.md); no second ownership or duplicate rule summary is needed. Start with the relevant sources:

- [Route waterfalls](../rules/performance/async-api-routes.md) and [server component fetching](../rules/performance/server-parallel-fetching.md).
- [Server action authentication](../rules/performance/server-auth-actions.md), [request-local caching](../rules/performance/server-cache-react.md), and [request state](../rules/performance/server-no-shared-module-state.md).
- [Serialization boundaries](../rules/performance/server-serialization.md) and [duplicate props](../rules/performance/server-dedup-props.md).
- [Next dynamic imports](../rules/performance/bundle-dynamic-imports.md) and [nonblocking work](../rules/performance/server-after-nonblocking.md).

Do not move required writes into best-effort work, bypass authentication through a cache, introduce shared request state, or infer bundle exclusion from a runtime guard. Preserve the project's router, navigation history, focus and scroll behavior. Framework migration and dependency changes require task authorization.
