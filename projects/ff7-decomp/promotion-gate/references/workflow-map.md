# FF7 Promotion Workflow Map

## Authorities

| Concern | Current authority |
|---|---|
| Promotion definition and generated status | `AGENTS.md` |
| Overlay-specific hazards | `src/battle/AGENTS.md`, `src/world/AGENTS.md`, `src/main/AGENTS.md` |
| Detailed promotion loop | `docs/decomp-workflow.md` |
| Compiler-shaping techniques | `docs/matching-cookbook.md` |
| Known blockers | `docs/promotion-blockers.md` and `docs/blocker-*.md` |
| Current guarded inventory | `.venv/bin/python3 tools/agent_status.py --json` |
| Sole promotion proof authority | `.venv/bin/python3 tools/validate-promotion.py` and the current staged receipt contract in `AGENTS.md` |

## Command roles

| Command | Role | Proof value |
|---|---|---|
| `.venv/bin/python3 tools/asm-differ/diff.py -mwo --overlay <overlay> <function>` | Per-function iteration | Triage only |
| `.venv/bin/python3 tools/promote-test.py --function <name> --verbose` | Focused candidate harness | Triage only |
| `.venv/bin/python3 tools/promote-test.py --all --dry-run` | Live guarded inventory | Candidate discovery |
| `./tools/docker-build.sh "make build"` | Advisory build investigation | Triage only; not a promotion receipt |
| `.venv/bin/python3 tools/validate-promotion.py attest --staged --target <function> --receipt <path>` | Snapshot exact index bytes and run isolated proof | Authoritative only with a passing current receipt; declare each support path with `--support` |
| `.venv/bin/python3 tools/validate-promotion.py verify --receipt <path> --against-staged` | Bind receipt to the current staged candidate | Required acceptance verification |
| `.venv/bin/python3 tools/agent_status.py --check` | Guarded-count and generated-status check | Required closeout |
| `.venv/bin/python3 tools/validate-promotion.py runs list --json` / `runs clean <run-id>` | Inspect and dry-run exact owned proof cleanup | No mutation until the finished owned run is selected and `--apply` is authorized |

Use the overlay name from the live status table, not the source filename.
Activate `.venv` or call its Python directly.

## Isolation rules

- Let the attestor own its exact proof resources. Set a unique task-specific
  `FF7_VOL_PREFIX` for separate advisory Docker lanes; never use an unscoped
  volume, container, image, or worktree prune.
- Run only one source-mutating scan or proof operation per checkout at a time.
- Keep the main integration lane clean; use other worktrees for speculative
  candidates.
- Stage exact owned hunks. Irregular adjacent preprocessor blocks can make a
  generic hunk selector absorb another function.
- Re-attest and verify against the staged tree after integration changes the
  target/support bytes. Read current baseline manifests instead of embedding
  snapshot-specific counts here.

## Failure routing

| Failure | Response |
|---|---|
| Function diff remains large after several C shapes | Record the result and recover only the owned candidate scope before choosing another |
| Focused diff or raw build matches but attestation fails | Trust the authority; do not count the candidate |
| Receipt no longer matches staged bytes | Re-attest the intended exact candidate; never reuse stale proof |
| Cleanup reports a busy or unrecognized resource | Inspect the owned run through the authority and stop; do not bypass it with manual deletion |
| Host MIPS or formatter executable is unavailable | Use the repository Docker wrapper |
| Worker config/generated state is damaged | Reproduce the minimal change in the clean main lane |
| Candidate depends on instruction-emitting asm | Reject it as a wrapper, regardless of byte match |

## Publication boundary

Branch creation, commits, pushes, PR creation, and merges are separate user
authorizations. When authorized, keep pure promotions separate from
infrastructure changes, verify the exact staged diff/receipt before every commit,
and include the current support trailers. Never retroactively revert existing
wrapper commits without the user's request.
