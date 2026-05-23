---
name: consolidation-audit
description: Audit a codebase for consolidation opportunities (duplication, drift, architectural mismatch), organize findings into risk-sequenced action groups, and produce a commit plan to execute them. Use when asked to run a consolidation audit, find code to merge or dedupe, plan a refactor across many files, or reduce codebase size and complexity.
---

# Consolidation Audit

Produce a consolidation audit: map the codebase, find duplication & drift, group findings into implementable units, and sequence them by risk. Output documents use the templates in `assets/templates/`.

## Workflow

Start by reading AGENTS.md / CLAUDE.md / README for conventions, build and test gates, and architectural intent; treat them as constraints throughout the audit.

1. **Map the codebase.** Trace bootstrap/initialization, the main interaction or request flow, core service stacks, the UI/presentation layer, and the test suite. Note file counts & responsibilities.
2. **Find consolidation opportunities.** Look for duplicated logic, copy-pasted helpers, drift between parallel implementations, architectural mismatches, and abstractions that should exist but don't. Each finding = Issue (with evidence) + Recommendation.
3. **Group findings.** Organize into action groups by file overlap, dependency chains, and shared change patterns - each group is a cohesive unit of work. Carry forward unresolved findings from prior audits, re-verifying each against the current code first - earlier findings may already be resolved or stale (the verify-review-findings discipline, applied to your own prior audit).
4. **Sequence by risk.** Order groups into phases: independent/low-risk first, cross-cutting/high-risk later. Treat test coverage as a continuous concern across every group.
5. **Plan the commits.** Break the approved groups into a commit plan - files staged plus one commit-message line each.

## Templates (`assets/templates/`)

- `consolidation-audit-template.md` - the audit doc: approach, architecture snapshot, findings & recommendations, master action groups, test-suite analysis.
- `action-groups-template.md` - findings reorganized into implementation groups with impact/risk, ordering, and a summary table.
- `commit-plan-template.md` - the staged git commit plan to execute the groups.

## Notes

- This produces a plan, not edits. Get approval on the action groups before implementing.
- To implement the approved action groups, use the phased-implementation skill: one group at a time, gate between phases, and keep the action-groups and commit-plan docs updated as the source of truth.
- For finer-grained, behavior-preserving cleanups within a change, use the simplification-review skill; for comment cleanup, the comment-style skill.
