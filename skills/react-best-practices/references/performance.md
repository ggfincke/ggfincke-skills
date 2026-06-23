# React Performance Practices

Use this reference for production performance work in React apps. It adapts framework-neutral parts of Vercel's React Best Practices and avoids Next.js-specific APIs by default.

## Contents

- [Performance stance](#performance-stance)
- [Async waterfalls](#async-waterfalls)
- [Suspense and loading](#suspense-and-loading)
- [Bundle hygiene](#bundle-hygiene)
- [Client data fetching](#client-data-fetching)
- [Event listeners and browser APIs](#event-listeners-and-browser-apis)
- [Re-render work](#re-render-work)
- [Transitions and deferred work](#transitions-and-deferred-work)
- [Rendering and layout](#rendering-and-layout)
- [JavaScript hot paths](#javascript-hot-paths)
- [Server-rendered React](#server-rendered-react)

## Performance stance

Optimize code the user can feel or the tools can show:

- Slow input, scrolling, animation, route, or interaction.
- Expensive render work in hot components.
- Async waterfalls on visible screens.
- Large initial bundles or heavy optional features loaded up front.
- Repeated subscriptions, listeners, storage reads, parsing, or data transforms.

Do not make speculative micro-optimizations that make code harder to read. Prefer removing unnecessary work over caching unnecessary work.

Measure before optimizing, and confirm the win after:

- React DevTools Profiler for render counts, durations, and what triggered a commit.
- The `eslint-plugin-react-hooks` rules, and React Compiler's ESLint rule when configured, to catch dependency and purity issues that cause extra renders.
- A bundle analyzer for size regressions before reaching for code splitting.

If a change does not move a number you can point to, it is not a performance fix.

## Async waterfalls

Avoid accidental sequential async work:

- Start independent promises before awaiting.
- Use `Promise.all` for independent work.
- Check cheap synchronous conditions before awaiting remote flags, auth, or data.
- Move an `await` inside the branch that needs the value.
- For partial dependencies, start the independent work first and await the dependency only where required.

Bad shape:

```ts
const user = await getUser()
const settings = await getSettings()
const items = await getItems()
```

Better:

```ts
const userPromise = getUser()
const settingsPromise = getSettings()
const itemsPromise = getItems()

const [user, settings, items] = await Promise.all([
  userPromise,
  settingsPromise,
  itemsPromise,
])
```

When async work depends on user interaction, start it from the event if that preserves behavior. For render-time data, follow the app's existing data layer rather than inventing a new one.

## Suspense and loading

Use Suspense only where the app already supports it or the framework/data layer is compatible.

- Put boundaries where partial loading improves perceived speed.
- Keep fallbacks stable in size to avoid layout shift.
- Do not wrap every component in Suspense.
- Do not convert imperative client fetching to Suspense without checking framework support and tests.

## Bundle hygiene

Keep bundles intentional:

- Prefer direct imports over barrel imports when barrels pull in broad modules.
- Avoid dynamic paths that bundlers cannot statically analyze.
- Lazy-load heavy optional UI with `React.lazy` and `Suspense` when it is not needed for first paint.
- Defer analytics, recording, editors, charts, maps, rich text, syntax highlighting, and export tools until needed.
- Preload optional heavy UI on hover/focus only when it improves a real workflow.
- Do not add a new library for small utilities already available in the platform or repo.

For framework-specific dynamic imports, use the framework's existing convention only if the repo already uses one.

## Client data fetching

Prefer the repo's existing data-fetching layer:

- TanStack Query, SWR, Relay, Apollo, router loaders, or custom services if already present.
- Do not add a data-fetching library just to dedupe one request.
- Deduplicate shared reads at the data layer instead of firing the same request from sibling components.
- Use cleanup/race guards for Effect-based fetches.
- Keep request keys stable and derived from canonical params.

Effect-based fetching is acceptable for simple client-only apps, but it should handle cancellation or stale results.

## Event listeners and browser APIs

Avoid repeated global listeners:

- Register shared listeners once when possible.
- Clean up listeners, observers, timers, and subscriptions.
- Use passive listeners for scroll/touch events that do not call `preventDefault`.
- Keep listener callbacks stable if add/remove identity matters.
- Cache repeated storage reads if they happen on hot paths.

For `localStorage` and `sessionStorage`:

- Version stored data when shape can change.
- Parse once per use site or centralize through a helper.
- Keep values small and avoid storage as reactive state.

## Re-render work

Reduce re-renders by improving state shape first:

- Subscribe to the smallest value a component needs.
- Derive booleans/selectors near the store or parent when it avoids broad updates.
- Split components at natural boundaries when expensive children do not need parent state.
- Hoist default non-primitive props out of render.
- Avoid creating component types inside render.
- Keep context provider values stable when consumers are broad.

Use `React.memo` only when:

- The child is expensive or frequently re-rendered.
- Props are stable enough for memoization to work.
- The comparison cost is lower than the skipped render.
- React Compiler is absent or cannot cover the case.

Avoid `useMemo` for simple primitive expressions. It adds overhead and noise.

## Transitions and deferred work

Use concurrency APIs for non-urgent UI:

- `startTransition` for updates that can lag behind urgent input.
- `useDeferredValue` when a derived expensive view can trail the latest input.
- Keep controlled input state urgent; transition the expensive filtering/rendering result.

Do not put correctness-critical state in a transition just to hide slowness.

## Rendering and layout

Prefer browser-friendly rendering:

- Animate transforms and opacity instead of layout-affecting properties.
- Animate a wrapper around SVG when direct SVG animation is costly.
- Use CSS classes or CSS variables for grouped style changes.
- Use `content-visibility` for long offscreen sections when browser support and layout constraints fit.
- Keep loading and conditional states dimensionally stable.
- Use ternaries or explicit `null` for conditionals where `&&` can accidentally render `0`.
- Reduce unnecessary SVG precision in large static assets.

For long lists, use the repo's existing virtualization pattern or add one only when list size and interaction cost justify it.

## JavaScript hot paths

Use straightforward data structures before clever code:

- Build a `Map` or `Set` for repeated lookups.
- Combine repeated `filter`/`map` passes only in hot paths.
- Hoist regular expressions created in loops.
- Avoid sorting just to find min/max.
- Cache expensive pure function results when inputs repeat and memory bounds are acceptable.
- Use `requestIdleCallback` or a scheduler abstraction for non-critical browser work when available.

Do not contort cold code for microbenchmarks.

## Server-rendered React

If the repo uses SSR but not Next:

- Do not keep request-specific mutable data in module scope.
- Avoid serializing large duplicate props into the client payload.
- Start independent server reads in parallel.
- Use per-request caches only when the framework provides a safe request boundary.

For hydration-mismatch correctness (non-deterministic render, browser APIs in render, `suppressHydrationWarning`), see the Hydration section in `react-core.md`.

If the repo is client-only, skip server guidance.
