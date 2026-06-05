---
name: react-best-practices
description: "Use when writing, reviewing, or refactoring React code for correctness, maintainability, render performance, bundle hygiene, effects, hooks, state design, async waterfalls, TypeScript prop and hook typing, or compiler-friendly patterns. This is React-first and framework-neutral; do not apply Next.js-specific APIs or App Router/RSC guidance unless the target repo already uses Next.js and the user asks for that surface."
---

# React Best Practices

You help write and review React code that is correct first, then fast where it matters. Default to official React guidance for correctness and to the Vercel React Best Practices material for production performance patterns, but keep the result framework-neutral.

Do not introduce framework-specific APIs by habit. In particular, avoid Next.js-only patterns (`next/dynamic`, App Router conventions, route handlers, `after()`, RSC serialization rules, Next `fetch` memoization) unless the repo already uses Next.js and the task explicitly touches that layer.

## First pass

Before changing code, inspect the local React setup:

- React version and whether React Compiler is configured.
- Build framework and router, if any.
- Existing lint rules, especially `eslint-plugin-react-hooks`.
- TypeScript strictness (`strict`, `noUncheckedIndexedAccess`) and the repo's prop/type conventions.
- Existing data-fetching, state, routing, animation, and test conventions.
- Whether the code runs on client-only React, SSR, React Native, or another renderer.

Prefer the repo's existing patterns when they are sound. If existing patterns fight React's rules, fix the pattern locally and explain the reason.

## Priority order

1. Preserve behavior and public APIs unless asked to redesign them.
2. Keep components and Hooks pure: no side effects during render, no mutation of inputs, stable Hook order.
3. Remove unnecessary Effects before adding memoization or abstractions.
4. Fix stale state, dependency, and cleanup bugs before performance-only changes.
5. Reduce async waterfalls and bundle cost where the user would feel them.
6. Optimize re-renders only when the work is expensive, frequent, visible, or already flagged by tooling.
7. Keep code compiler-friendly; do not add manual memoization everywhere.

## Reference routing

Read only what the task needs:

- `references/react-core.md`: always for React correctness, Hooks, Effects, state, forms, refs, context, hydration, accessibility, untrusted content, and compiler-aware choices.
- `references/performance.md`: for async waterfalls, bundle hygiene, render cost, event listeners, transitions, local storage, and JS hot paths.
- `references/typescript.md`: for typing props, hooks, events, generics, and modeling state with discriminated unions in TypeScript React.
- `references/sources.md`: for source attribution and update notes when revising this skill.

## Working rules

- Treat Effects as synchronization with external systems, not as a way to derive render data.
- Prefer render-time derivation, keyed resets, event handlers, reducers, or lifting state over effect-driven state sync.
- Never silence Hook dependency lint casually. Restructure code, split Effects, move event-specific logic to handlers, or use refs only when that matches the data model.
- Avoid `useMemo`, `useCallback`, and `React.memo` as default style. Use them for expensive work, referential stability required by an API, or when the repo lacks React Compiler and profiling/code shape supports it.
- Keep client bundles intentional: direct imports, lazy-load heavy optional UI, and avoid module patterns that force broad dependency inclusion.
- Start independent async work early and await it together. Do not serialize network, storage, or CPU work without a dependency.
- Use `startTransition` or `useDeferredValue` only for non-urgent UI where responsiveness matters.
- Keep server or global mutable state out of React render paths unless the renderer and app architecture make that safe.
- For forms, choose controlled or uncontrolled deliberately and never switch an input between them; reach for React 19 Actions only when the repo is on React 19.
- Keep render deterministic so SSR hydration matches, and never feed untrusted HTML or URLs into `dangerouslySetInnerHTML` or URL props without sanitizing.
- In TypeScript, type the boundaries (props, hook returns, context, reducer actions) and model impossible states out with discriminated unions; let inference handle the rest instead of annotating every local.

## Output expectations

For reviews, lead with confirmed issues and file/line references. Separate correctness bugs from performance opportunities. Do not list generic React advice that does not apply to the code in front of you.

For edits, make the smallest coherent change that fixes the issue across the affected surface. Run the repo's relevant lint/type/test command when available, and include what passed or why it could not run.
