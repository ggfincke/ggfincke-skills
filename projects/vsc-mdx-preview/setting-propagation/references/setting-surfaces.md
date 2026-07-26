# MDX Preview Setting Surfaces

## Canonical and generated layers

| Concern | Primary path |
|---|---|
| Defaults | `packages/contracts/src/config/defaults.ts` |
| Enum values and config types | `packages/contracts/src/config/enums.ts`, `types.ts` |
| `.mdx-previewrc` parsing/schema source | `packages/contracts/src/config/schema.ts` |
| Frontmatter overrides | `packages/contracts/src/config/frontmatter-overrides.ts` |
| VS Code contribution metadata | root `package.json` |
| Default and enum projection | `packages/codegen/src/cli/generate-settings.ts` |
| Ordered enum descriptions | `packages/codegen/src/lib/codegen-utils.ts` |
| Generated output inventory | `scripts/generated-output-manifest.json` |

## Extension-host layers

| Concern | Primary path |
|---|---|
| Typed key map and named constants | `packages/extension-host/src/shared/config/setting-keys.ts` |
| VS Code config access and subscriptions | `packages/extension-host/src/shared/config/ConfigManager.ts` |
| Runtime projection | `packages/extension-host/src/shared/config/preview-settings.ts` |
| Effective precedence and file config | `packages/extension-host/src/features/preview/configuration/EffectivePreviewConfig.ts` |
| Refresh/invalidation dispatch | `packages/extension-host/src/app/workspace-events.ts` |
| Setting commands | `packages/extension-host/src/features/commands/` |

Search the exact `SETTINGS.<NAME>` symbol and relative key before selecting a
feature-specific consumer.

## Cross-process layers

When the webview needs the value, trace:

1. Shared contract or RPC message definition.
2. Extension RPC handler or preview resource construction.
3. Runtime-config channel and change detection.
4. Webview state or context owner.
5. Rendering or behavior consumer.

Do not send a value to the webview merely because the extension host reads it.

## Invalidation choices

| Action | Use for |
|---|---|
| `runtime-push` | Presentation/runtime values that can update in place |
| `recompile` | Values that affect compiled MDX or module resolution |
| `css-watcher-recreation` | CSS path or watcher ownership changes |
| `full-webview-refresh` | Security, execution realm, preload, or bootstrap changes |

## Verification signals

- `verify:settings` catches default/type/enum drift and orphan manifest keys.
- `verify:codegen` checks idempotent generated output.
- `check:generated` checks generated membership and headers.
- `check:guardrails` covers commands, generated files, dependency rules, and
  architecture boundaries.
- A VSIX inspection is required when contribution metadata or inclusion paths
  change.
