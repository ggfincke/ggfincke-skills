---
name: setting-propagation
description: "Propagate a VS Code setting or .mdx-previewrc configuration change through vsc-mdx-preview's contracts, generated package manifest, typed extension-host keys, invalidation routing, runtime projections, schema, RPC or webview consumers, documentation, and verification gates. Use when adding, renaming, retyping, changing the default or enum of, or removing an `mdx-preview.*` setting; when a setting appears in package.json but not runtime behavior; or when config changes fail to refresh the correct preview surface. Not for ordinary feature flags that never enter user configuration or for mdx-forge package API changes."
---

# Setting Propagation (vsc-mdx-preview)

Treat configuration as one contract with several projections. Read
`AGENTS.md`, then use
[references/setting-surfaces.md](references/setting-surfaces.md) to identify
the applicable owners. Do not edit generated preload, shim, or schema output
as if it were canonical.

## Classify the change

State the setting key and whether the change is add, rename, retype,
default/enum change, behavior change, or removal. Decide:

- Is it a VS Code setting only, or also supported by `.mdx-previewrc.json` or
  frontmatter?
- Is it resource-scoped, and what must happen when it changes: runtime push,
  recompile, CSS-watcher recreation, or full webview refresh?
- Does the webview need the value, or can the extension host consume it?
- Is the package-manifest property hand-authored metadata, generated data, or
  both?

Produce an ordered propagation plan before editing across packages.

## Propagate from canonical owners

1. Update canonical value types, enum arrays, defaults, and config schema under
   `packages/contracts/src/config/`. Keep default values and enum order in one
   owner.
2. Update the corresponding `package.json` contribution metadata: type,
   title, description, scope, bounds, deprecation text, and any non-generated
   fields. Let `generate:settings` project canonical defaults and ordered enum
   descriptions.
3. Update `SettingTypes` and the named `SETTINGS` entry in
   `packages/extension-host/src/shared/config/setting-keys.ts`.
4. Route every resource-scoped setting through `PREVIEW_SETTING_ACTIONS`.
   Choose the smallest correct invalidation action; an omitted key causes
   stale previews, while an overly broad action throws away runtime state.
5. Add the value to the applicable extension-host projection:
   `preview-settings.ts`, `EffectivePreviewConfig.ts`, config resolution,
   feature-specific managers, or command handlers.
6. If the value crosses the extension/webview boundary, update the shared
   contract, RPC payload, runtime-config channel, and webview consumer
   together. Do not create a second string-key registry.
7. If the key is valid in `.mdx-previewrc.json` or frontmatter, update its
   runtime parser/types and the generated JSON schema source. Preserve the
   precedence contract: frontmatter, then config file, then VS Code settings.
8. Update user-facing setting or authoring documentation when behavior,
   defaults, allowed values, security posture, or migration guidance changes.

Treat `package.json` as a mixed file: codegen synchronizes defaults and known
enums, but descriptive contribution metadata remains hand-authored.

## Rename or remove safely

Stop reading and reacting to the old key before deleting its canonical
default. Remove stale `package.json` properties explicitly; the generator does
not own every property field. Sweep the old fully qualified and relative key
through contracts, host, webview, schemas, docs, examples, and tests.

This project is pre-1.0. Prefer one clean current contract over aliases or
compatibility paths unless the user explicitly requests a transition.

## Verify

Run the relevant focused typecheck first, then:

```bash
npm run generate:settings
npm run generate:schema
npm run verify:settings
npm run verify:codegen
npm run check:guardrails
npm run typecheck
npm run build
```

Run existing focused tests or packaging checks when the changed setting
affects command registration, schema parsing, generated output, or the public
VSIX. Do not add or modify tests unless the request or an approved test plan
includes them.

`npm test` runs mutating codegen and formatting in `pretest`; always re-check
`git status`, generated-file membership, and the exact diff afterward. For a
user-visible refresh behavior, verify the setting in an Extension Development
Host and inspect the preview plus webview console.
