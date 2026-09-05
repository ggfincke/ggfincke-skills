---
name: consolidation-audit
description: Audit a codebase for consolidation opportunities (duplication, drift, and inconsistent ownership across parallel implementations) and produce one extremely thorough audit document with verified findings, considered/rejected claims, integrated action groups, risk sequencing, and testing guidance. Use when asked to run a consolidation audit, find code to merge or dedupe, plan a refactor across many files, or reduce codebase size and complexity.
---

# Consolidation Audit

Produce one comprehensive consolidation audit: map the codebase, find duplication & drift, verify/refute each candidate, group surviving findings into implementable action groups inside the audit, and sequence those groups by risk. Copy [the packaged template](assets/templates/consolidation-audit-template.md) to one concrete dated document, normally `dev-docs/consolidation-audit-YYYY-MM-DD.md`. Never edit or overwrite the packaged template; update an existing audit only when the user points to the same scope. The concrete audit is the sole permitted write during the otherwise source-read-only review.

Do not create separate action-groups or commit-plan documents unless the user explicitly asks for those additional artifacts.

## Workflow

Start by reading AGENTS.md / CLAUDE.md / README for conventions, build and test gates, and system constraints; treat them as constraints throughout the audit.

This is a duplication-and-drift audit, not a general architecture review. Build only enough of a codebase/system map to trace suspected overlaps and ownership inconsistencies. For system decomposition, dependency direction, responsibility boundaries, runtime/data-flow design, or a target architecture, use `architecture-review` as a separate opt-in track.

1. **Build a lightweight system map.** Trace bootstrap/initialization, the main interaction or request flow, shared utilities, parallel implementations, and the relevant tests only far enough to locate suspected duplication, drift, or inconsistent ownership. Note the files and responsibilities that establish each candidate's context.
2. **Find consolidation opportunities.** Look for duplicated logic, copy-pasted helpers, drift between parallel implementations, inconsistent ownership of equivalent behavior, and unnecessary parallel abstractions. Each finding = Issue (with evidence) + Recommendation. Decompose the search two ways: per-area readers (each owns a relevant module or implementation path, reports local findings plus overlap suspicions) and whole-repo hunters for cross-cutting redundancy (duplicate/near-duplicate modules, dead code & unused exports, repeated micro-patterns, constant/type drift, dependency surface, test duplication), seeded by those suspicions. When the harness supports parallel subagents, run these as a fan-out; otherwise sequentially.
3. **Verify, then group.** Verify every finding - current and carried-forward - against the live code before it makes the list: grep for references before calling anything dead, confirm two implementations are behavior-identical before calling them duplicates, and for high-consequence removals verify adversarially (try to refute). Record false positives and stale findings in a "Considered & Rejected" section rather than dropping them silently (the verify-review-findings discipline, applied to your own audit - prior and current). Then organize survivors into action groups by file overlap, dependency chains, and shared change patterns - each group a cohesive unit of work.
4. **Sequence by risk.** Order groups into phases: independent/low-risk first, cross-cutting/high-risk later. Treat test coverage as a continuous concern across every group.
5. **Write one thorough audit.** Include scope, the lightweight system map, findings, evidence, impact, recommendations, considered/rejected claims, integrated action groups, recommended implementation sequence, test-suite analysis, verification performed, and gates not run. Keep the audit as the single source of truth.

## Thoroughness & subagent budget

Let the user's stated intensity set the dial - read it from their request, don't guess. Scale agent count and model tier together; default to the lightest pass that covers the codebase, and never exceed an explicit cap. A rough ladder (a continuum, not fixed steps):

- **Standard** - a handful of area-scoped readers; cheap/fast tier for reading & per-claim verification, strong tier for synthesis.
- **Thorough** - one reader per module + whole-repo cross-cutting hunters seeded by their suspicions; adversarial verify; dedup + synthesis.
- **Exhaustive** - add loop-until-dry discovery, multi-voter refute panels on removal-class findings, and a completeness critic.

Match model to task, not to ambition: reserve the strongest tier for judgment & verification; use the cheapest tier that can do a mechanical, scoped job. When told to be tight/efficient, prefer fewer agents on cheaper models, reserve the strong tier for the verify + synthesis, and report what you scoped out.

## Templates (`assets/templates/`)

- `consolidation-audit-template.md` - the packaged template to copy; the concrete audit contains scope, approach, lightweight system map, verified findings, considered/rejected claims, integrated action groups, recommended sequence, test-suite analysis, and verification log.

## Notes

- This produces a plan, not edits. Get approval on the action groups before implementing.
- To implement approved action groups, use the phased-implementation skill: one group at a time, gate between phases, and keep the audit doc updated as the source of truth.
- For finer-grained, behavior-preserving cleanups within a change, use the simplification-review skill; for comment cleanup, the comment-style skill.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
