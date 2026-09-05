# Advanced component patterns

Read the [component guide](guide.md) and [project scope gates](../../SKILL.md).
These are context fragments and design options, not instructions to install
packages or copy a complete endpoint. Registered functions still need the
project's full argument/result validators, auth and domain policy.

## Callback handles

Use a function handle when a component must call a specific app-owned callback.
Create the handle in trusted app code from a known generated reference:

```ts
import { createFunctionHandle } from 'convex/server'

const callback = await createFunctionHandle(internal.jobs.processItem)
```

The handle is passed as a string and the receiver can treat it as a typed
`FunctionHandle` for `ctx.runMutation` or scheduling:

```ts
import type { FunctionHandle } from 'convex/server'

await ctx.runMutation(callback as FunctionHandle<'mutation'>, callbackArgs)
```

Keep the callback type, arguments, authorization, retry behavior and return
contract explicit. A handle is a capability: do not accept arbitrary client
handles, log them unnecessarily, or turn a callback parameter into unrestricted
function execution. `createFunctionHandle` is asynchronous; an ordinary function
name string is not a substitute. Schedule only work with approved semantics.

## Derive validators from the schema

For current Convex, use the schema's complete document validator rather than
repeating fields or forgetting `_id`/`_creationTime`:

```ts
import { v } from 'convex/values'
import schema from './schema'

const notificationOrNull = v.nullable(schema.doc('notifications'))
```

This fragment assumes the component actually defines `notifications`. Use its
own schema and generated types. `schema.doc` handles complete document shapes,
including union tables; inspect the installed SDK before adopting a newer API.
Keep a list query bounded and its return validator consistent with the exact
projection or complete document it returns.

## Configuration ownership

Current component env declarations can express validated strings/unions, with
explicit app bindings. Prefer those for appropriate runtime configuration;
read inside handlers and never assume arbitrary app env is inherited.

For structured mutable configuration that needs persistence, a small globals
table may fit. Define its singleton/key invariant, validate values, authorize
the app-side update and use a transaction to update or insert. Detect unexpected
duplicates rather than silently choosing a row. A table is not a safe secret
store by default; review what appears in component data, logs and exports.

## App-side client facade

A plain helper is usually sufficient. A class facade can be useful when several
operations share an actual configuration or component instance; do not add one
for a single call. Keep the facade in app-side/client library code and type its
component parameter with that component's generated `ComponentApi`.

Restrict the accepted context to what the facade needs, for example:

```ts
import type { GenericDataModel, GenericMutationCtx } from 'convex/server'

type MutationCaller = Pick<GenericMutationCtx<GenericDataModel>, 'runMutation'>
```

Call `component.<module>.<function>` through that context. Do not import a
fictional package or pass fields the component's actual validator does not
accept. The facade does not remove the app's auth, env, validation or transaction
responsibilities; generated types and a real consumer check are the authority.

## Verification

Check callback type/argument compatibility, validator parity, authorized config
changes, duplicate handling and facade calls with existing tests. Preserve
nested rollback boundaries and required atomic projections. New tests or
dependencies need approval. Current APIs and examples are documented in
[Authoring Components](https://docs.convex.dev/components/authoring).
