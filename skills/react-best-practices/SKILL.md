---
name: react-best-practices
description: Write, review, or refactor React and TypeScript React code, including correctness, Hooks, Effects, state, render performance, bundle size, data fetching, Next.js, and component composition. Route to the relevant local references after inspecting the target stack. Framework-neutral React is the default; Next.js APIs require an existing Next.js target and a task touching that surface. Use the separate view-transition playbook for requested motion work.
---

# React Best Practices

Inspect the installed React version, compiler, renderer, router/framework, TypeScript settings, lint rules, and existing data/state/dependency conventions. Select references for the actual task before reading detailed rules. An ordinary React performance request does not imply Next.js.

| Task | Read |
| --- | --- |
| Correctness, Hooks, Effects, state, refs, forms, hydration | [React core](references/react-core.md) |
| Props, hooks, events, context, or reducer typing | [TypeScript](references/typescript.md), plus core as relevant |
| Render cost, loading, bundles, data fetching, JavaScript hot paths | [Performance routing](references/performance.md), then the applicable individual rules |
| Existing Next.js routes, App Router/RSC, caching, server actions | [Next.js](references/nextjs.md), then applicable performance rules |
| Boolean prop proliferation, compound components, context APIs, component architecture | [Composition](references/composition.md), then applicable individual rules |

Preserve behavior and public APIs unless redesign is authorized. Fix correctness and unnecessary work before adding memoization, caches, or abstractions. React Compiler changes the need for manual memoization; do not add it everywhere. A useful abstraction captures present variation or policy, not hypothetical reuse.

Examples assume their framework APIs and libraries already exist in the target or are separately approved. Check installed versions before React 19 APIs, Next.js features, SWR, `better-all`, or `lru-cache`. Do not introduce dependencies merely to follow an example. Impact labels and inherited numerical examples are investigation heuristics; verify meaningful performance claims against the actual workload and emitted bundle.

For reviews, report confirmed issues with file/line evidence and separate bugs from measured opportunities. For implementation, preserve the existing source/test approval boundary, make the smallest coherent change, and run relevant existing lint/type/test commands. A narrow animation request stays within its component or route; use the separate `vercel-react-view-transitions` playbook only when its trigger fits.

The local package contains all required references. [Sources](references/sources.md) records provenance. Individual files under `rules/performance/` and `rules/composition/` are authoritative; their separate compiled references support broad reads without becoming competing summaries.
