---
name: contract-propagation
description: "Plan and propagate persisted core-domain field changes across TierListBuilder contracts, Convex, sync/import/export, and the Python seed pipeline. Use for added, renamed, retyped, removed, missing, or stale fields on boards, tiers, items, templates, rankings, and presets. Not the schema assembler, non-contract domains, derived values, or UI-only state."
---

# Contract Propagation (TierListBuilder)

When a persisted field on a core object changes, it has to be carried through all three tiers or it silently drifts: a value that never reaches the cloud, a forked board that drops it, a seeded template that fails validation, a sync that fires forever or never. This skill maps the field to every layer it touches, in order, produces the propagation plan for the specific change, and executes it without skipping a layer.

Core objects are the persisted domain tables, split across two per-domain schema modules. `convex/schema.ts` is only an assembler that spreads per-domain table records; the tables live in:

- `convex/schema/workspace.ts`: board (`boards`), boardTier (`boardTiers`), boardItem (`boardItems`), tierPreset (`tierPresets`).
- `convex/schema/marketplace.ts`: template (`templates`), templateCard (`templateCards`), templateItem (`templateItems`), ranking (`publishedRankings` + `publishedRankingItems`), ranking aggregate (`templateRankingAggregates` + `templateRankingAggregateItems`).

## When this applies

- Adding, renaming, retyping, or removing a persisted field on a core domain object above.
- Editing that object's per-domain schema module (`convex/schema/workspace.ts` or `convex/schema/marketplace.ts`) or its validator under `convex/lib/validators/`.
- A field is missing, stale, or wrong after sync, publish/remix, import/export, or seeding.
- Not for the `convex/schema.ts` assembler itself, non-contract domains (auth, platform, profile, admin, seed-run bookkeeping), purely local or UI-only state that never persists, or values derived at read time.

## Read first

- The live root `AGENTS.md`, then `convex/README.md` and `docs/deployment.md` before a schema or persistence break. The current deployment identity and durability stage determine the rollout; this skill does not authorize deployment or data reset.
- `convex/_generated/ai/guidelines.md` - per `AGENTS.md`, read this before any Convex work; its rules override training-data assumptions about Convex.
- The field's neighbors in `packages/contracts/workspace/board.ts` (or the matching contract for the object) - copy the existing type, default, normalizer, and equality conventions rather than inventing new ones.
- `convex/README.md` for the pre-1.0 schema stance (see TLB-specific rules).

## Propagation layers (in order)

Walk these top to bottom when adding or changing. Each is the canonical home for that concern; match the naming conventions (`normalizeXyz`, `xyzEqual`, `xyzValidator`, `buildXyzInsert`).

### Tier 1 - TypeScript contract (source of truth for shape + semantics)

1. `packages/contracts/workspace/board.ts` (or `marketplace/template.ts`, `marketplace/ranking.ts`, `marketplace/rankingAggregate.ts`, `workspace/tierPreset.ts` for those objects) - the type definition, its constant defaults, the `normalizeXyz` helper, and the `xyzEqual` helper. Shared field IDs/themes live in `packages/contracts/lib/ids.ts` and `lib/theme.ts`.
2. `src/shared/board-data/boardNormalizers.ts` - the runtime normalizer that gates untrusted input (imports, shared links, sync payloads). Returns a clean value or drops the field.

### Tier 2 - Convex backend

3. `convex/lib/validators/workspace.ts` (or `convex/lib/validators/marketplace/{template,ranking,aggregate}.ts`, with shared shapes in `common.ts` and `marketplace/shared.ts`) - the `v.object()` validator. Shared item-render fields live in `schemaItemRenderFields` (`convex/lib/validators/common.ts`); the persisted item tables spread it, so an item field usually changes there once. Use `v.optional(...)` only when absence is part of the intended contract or the approved durability-stage rollout requires a widening step. Do not add temporary old-row compatibility by default.
4. `convex/schema/workspace.ts` or `convex/schema/marketplace.ts` - add the field to the table definition in the correct per-domain module, matching the validator's optionality. For shared item fields, edit `schemaItemRenderFields` instead of each item table; `templateItems`, `publishedRankingItems`, and `templateRankingAggregateItems` all spread it. Do not add fields to the `convex/schema.ts` assembler. Carry the inline comment explaining any denormalized or nullable semantics.
5. `convex/workspace/boards/upsertBoardState.ts` (the dispatcher) plus `convex/workspace/boards/upsertBoardState/{contract,validate,ensure,apply}.ts` - accept, bounds-check, default, and patch the field on write; `validate.ts` is where persisted board/item/tier field bounds are enforced, so a field the writer accepts but `validate.ts` never checks ships unbounded. If the field participates in sync, wire its change detection through `valuesEqual` (`convex/lib/core/data/equality.ts`) or the type's `xyzEqual` helper, or the upsert will silently never patch it (or re-patch every time).
6. `convex/workspace/boards/cloudFields.ts` - add the field to `buildForkedBoardInsert` **only if a fork should inherit it from its template**.
7. Marketplace publish/use - board->template field copying is centralized in `buildTemplateInsertFields` / `prepareTemplateInsertFromBoard` (`convex/marketplace/templates/lib/publishing.ts`), not inline in the mutation; the public mutations are `publishFromBoard` and `useTemplate` (`convex/marketplace/templates/mutations.ts`). For persisted **item** fields, the converters are `buildTemplateItemInsert` (board item -> `templateItems`) and `buildBoardItemInsertFromTemplateItem` (template item -> board item) in `convex/marketplace/templates/lib/board.ts`. Read-model/card projection is `buildTemplateCardFields` (`convex/marketplace/templates/lib/projections.ts`); denormalized row writes go through `convex/marketplace/templates/lib/writes.ts`. **Only if the field is part of a published template or ranking.**

### Tier 3 - sync, serialization, render

8. `src/features/workspace/boards/data/cloud/boardMapper.ts` - map the field both directions between the Convex persisted row and the in-memory `BoardSnapshot` (`snapshotToCloudPayload` and `serverStateToSnapshot`).
9. `src/shared/board-data/boardWireMapper.ts` (`snapshotToWire` / `wireToSnapshot`) and `boardJson.ts` - include the field in the export/import wire format, and normalize it on parse (untrusted input).
10. `src/features/workspace/boards/model/slices/board-data-actions/` - a UI action to edit it (e.g. `styleOverrideActions.ts`, where `setBoardAutoPlate` lives; the slice itself is `boardDataSlice.ts`), plus the component that reads it: shared item render is `src/shared/board-ui/items/ItemContent.tsx`, used by `src/features/workspace/boards/ui/items/TierItem.tsx`.

### Python seed mirror (only if the field appears in seeded templates)

11. `scripts/seed_pipeline/seed_pipeline/build/source.py` - add the field to `_TEMPLATE_PASSTHROUGH_FIELDS` so composition carries it from the per-template JSON.
12. `scripts/seed_pipeline/seed_pipeline/build/compile.py` plus `scripts/seed_pipeline/seed_pipeline/build/template_payloads.py` - include it in the compiled upload payload.
13. `scripts/seed_pipeline/seed_pipeline/schemas/` - update the JSON Schema files (e.g. `template.schema.json`, `compiled-manifest.schema.json`) that `validate.py` enforces. These are JSON Schema, not Python, and must stay in parity with the TS contract.

### Tests

14. Run the relevant existing checks: `tests/board/boardSnapshot.test.ts` and `tests/board/boardOps.test.ts` (snapshot + ops), `tests/board/boardWireMapper.test.ts` (wire round-trip), `tests/cloud-sync/cloudBoardMapper.test.ts` (cloud mapper round-trip), and - if seeded - `scripts/seed_pipeline/tests/test_contract_schema.py` and `scripts/seed_pipeline/tests/test_ts_parity.py` (TS <-> Python parity). Add or change fixtures/tests only when explicitly requested or included in the approved plan. Propose only important missing round-trip coverage; reuse an existing test plan without asking again.

## TLB-specific rules

- **Read the current persistence posture.** During friends-alpha, an explicitly approved reset may target local/development data only; `db:reset` must never target `prod:*`. A breaking hosted cutover uses a fresh production deployment, the human-owned release controller, reseeding, and complete code/data-pair verification before the discarded deployment is retired. After the durability-promotion gate, use `widen -> migrate -> narrow`. Do not run any reset, cutover, release, or retirement merely because a code change is approved.
- **No speculative compatibility.** Prefer the requested clean contract before 1.0, but preserve currently documented, tested, or still-used compatibility until its removal is explicitly in scope. Do not add migrations or optional fields solely to support obsolete rows.
- **TS and Python must agree.** The seed JSON schema and the TS contract are two encodings of the same shape; `test_contract_schema.py` and `test_ts_parity.py` are the guard. If you touch one and the field is seeded, touch the other.
- **Equality wiring is not optional for sync fields.** A field that reaches `upsertBoardState` without equality handling either never syncs or thrashes. Decide explicitly whether the field participates in change detection, and route it through `valuesEqual` or the type's `xyzEqual` helper.
- **Normalizer placement.** The default + normalizer live with the type in `packages/contracts`; `boardNormalizers.ts` is the untrusted-input gate. Both, not one.
- **Shared item fields change once.** Persisted item render fields live in `schemaItemRenderFields` (validator) and the matching contract; the item tables spread the shared shape, so edit the shared definition rather than each table.

## Process

1. State the field, the object/table, and the change: add / rename / retype / remove.
2. Answer the three conditionals - is it template-inheritable (layer 6/7), seed-relevant (layers 11-13), and does it participate in sync change-detection (layer 5)? - to decide which layers apply.
3. Produce the ordered plan covering only the applicable layers. Reuse an already approved scope; obtain missing approval before expanding it or taking an external/destructive action.
4. Execute with the phased-implementation skill: one tier at a time, typecheck and run the relevant tests between tiers, and stop to re-plan if a layer contradicts the plan.
5. Verify the round-trips the field participates in: edit -> sync -> reload, export -> import, and publish -> useTemplate, plus the seed build if seeded.

## Removing a field

Plan the removal across the actual deployment boundary so no live consumer reads a field that is already gone. Apply the current persistence posture above; this checklist is not a reset or release authorization:

1. Stop writing it: UI actions, mappers, wire serializer, fork/publish copies, seed passthrough.
2. Drop it from the per-domain schema module (`convex/schema/<domain>.ts`) and validators when the approved consumer/data cutover allows it. Existing local/development rows require a separately approved reset if necessary; hosted rows follow fresh-deployment cutover or durable migration, never an existing-production reset.
3. Delete the type, normalizer, equality helper, and constants from the contracts.
4. Remove it from the seed JSON schema. Change tests only within the approved test scope; otherwise report the affected existing coverage and request the necessary adjustment.
5. Grep the field name across all three tiers (`convex/`, `packages/` + `src/`, `scripts/seed_pipeline/`) to confirm no stragglers.

## Notes

- This is the "adding a persisted field" guide TLB did not have; no centralized one existed.
- The canonical worked example is `autoPlate` (the board-wide plate setting), which touches every layer above - grep it to see the full path end to end, including the `setBoardAutoPlate` action and the `buildTemplateInsertFields` publish copy.
- Execution is handed to phased-implementation by design: a field change is a multi-file, multi-tier change that wants gating between tiers, not one big diff.
