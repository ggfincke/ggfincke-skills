---
name: artifact-contract-propagation
description: "Propagate a serialized Cartographer contract change across graph extraction, graph.json, atlas-index generation and persistence, snapshots and diffs, reports, CLI and HTTP surfaces, MCP tools, browser parsing and derived models, fixtures, schema-version enforcement, and rebuilt local artifacts. Use when adding, renaming, retyping, changing the requiredness or meaning of, or removing graph node, edge, block, rule, journey, proposal, patch, or atlas-index fields; bumping an artifact version; or diagnosing stale .cartographer artifacts and `/api/index` version failures. Not for internal values that never serialize or UI-only local preference state."
---

# Artifact Contract Propagation (Cartographer)

Treat each emitted artifact as a current-only contract with multiple
consumers. Read `AGENTS.md`, the artifact sections of `README.md`, and
[references/artifact-surfaces.md](references/artifact-surfaces.md) before
editing.

## Classify the contract

Name the artifact and exact change. Distinguish:

- `CartographerGraph` and `graph.json`
- `AtlasIndex` and `atlas-index.json`
- `GraphPatch`, proposal drafts, or proposal catalog metadata
- Snapshot database rows and historical diff payloads
- Atlas HTTP or MCP response-only payloads
- Browser-local persisted preferences or canvas state

Do not bump a public artifact version for an internal derived value that never
serializes. Do not treat UI local-storage migrations as graph compatibility.

## Propagate producer to consumers

1. Update the canonical type and version owner. For an incompatible serialized
   shape, bump the applicable constant and keep its assertion error actionable.
2. Update the producer: analyzer graph construction, patch builder, snapshot
   writer, or atlas-index builder. Make required current fields explicit.
3. Update strict readers and codecs: graph loading, index persistence,
   snapshots, patch parsing, and any trust-boundary validation.
4. Update every derived consumer: graph diff, blast radius, report and PR
   summary emission, CLI commands, HTTP routes, MCP tools, and proposal
   evaluation.
5. Update browser parsing first, then shared graph derivation, worker payloads,
   feature selectors, and rendering. Keep Node-only code out of the browser
   bridge.
6. Update examples, fixtures, templates, and README artifact documentation.
   Use canonical version constants in code fixtures instead of copied literals
   when the test is not specifically checking version rejection.

Cartographer is pre-1.0. Prefer one clean current schema and loud stale-artifact
failure over readers for superseded local formats unless the user explicitly
requests compatibility.

## Rebuild stale local artifacts

Build Cartographer before using its CLI, then rebuild the affected target
repository with the compiled CLI. Verify the emitted graph and index versions
directly. A stale ignored `.cartographer/graph.json` or `atlas-index.json` can
cause HTTP 500 responses even when the source fix is correct.

Never repair ignored artifact JSON by hand. Rebuild it from current source.

## Rename or remove

Stop producing the old field, update readers and derived consumers, then
remove the canonical type. Sweep the old property across `src/`, `tests/`,
templates, docs, and representative `.cartographer` fixtures. For a required
field, update every current caller and fixture rather than making it optional
to hide drift.

## Verify by affected surface

Run:

```bash
npm run typecheck
npm run test
npm run build
npm run acceptance:standalone
```

Add `acceptance:proposal-concurrency` for patch/proposal contracts and
`acceptance:patch-performance` for evaluator or patch-cost changes. Do not add
or modify tests unless the request or an approved test plan includes them.

For atlas-visible changes, rebuild the local graph, start the atlas, verify the
index endpoint returns 200, exercise the affected UI flow, reload, and inspect
the application console. Separate browser-extension warnings from
Cartographer errors. Report any physical interaction or unavailable-browser
gap honestly.
