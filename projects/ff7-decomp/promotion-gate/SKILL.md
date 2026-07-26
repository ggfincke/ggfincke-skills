---
name: promotion-gate
description: "Promote and verify guarded functions in ff7-decomp using the repository's strict byte-identical-C contract. Use when asked to continue decomping, promote or triage a named function or source file, validate whether a candidate counts, run a sustained promotion session, or close out a dated promotions branch. Reject assembly-preserving wrappers and helper-only matches; count a promotion only after unconditional C survives the clean Docker SHA gate and the generated status check. Not for general infrastructure work, documentation-only changes, or unrelated branch cleanup."
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
- Treat `asm-differ`, regdiff, and `promote-test.py` as triage. The clean
  Docker build is the integrated proof.
- Read the current SHA manifest and command exit status; never hard-code the
  number of overlay checks.
- Do not discard unrelated dirty work. Keep speculative candidates isolated
  from the integration checkout.

## Run the promotion loop

1. Re-ground the session with `git status --short --branch`, recent history,
   and `python3 tools/agent_status.py --json`. Confirm the user's authorization
   for branch, commit, push, PR, or merge operations separately.
2. Select a live guarded function. Prefer the current throughput lanes and
   smaller candidates unless the user named a target. Verify that the guard
   still exists before trusting a rank or dry-run result.
3. Activate the repository virtual environment before Python tooling. When
   more than one Docker-backed lane is authorized, assign every lane a unique
   `FF7_VOL_PREFIX` before its first `promote-test.py` or
   `docker-build.sh` command.
4. Establish a clean baseline. If generated state is suspect, delete only
   `build/us` and `asm/us` inside the Docker wrapper, then run the clean build.
   Never remove the mounted build root.
5. Compare the guarded C body with the original using the smallest suitable
   tool. Iterate on C until the per-function signal reaches zero or the
   candidate is clearly uneconomical.
6. Remove the guard and compile the C path unconditionally. Re-run the focused
   comparison, then run the full clean Docker build without a concurrent
   source-mutating scan in the same checkout.
7. Run `python3 tools/agent_status.py --check`. Inspect the exact source diff,
   restore unrelated generated or formatting churn, and verify that the
   guarded-function count did not increase.
8. If the integrated gate fails, restore the guard or discard only the owned
   candidate diff, record the failure class, and move on. Do not force a local
   match through export, rodata, layout, or cross-overlay fallout.
9. If the gate passes, keep the verified promotion isolated. Commit it only
   when the user authorized commits, using one verified promotion per commit.

For an open-ended request, continue the loop until the user stops the run, the
declared goal or budget ends, or no viable live candidates remain. Do not stop
after the first failed probe when other authorized candidates remain.

## Integrate parallel work safely

- Give each writable lane a disjoint function and file owner.
- Keep source-mutating inventory scans out of the main proof checkout while a
  clean build is running.
- Treat worker build failures as suspect when their generated or config state
  is polluted.
- Reapply or cherry-pick a worker's minimal source change into the clean main
  lane and re-prove it there before counting it.
- Wind down by finishing current probes, reverting unfinished candidates, and
  retaining only byte-proven changes.

## Close the session

Run the current format path only when needed, review any broad churn, and keep
promotion changes separate from infrastructure work. For an authorized daily
closeout, use the repository's dated branch convention, verify the staged diff
and clean proof again, then perform only the requested remote actions.

Report the candidate, source file, focused comparison result, exact Docker
proof command and exit outcome, status-check result, retained diff, and any
rejected candidates. Do not call helper-level matches promotions.
