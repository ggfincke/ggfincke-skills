---
name: certified-edit-workflow
description: "Inspect, evaluate, edit, replay, and export real Scratch `.sb3` projects through agentic-scratch's retained-evidence workflows. Use when asked to check a Scratch project, run multimodal or fragility evaluation, perform a semantic edit, resume or replay recorded edit artifacts, certify an exported `.sb3`, or make gameplay and media claims that require official-browser evidence. Preserves immutable source artifacts, typed revision-bound operations, retained store-root authority, exact replay, bounded host capabilities, and evidence hashes. Not for ordinary TypeScript refactors in agentic-scratch or hand-editing raw `project.json`."
---

# Certified Edit Workflow (agentic-scratch)

Keep the source `.sb3` immutable and let the deterministic builder own block
IDs, references, mutations, and assets. Read `AGENTS.md` and
`dev-docs/guides/project-readiness.md`; use
[references/acceptance-matrix.md](references/acceptance-matrix.md) to select
the smallest authoritative workflow.

## Choose the lane

State the input artifact, requested outcome, and whether writes are authorized.
Choose exactly one starting lane:

- **Read-only inspection:** validate structure, static behavior, VM behavior,
  fragility, or project readiness without editing.
- **Recorded multimodal evaluation:** collect structured runtime evidence and
  escalate to screenshots, video, or VLM only where visual correctness needs
  it.
- **Certified semantic edit:** execute an approved typed edit workflow against
  an immutable source, evaluate the result, and export a separate candidate.
- **Replay:** reproduce a retained record with zero model calls and zero new
  writes before trusting it as evidence.

Do not turn a requested project edit into generic platform development. If the
workflow requires a new capability or contract, stop and plan that separately.

## Establish artifact authority

1. Resolve the absolute source path and compute or record its current size and
   hash. Copy it only when the workflow explicitly creates a candidate; never
   overwrite the original.
2. Re-ground the repository, built artifacts, config files, host bootstrap,
   contract registry, and retained run roots. Do not infer executable state
   from an ignored plan or an enclosing directory.
3. Validate any retained request, scenario policy, contract registration, and
   resource limits against their canonical bytes and hashes. Never weaken
   fail-closed validation to make an old fixture or partial run pass.
4. Record the Scratch/TurboWarp runtime version and hash used by the run.

## Inspect or record

Run cheap deterministic layers before expensive observation: archive/schema,
graph, static analysis, VM, model or mutation checks, then browser and
multimodal evidence. Use `project-check` for the normal read-only surface and
`fragility-check` when timing sensitivity is in scope.

For recorded multimodal work, prepare or record a run, retain its exact root,
then replay it before using the record in `multimodal-project-check`. Treat
headless rendering rejection or media warnings as evidence limitations, not
permission to make browser claims from VM state.

## Execute a certified edit

1. Require explicit workflow config, host bootstrap, contract registry, and
   model selection. Keep host capabilities bounded to the declared workflow.
2. Run the semantic-edit benchmark when platform changes could affect the
   edit contract. For a consumer-only edit, use the already approved current
   contract rather than regenerating semantic authority.
3. Run `semantic-edit-live-workflow` against the immutable source and write
   candidate artifacts into the retained run root.
4. Inspect preview, apply, evaluation certificate, rollback or recovery
   evidence, and certified export as separate stages. A preview is not an
   applied edit; an applied edit is not automatically a certified export.
5. Verify exact source preservation and candidate/export hashes.
6. Replay from the retained `roots/readable-artifact/edit-artifacts` store
   root. Do not pass an enclosing run directory merely because it contains the
   store.

## Verify gameplay and media claims

Use the official Scratch or TurboWarp browser lane for animation, timing,
costumes, sounds, clone lifecycle, controls, navigation, and gameplay
acceptance. A headless VM can prove state transitions but not exhaustive visual
or media behavior. Retain screenshots or video beside the report and tie every
claim to the artifact hash it observed.

## Close out

Return absolute paths and hashes for the immutable source, candidate, certified
export, report, and retained replay root. Report deterministic, VM, browser,
and replay evidence separately. State any unavailable official-browser,
physical-input, media, or external-host gap.

Do not add or modify tests unless the request or an approved test plan includes
them. Do not commit generated `runs/` artifacts unless the user explicitly
requests publication.
