# Packaged components

Read the [component guide](guide.md) and [project scope gates](../../SKILL.md).
Use this path only when the user needs an actual reusable package or sharing
across apps. A local component is not automatically a publishing project.

## Package contract

Use the [official component authoring guide](https://docs.convex.dev/components/authoring)
and the selected package's current export map. If scaffolding is justified,
choose an approved tool/version first; do not download `@latest` executables as
an incidental step. Preserve user-owned source and package metadata.

Plan the consumer-facing surfaces:

| Surface | Purpose |
|---|---|
| Package root | Client helpers/classes and public types |
| Component config export | The definition consumed by `app.use(...)` |
| Generated component API type export | Typed parent-side client helpers |
| Optional test helper export | Registration in a consumer's existing test harness |

Use the package's actual exported paths; `.js` suffix requirements come from
that export map, not a blanket rule. Do not promise an export the build does not
produce. Pick a supported peer-version range and inspect the generated types.

## Build and codegen order

Component generation, package build and consumer generation may depend on each
other. Inspect the package scripts before choosing the sequence. Typically the
component must be generated and built before the example/consumer can resolve
its bundled entrypoints; normal app-only codegen is not proof of package health.
The installed CLI's `codegen --component-dir <path>` option can target a component,
but its side effects and deployment requirements still need review.

Exercise the built package through an already-approved consumer/example. Check
the config export, generated type export, ESM/module resolution and wrapper
calls, not only the source tree. An existing `convex dev` command may deploy;
do not start it as an unapproved check.

## Testing and publication

Use the existing `convex-test` harness and register the component schema/module
map or its supplied test helper. Verify app wrappers preserve auth, validation
and failure semantics. Add tests or an example application only when included
in the approved plan; use the project's established test location.

Packaging, publishing and granting package access are separate actions. Before
publication, verify namespace ownership, license, included files, secrets,
generated artifacts and the selected version. Unknown origin/license information
must be resolved before redistributing inherited material; never invent it.
No publication or installation in another user's project is implied by a build.
