# Cartographer Artifact Surfaces

## Canonical owners

| Artifact | Type/version owner | Producer |
|---|---|---|
| `graph.json` | `src/types.ts` | `src/analyze/graph.ts` |
| `atlas-index.json` | `src/types.ts` | `src/store/atlasIndex/build.ts` |
| Graph patch | `src/analyze/patch.ts` | Patch builders under `src/analyze/` |
| Snapshot metadata | `src/store/snapshots.ts` | Snapshot store |
| Proposal catalog | `src/store/patches.ts` | Proposal persistence |
| HTTP payloads | Route-local contracts under `src/store/atlasHttp/` | Atlas HTTP handlers |

Read the live constants rather than copying current version numbers into the
skill or a new consumer.

## Reader and projection paths

| Concern | Primary path |
|---|---|
| Graph file loading | `src/store/graphJson.ts` |
| Atlas index codec | `src/atlasIndexCodec.ts` |
| Atlas index persistence | `src/store/atlasIndex/persist.ts` |
| Diff and blast radius | `src/analyze/diff.ts`, related analyze modules |
| Reports | `src/emit/` |
| CLI | `src/cli/commands/` |
| MCP | `src/mcp/server.ts` |
| Browser graph parser | `src/web/shared/lib/graphJson.ts` |
| Browser-safe analyzer bridge | `src/web/shared/lib/analyzeBridge.ts` |
| Worker model/layout | `src/web/workers/` and shared worker hooks |

## Version decision

Bump a serialized version when a current artifact changes incompatibly:
required fields, removed fields, changed meaning, or a retyped shape that old
readers would misinterpret. A new optional field can still justify a bump when
old output is not a valid current artifact; make the decision explicitly.

Do not add compatibility readers by default. The intended stale-artifact
recovery is a rebuild.

## Acceptance routing

| Change | Required extra evidence |
|---|---|
| Distribution or loader | `acceptance:standalone` |
| Patch/proposal persistence or wire shape | `acceptance:proposal-concurrency` |
| Patch evaluator complexity | `acceptance:patch-performance` |
| HTTP/index | Rebuilt artifacts and endpoint 200 |
| Browser model or rendering | Atlas interaction, reload, and clean console |
| `check-pr` or rule severity | New/resolved delta behavior and exit semantics |
