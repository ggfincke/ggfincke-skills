# Dedicated local artifact workflow

Broker acceptance covers Git-visible source patches. Ignored seed definitions, media, previews, and provenance need a dedicated artifact handoff. Do not force-add them to make a broker patch appear complete. Native or sequential execution remains available when delegation, artifact transport, or read-only guarantees are unavailable; preserve the same declared scope and QC requirements.

## Ground the current target

Before running remembered commands, inspect the target repository's `AGENTS.md`, package scripts, seed CLI help, template schema, `build/source.py`, and `artifacts/provenance.py`. Confirm the paths and command semantics below still apply. Do not install this project skill globally or modify another repository just to reconcile these instructions.

The maintained full-source `npm run seed:marketplace:validate` rejects missing definitions and orphan order entries through `compose_dataset`; a subset intentionally has different catalog rules. Use that validator instead of a print-only set comparison. `npm run seed:source-status` is local source identity; the backend status command is different. Reuse `build_source_inventory` and the seed artifact commands for application source hashes and sealed artifacts instead of inventing another application manifest.

The currently inspected CLI offers local `seal`, `artifact verify`, and `artifact restore`. Inspect current `--help` and `scripts/seed_pipeline/README.md` for exact arguments and restore destination ownership. Keep local sealing and inspection separate from R2 transfers, hosted verification, apply, or live seeding. Run the existing offline gates sequentially; concurrent builds share and can corrupt the variant cache.

## Declare and materialize inputs

Create a task-owned manifest containing only the required files, with SHA-256 values computed from current bytes:

```json
{
  "schema_version": 1,
  "inputs": [
    {
      "source": "examples/gaming/example/01-item.png",
      "destination": "examples/gaming/example/01-item.png",
      "sha256": "replace-with-current-lowercase-sha256"
    }
  ]
}
```

Run the packaged [materializer](../scripts/materialize-inputs.py) against existing, disjoint real directories. Paths in the manifest are relative POSIX paths; symlinks, traversal, `.git`, missing or changed files, duplicate/overlapping destinations, and destination collisions are rejected. Inputs may be ignored by Git. The helper does not call Git, change the index, copy undeclared directories, or replace an existing file.

```bash
python3 .agents/skills/seed-example-sourcing/scripts/materialize-inputs.py \
  --manifest dev-docs/seed-examples/task-inputs.json \
  --source-root /absolute/source/repo \
  --destination /absolute/isolated/workspace \
  --receipt dev-docs/seed-examples/materialization.json
```

All inputs are staged and hash-checked before publication. Exclusive publication protects existing files even if a destination appears concurrently. A partial publication failure retains its exact copied-file list in the reported recovery directory's `failure.json`; inspect it before retrying. Recovery copies remain independent of later workspace edits. Successful execution records copied files, hashes, byte sizes, counts, manifest identity, and recovery location. This materialization receipt is evidence for the task receipt below, not an application manifest.

## Task receipt and acceptance

Copy [the task receipt template](../assets/artifact-receipt.template.json) into the task's approved `dev-docs/seed-examples/` directory. Keep existing `_manifest.json`, template definitions, and pipeline artifact schemas intact. Record:

- Declared input/output paths and hashes, media format, dimensions, alpha behavior, and byte size. Rehash delivered files after processing.
- Requested, succeeded, failed, pending, and unexpected identities. Reconcile counts explicitly; a failed roster has unknown item count, not zero successful items.
- Source provenance, intended use/known constraints, producer and configured/observed model where available, target source inventory or sealed-artifact identity, and verification command outcomes.
- Exact recovery paths and hashes for pre-existing assets before any approved replacement; retain rejected candidates and failed-run material until disposition is authorized.
- Visual-QC evidence: inspected montage and full-size/surface-preview paths with hashes, reviewer, verdict, limitations, and selected candidate. Metadata or worker scores alone do not prove visual acceptance.

Receipt placeholders are unfinished evidence, never success. Requested outputs require current hash and media checks plus visual inspection. Cover sourcing still produces ranked candidates in task scratch; installation follows the user's candidate selection. The receipt does not authorize replacing originals, publishing assets, or running live seed commands.
