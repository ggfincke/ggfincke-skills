# Component boundaries

Follow the [project workflow](../../SKILL.md). This guide covers an approved
component design or change; an architecture review stops at recommendations.
Creating a package, adding a dependency, mounting an HTTP route or deploying a
component requires the corresponding user scope.

## Choose the smallest justified boundary

Use a component when isolated tables, persistent workflows or a reusable backend
API justify it. Ordinary helpers, one-off product logic and app orchestration
usually belong in the existing TypeScript/module boundaries.

| Need | Read |
|---|---|
| Isolated backend state used only by this app | [Local component](local-components.md) |
| Explicit reuse across apps or an npm package | [Packaged component](packaged-components.md) |
| Explicit local override plus shared-library requirement | [Hybrid component](hybrid-components.md) |
| Callback handles, validators, configuration or client facade | [Advanced patterns](advanced-patterns.md) |

Infer the goal from the task and repo; ask only for an unresolved decision. Plan
owned tables, API/validators, auth and tenant inputs, env bindings, HTTP exposure,
failure/transaction boundaries and data cutover before implementation.

## Shape and call path

A local component has its own `convex.config.ts`, schema, function modules and
generated server/API types, normally under `convex/components/<name>/`.

```ts
import { defineComponent } from 'convex/server'

export default defineComponent('notifications')
```

Mount the definition with `app.use(...)` in the existing app config; preserve
all current env declarations and components. Do not replace TierListBuilder's
config with a minimal `defineApp()` example. Use the component's own generated
builders for its functions. App callers use the generated `components` reference
and `ctx.runQuery`, `ctx.runMutation` or `ctx.runAction`, not a direct call of the
reference object. Include the module segment:

```ts
await ctx.runMutation(components.notifications.lib.send, {
  userId: user._id,
  message,
})
```

This context fragment assumes the app already resolved and authorized `user`
with its existing guards. A component function exported as public is callable
by its parent app, but is not directly exposed to browser clients. Create an
intentional app wrapper for client access with full argument/result validators.

## Auth, IDs and environment

Components do not receive the app's `ctx.auth`. The app owns authentication and
authorization, passing only the identifiers/capabilities required. Preserve
session revocation, account status, ownership, rate limits and legal holds.
Treat caller IDs as strings across the component boundary; a component cannot
validate an app table ID with its own `v.id('users')` namespace.

Current Convex supports component-declared typed environment variables and app
bindings through `app.use(component, { env: ... })`. Read the installed SDK's
types and [authoring docs](https://docs.convex.dev/components/authoring#environment-variables)
before using them. Do not claim components have no env support, or assume they
inherit arbitrary app secrets. Read runtime env inside handlers, never at module
scope during deployment analysis. Prefer explicit approved bindings over putting
secret values in ordinary function arguments that may be logged or persisted.

## HTTP and pagination

Current components can define `http.ts` routes. The app exposes them only through
an explicit `httpPrefix` mount; no mount means no component route exposure.
Review URL conflicts, authentication and request validation before adding it.
When a handler needs app auth or app data, keep the established app HTTP wrapper.
See [component HTTP routes](https://docs.convex.dev/components/using#http-routes).

Built-in reactive `.paginate()` does not work inside components as it does in an
app query. The current authoring docs recommend the `convex-helpers` paginator
and matching client integration for that case. It is not presently an installed
TierListBuilder dependency: decide whether the feature truly needs it, obtain
dependency scope, and verify its installed API rather than inventing a cursor
loop or silently adding the package. An explicitly bounded top-N component query
may use an indexed `take(n)` when that is the intended contract.

## Transactions and verification

Component mutation calls participate in the caller's transaction, with a nested
rollback boundary when a component call throws and the caller catches it.
Preserve that boundary and keep required source/projection writes atomic. Do
not catch authorization/rate-limit errors merely to continue a forbidden write.

Generated references do not exist until the relevant codegen succeeds. Inspect
the installed codegen command and selected deployment before using it; it may
write files or contact a service. Never hand-edit `_generated/` or run `convex dev`
as an unapproved validation shortcut. After authorized generation, inspect its
diff, typecheck, run existing relevant component/app tests and verify the actual
app wrapper. Tests belong in the project's existing harness, not automatically
inside `convex/`, and new tests require an approved plan.

For packaged work, exercise built output through a consumer before claiming the
package works. Publishing remains a separate explicit action. For a source-only
design or documentation task, state that codegen, backend deployment and runtime
integration were not performed.
