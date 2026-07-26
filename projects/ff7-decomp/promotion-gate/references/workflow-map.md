# FF7 Promotion Workflow Map

## Authorities

| Concern | Current authority |
|---|---|
| Promotion definition and generated status | `AGENTS.md` |
| Overlay-specific hazards | `src/battle/AGENTS.md`, `src/world/AGENTS.md`, `src/main/AGENTS.md` |
| Detailed promotion loop | `docs/decomp-workflow.md` |
| Compiler-shaping techniques | `docs/matching-cookbook.md` |
| Known blockers | `docs/promotion-blockers.md` and `docs/blocker-*.md` |
| Current guarded inventory | `python3 tools/agent_status.py --json` |
| Integrated proof | `./tools/docker-build.sh "make build"` |

## Command roles

| Command | Role | Proof value |
|---|---|---|
| `.venv/bin/python3 tools/asm-differ/diff.py -mwo --overlay <overlay> <function>` | Per-function iteration | Triage only |
| `.venv/bin/python3 tools/promote-test.py --function <name> --verbose` | Focused candidate harness | Triage only |
| `.venv/bin/python3 tools/promote-test.py --all --dry-run` | Live guarded inventory | Candidate discovery |
| `./tools/docker-build.sh "rm -rf build/us asm/us"` | Recover suspect generated state | Cleanup only |
| `./tools/docker-build.sh "make build"` | Clean full build and SHA verification | Decisive |
| `.venv/bin/python3 tools/agent_status.py --check` | Guarded-count and generated-status check | Required closeout |

Use the overlay name from the live status table, not the source filename.
Activate `.venv` or call its Python directly.

## Isolation rules

- Set a unique task-specific `FF7_VOL_PREFIX` for every concurrent
  Docker-backed lane.
- Run only one source-mutating scan or proof operation per checkout at a time.
- Keep the main integration lane clean; use other worktrees for speculative
  candidates.
- Stage exact owned hunks. Irregular adjacent preprocessor blocks can make a
  generic hunk selector absorb another function.
- Re-prove integrated changes after cherry-picking or reconstructing history.

## Failure routing

| Failure | Response |
|---|---|
| Function diff remains large after several C shapes | Revert and choose another candidate |
| Focused diff is zero but clean build fails | Trust the full build and reject the candidate |
| `Device or resource busy` during cleanup | Delete `build/us` and `asm/us`, not the mount root |
| Host MIPS or formatter executable is unavailable | Use the repository Docker wrapper |
| Worker config/generated state is damaged | Reproduce the minimal change in the clean main lane |
| Candidate depends on instruction-emitting asm | Reject it as a wrapper, regardless of byte match |

## Publication boundary

Branch creation, commits, pushes, PR creation, and merges are separate user
authorizations. When authorized, keep pure promotions separate from
infrastructure changes and verify the exact staged diff before every commit.
