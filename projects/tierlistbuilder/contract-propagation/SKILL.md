---
name: contract-propagation
description: "Propagate a persisted-field change across TierListBuilder's three tiers - the Convex backend, the TypeScript contracts, and the Python seed pipeline - so a field added, renamed, retyped, or removed on a core object (board, tier, item, template, ranking, tier preset) updates every layer it touches and nothing silently drifts. Use when adding, changing, or removing a persisted field or column on a TLB domain object, when editing convex/schema.ts or convex/lib/validators, or when a field is missing or stale after sync, publish/remix, import/export, or seeding. Produces the ordered propagation checklist - validators, schema, normalizers, equality helpers, cloud mapper, wire serializer, publish/useTemplate, the Python seed passthrough, and tests - then hands execution to the phased-implementation skill, one tier at a time."
---

# Contract Propagation (TierListBuilder)

When a persisted field on a core object changes, it has to be carried through all three tiers or it silently drifts: a value that never reaches the cloud, a forked board that drops it, a seeded template that fails validation, a sync that fires forever or never. This skill maps the field to every layer it touches, in order, produces the propagation plan for the specific change, and executes it without skipping a layer.

Core objects are the tables in `convex/schema.ts`: board, boardTier, boardItem, template, templateCard, ranking, tierPreset.

## When this applies

- Adding, renaming, retyping, or removing a persisted field on a core object.
- Editing `convex/schema.ts` or anything under `convex/lib/validators/`.
- A field is missing, stale, or wrong after sync, publish/remix, import/export, or seeding.
- Not for purely local or UI-only state that never persists, and not for derived values computed at read time.

## Read first

- `convex/_generated/ai/guidelines.md` - the repo requires this before any Convex work.
- The field's neighbors in `packages/contracts/workspace/board.ts` - copy the existing type, default, normalizer, and equality conventions rather than inventing new ones.
- `convex/README.md` for the pre-1.0 schema stance (see TLB-specific rules).

## Propagation layers (in order)

Walk these top to bottom when adding or changing. Each is the canonical home for that concern; match the naming conventions (`normalizeXyz`, `xyzEqual`, `xyzValidator`, `buildXyzInsert`).

### Tier 1 - TypeScript contract (source of truth for shape + semantics)

1. `packages/contracts/workspace/board.ts` (or `marketplace/template.ts`, `marketplace/ranking.ts`, `workspace/tierPreset.ts` for those objects) - the type definition, its constant defaults, the `normalizeXyz` helper, and the `xyzEqual` helper. Field IDs/themes live in `packages/contracts/lib/ids.ts` and `lib/theme.ts`.
2. `src/shared/board-data/boardNormalizers.ts` - the runtime normalizer that gates untrusted input (imports, shared links, sync payloads). Returns a clean value or drops the field.

### Tier 2 - Convex backend

3. `convex/lib/validators/workspace.ts` (or `marketplace.ts`, with shared shapes in `common.ts`) - the `v.object()` validator. Make the field `v.optional(...)` so existing rows stay valid while the change is in flight - this is for in-flight back-compat, not a long-term migration strategy (see rules).
4. `convex/schema.ts` - add the field to the table definition, matching the validator's optionality. Carry the inline comment explaining any denormalized or nullable semantics.
5. `convex/workspace/boards/upsertBoardState.ts` - normalize the field on write. If it participates in sync, wire its change detection through `valuesEqual` (`convex/lib/equality.ts`) or the type's `xyzEqual` helper, or the upsert will silently never patch it (or re-patch every time).
6. `convex/workspace/boards/cloudFields.ts` - add the field to `buildForkedBoardInsert` **only if a fork should inherit it from its template**.
7. `convex/marketplace/templates/mutations.ts` - copy the field in `publishTemplate` (board -> template) and `useTemplate` (template -> new board); `convex/marketplace/templates/lib/writes.ts` handles `templateCard` writes. **Only if the field is part of a published template.**

### Tier 3 - sync, serialization, render

8. `src/features/workspace/boards/data/cloud/boardMapper.ts` - map the field both directions between the Convex persisted row and the in-memory `BoardSnapshot`.
9. `src/shared/board-data/boardWireMapper.ts` and `boardJson.ts` - include the field in the export/import wire format, and normalize it on parse (untrusted input).
10. `src/features/workspace/boards/model/slices/boardData/` - a UI action to edit it (e.g. the `styleOverride` actions), and the rendering component that reads it (e.g. `ui/items/TierItem.tsx`).

### Python seed mirror (only if the field appears in seeded templates)

11. `scripts/seed_pipeline/seed_pipeline/source.py` - add the field to `_TEMPLATE_PASSTHROUGH_FIELDS` so composition carries it from the per-template JSON.
12. `scripts/seed_pipeline/seed_pipeline/build.py` - include it in the upload payload.
13. `scripts/seed_pipeline/seed_pipeline/schemas/` - add the field to the JSON schema that `validate.py` enforces. This must stay in parity with the TS contract.

### Tests

14. `tests/board/boardSnapshot.test.ts` and `tests/board/boardOps.test.ts` (snapshot + ops), `tests/shared-lib/boardSnapshotItems.test.ts` (wire round-trip), and - if seeded - `scripts/seed_pipeline/tests/test_contract_schema.py` (TS <-> Python schema parity). Add or extend a fixture and assert the field survives the round-trips it participates in.

## TLB-specific rules

- **Pre-1.0 schema is disposable.** Per `convex/README.md`, prefer replacing incompatible rows, dropping stale tables/indexes, or resetting dev data over writing row-conversion/migration jobs. Only add old-data support when explicitly asked. `v.optional` is for keeping rows valid mid-change, not a permanent migration tool.
- **TS and Python must agree.** The seed JSON schema and the TS contract are two encodings of the same shape; `test_contract_schema.py` is the guard. If you touch one and the field is seeded, touch the other.
- **Equality wiring is not optional for sync fields.** A field that reaches `upsertBoardState` without equality handling either never syncs or thrashes. Decide explicitly whether the field participates in change detection.
- **Normalizer placement.** The default + normalizer live with the type in `packages/contracts`; `boardNormalizers.ts` is the untrusted-input gate. Both, not one.

## Process

1. State the field, the object/table, and the change: add / rename / retype / remove.
2. Answer the three conditionals - is it template-inheritable (layer 6/7), seed-relevant (layers 11-13), and does it participate in sync change-detection (layer 5)? - to decide which layers apply.
3. Produce the ordered plan covering only the applicable layers, and confirm it before editing widely.
4. Execute with the phased-implementation skill: one tier at a time, typecheck and run the relevant tests between tiers, and stop to re-plan if a layer contradicts the plan.
5. Verify the round-trips the field participates in: edit -> sync -> reload, export -> import, and publish -> useTemplate, plus the seed build if seeded.

## Removing a field

Reverse the order so nothing reads a field that is already gone:

1. Stop writing it: UI actions, mappers, wire serializer, fork/publish copies, seed passthrough.
2. Drop it from `convex/schema.ts` and the validators (pre-1.0: just remove; reset dev data if existing rows break).
3. Delete the type, normalizer, equality helper, and constants from the contracts.
4. Remove it from the seed JSON schema and tests.
5. Grep the field name across all three tiers (`convex/`, `packages/` + `src/`, `scripts/seed_pipeline/`) to confirm no stragglers.

## Notes

- This is the "adding a persisted field" guide TLB did not have; no centralized one existed.
- The canonical worked example is `autoPlate` (the board-wide plate setting), which touches every layer above - grep it to see the full path end to end.
- Execution is handed to phased-implementation by design: a field change is a multi-file, multi-tier change that wants gating between tiers, not one big diff.
