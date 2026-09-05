---
name: promotion-gate
description: "Promote and verify guarded functions in ff7-decomp using its byte-identical-C contract and staged promotion authority. Use for decompilation, candidate triage, promotion validation, or an authorized promotion session/closeout. Count only unconditional C with a current isolated authority receipt verified against the staged tree and a passing status check. Not for infrastructure work, documentation-only edits, or unrelated branch cleanup."
---

# Promotion Gate (FF7 Decomp)

Use the repository's current promotion contract, not remembered counts or old
candidate rankings. Read `AGENTS.md`, the applicable nested overlay
`AGENTS.md`, and `docs/decomp-workflow.md` before editing. Read
[references/workflow-map.md](references/workflow-map.md) for command ownership,
lane isolation, and closeout details.

## Preserve the proof boundary

- Accept only an existing guarded C body made unconditional or a genuine C
  rewrite that reproduces the original bytes.
- Reject raw instruction-emitting inline asm, `.word` blobs, moved or restored
  `INCLUDE_ASM`, and helpers that preserve the original assembly.
- Treat `asm-differ`, regdiff, `promote-test.py`, raw `make build`, and
  `tools/docker-build.sh` as triage. The isolated promotion attestor is the
  sole proof authority; a standalone Docker match is not acceptance.
- Use the current authority's exact baseline manifest, direct artifact hashes,
  receipt, and command exit status. Never hard-code a wrapper or overlay count.
- Do not discard unrelated dirty work. Keep speculative candidates isolated
  from the integration checkout.

## Run the promotion loop

1. Re-ground the session with `git status --short --branch`, recent history,
   and `.venv/bin/python3 tools/agent_status.py --json`. Confirm the user's authorization
   for branch, commit, push, PR, or merge operations separately.
2. Select a live guarded function. Prefer the current throughput lanes and
   smaller candidates unless the user named a target. Verify that the guard
   still exists before trusting a rank or dry-run result.
3. Activate the repository virtual environment before Python tooling. When
   more than one Docker-backed lane is authorized, assign every lane a unique
   `FF7_VOL_PREFIX` before its first `promote-test.py` or
   `docker-build.sh` command.
4. Inspect the current authority and baseline requirements. Let the attestor
   own its detached proof checkout and exact resources; do not clear shared
   generated state or Docker resources to make a candidate pass.
5. Compare the guarded C body with the original using the smallest suitable
   tool. Iterate on C until the per-function signal reaches zero or the
   candidate is clearly uneconomical.
6. Remove the guard, format only the explicit target/support paths with
   `tools/format-scoped.py`, and stage exactly those paths. Inspect the complete
   cached diff so adjacent guarded functions cannot enter the candidate.
7. Run `.venv/bin/python3 tools/validate-promotion.py attest --staged --target
   <function> --receipt .ff7/receipts/<name>.json`, adding each intentional
   support path with `--support`. Then run the same authority's `verify
   --receipt <path> --against-staged` and
   `.venv/bin/python3 tools/agent_status.py --check`. A receipt for older or
   different staged bytes is not current proof.
8. If the authority fails, preserve its evidence, restore only the owned
   candidate changes when that recovery is authorized, and record the failure
   class. Do not force a local match through export, rodata, layout, or
   cross-overlay fallout. Never retroactively revert landed wrappers unless
   requested; remove wrapper-only work from the active owned candidate instead.
9. If the gate passes, keep the verified promotion isolated. Commit it only
   when authorized, using one verified promotion per commit and the current
   `FF7-Support: <path> <sha256>` trailers for declared support files. Successful
   attestation commands clean owned runtime scratch after saving receipts and
   logs. Inspect `runs list --json` for retained failures or cleanup errors;
   dry-run `runs clean <run-id>` before applying any separately authorized
   cleanup. Keep durable evidence and unrelated resources.

For an open-ended request, continue the loop until the user stops the run, the
declared goal or budget ends, or no viable live candidates remain. Do not stop
after the first failed probe when other authorized candidates remain.

## Integrate parallel work safely

- Create a research lane with `.venv/bin/python3 tools/research-worktree.py
  create <name>` and reuse it when useful. Use `--ref` only for an
  intentional different starting revision. Never copy a checkout, whole disc
  archive, virtual environment, or submodule Git metadata. Initialize required
  submodules through Git. The shared sparse profile retains the build inputs.
- There is no branch, worktree, or retained-proof count cap. Use the small disc
  profile to avoid duplication. `tools/research-worktree.py list` shows Git's
  worktree inventory; dirty research remains user-owned and must be preserved.
- Give each writable lane a disjoint function and file owner.
- Keep source-mutating inventory scans out of the main proof checkout while a
  clean build is running.
- Treat worker build failures as suspect when their generated or config state
  is polluted.
- Integrate the worker's minimal authorized change, stage its exact target and
  support paths, and obtain/verify a new authority receipt against those staged
  bytes before counting it.
- Wind down by finishing current probes and reporting unfinished candidates.
  Preserve unrelated work and use only an authorized, exact owned recovery;
  do not treat session end as blanket revert or resource-prune permission.

## Close the session

Run the current format path only when needed, review any broad churn, and keep
promotion changes separate from infrastructure work. For an authorized daily
closeout, use the repository's dated branch convention, verify the staged diff
and verify the authority receipt against it again, then perform only the
requested remote actions.

Report the candidate, target/support paths, focused comparison, exact attestation
and verification commands/outcomes, current receipt identity, status-check result,
retained diff, and owned cleanup run ID. Do not call helper-level matches or raw
Docker builds promotions. Report retained runs with `validate-promotion.py runs
list --json` and worktrees with `tools/research-worktree.py list`; a cleanup error
is separate from proof validity.
