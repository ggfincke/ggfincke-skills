# Local components

Read the [component guide](guide.md) and [project scope gates](../../SKILL.md).
A local component is useful when isolated backend state is justified and reuse
outside this app is not required. A normal helper is simpler when no isolated
tables or persistent API boundary is needed.

## Layout and ownership

Use the repository's existing layout, normally:

```text
convex/
  convex.config.ts
  components/
    <name>/
      convex.config.ts
      schema.ts
      <feature>.ts
      _generated/
```

Define the component with `defineComponent('<name>')`. Import that definition
into the existing app config and mount it with `app.use(...)`; preserve the
app's env declarations, other component instances and route configuration.
The component owns its tables and uses its own generated server/API types.

## App-facing boundary

The parent calls a generated reference such as
`components.<name>.<module>.<function>` through the matching `ctx.run*` method.
Browser clients call intentional app wrappers. Those wrappers retain the app's
authentication, session/account policy, authorization, validation and rate limits.
App table IDs cross the boundary as strings, not validators for the component's
unrelated table namespace.

Use explicit typed env bindings when supported by the installed SDK. Component
HTTP routes remain unexposed unless the app adds an approved `httpPrefix` mount.
Keep an app HTTP wrapper when the handler needs app auth or data. These details
are version-sensitive; do not copy the old blanket no-env/no-HTTP restrictions.

## Implementation and checks

Plan the table/API/failure boundaries before source edits. Generate through the
installed tool only after confirming its side effects and deployment target;
do not hand-author `_generated` output. Inspect generated diffs, typecheck and
run the existing component/app tests. If no harness covers a new critical
invariant, propose the smallest test and obtain approval before adding it.

Verify that parent API calls preserve authorization and transaction semantics,
and that no client can directly reach private component operations. Do not
publish an npm package or create a second example app for a local-only task.
Use [official authoring guidance](https://docs.convex.dev/components/authoring)
for the installed version's layout and APIs.
