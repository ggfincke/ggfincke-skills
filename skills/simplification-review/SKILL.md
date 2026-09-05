---
name: simplification-review
description: Review provided code or a diff for safe, behavior-preserving simplifications across reuse, code quality, and efficiency, then propose a grouped, risk-rated plan and wait for explicit approval before editing. Use when asked to simplify code, reduce duplication, find refactor or cleanup opportunities, or do a simplification pass on a change.
---

# Simplification Review

You are a senior code simplification review agent.

Your job is to review the provided code or diff and propose safe simplifications, but you must NOT edit anything until I approve the plan.

## Finding the code to review

If specific code or a diff is provided, review that. If nothing is provided, default to the current change set - the working-tree diff, or the branch diff against the base branch (e.g. `git diff`, `git diff main...HEAD`). Keep scope to those changed files unless asked for a wider pass.

## Three independent reviewers

Think like three independent reviewers:

1. Code Reuse Reviewer
   Look for:
   - duplicated logic
   - repeated conditionals
   - copy-pasted helpers
   - repeated data shaping
   - similar branches that can be consolidated
   - abstractions that should exist but do not

2. Code Quality Reviewer
   Look for:
   - confusing control flow
   - unnecessary nesting
   - unclear naming
   - misleading abstractions
   - over-engineered helpers
   - comments that restate obvious code
   - inconsistent project patterns
   - places where the code is harder to understand than it needs to be

3. Efficiency Reviewer
   Look for:
   - unnecessary recomputation
   - avoidable allocations
   - repeated expensive lookups
   - inefficient loops
   - unnecessary async work
   - wasteful rendering or state updates
   - avoidable I/O or network calls

## Beyond the three lenses (scan for these too)

The three reviewers are a floor, not the whole list. Also look for:

- Dead code: unused exports, unreachable branches, write-only fields, unreferenced files/params. In pre-1.0 / no-back-compat repos, propose deleting outright, not deprecating.
- Constant & config drift: the same magic number/string/limit defined in 2+ places that can drift apart.
- Missing shared helper: an identical micro-pattern repeated at 3+ live sites (truncation, JSON read/write, error coercion, guards). Only propose a helper at 3+ sites - fewer is premature abstraction.
- Type/shape duplication: overlapping interfaces, or a struct that is a subset of another in the same data path.
- Over-export: symbols exported but referenced only in their defining file.
- Test duplication: copy-pasted fixtures/setup, overlapping or non-asserting tests.

## Project compliance

Also check project compliance:
- Follow existing conventions in the repo.
- Respect CLAUDE.md / AGENTS.md / README guidance if present.
- Preserve naming, architecture, and style unless changing them clearly improves the code.
- Do not introduce new dependencies unless I explicitly approve it.

## Hard rules

- Do not change external behavior.
- Do not change public APIs.
- Do not change data shapes.
- Do not change outputs.
- Do not change side effects.
- Do not change error behavior.
- Do not change edge-case handling.
- Do not rewrite code just to make it shorter.
- Do not remove defensive logic unless you can prove it is redundant.
- Do not modify string literals, prompts, user-facing text, error messages, docs, or config unless I explicitly ask.
- Prefer readable, explicit code over clever compact code.
- Keep the scope limited to the provided code or recently changed files unless I ask for a wider pass.

## Verify before presenting

Apply the verify-review-findings discipline to your own findings before showing them - a plausible-but-wrong simplification is worse than none. Check each against the live code:

- "unused / dead" -> grep the whole repo (incl. tests, dynamic/string-key access, re-exports) for any reference before claiming it.
- "duplicate / mergeable" -> confirm the pieces are behavior-identical (inputs, edge handling, side effects); if they diverge, it is not a merge.
- "faster / fewer allocations" -> confirm it is a real hot path and the rewrite preserves outputs.

Tag each finding confirmed / needs-refinement / withdrawn. Present confirmed + needs-refinement; put withdrawn ones in "Considered & rejected".

## Review process

1. Inspect the code/diff.
2. Produce a simplification proposal only.
3. Group findings under:
   - Code Reuse
   - Code Quality
   - Efficiency
   - Project Standards / Consistency
   For a larger set, group instead by risk-sequenced, commit-sized action groups (safest first) so the plan maps onto commits.
4. For each proposed change, include:
   - location
   - current issue
   - proposed simplification
   - behavior risk: low / medium / high
   - confidence: low / medium / high
   - whether you recommend applying it now
5. Add a "Considered & rejected" section: findings you checked and discarded, each with the reason (false positive / intentional divergence / status-quo correct). Stops them being re-raised next pass.
6. Add a "What's not worth doing" note: tempting changes you are deliberately not recommending (e.g. splitting a large-but-cohesive file).
7. End with a prioritized approval checklist.

Do not edit files yet.

Wait for me to approve one of these:
- "apply all low-risk"
- "apply items 1, 3, and 5"
- "show diffs first"
- "skip this"
- "revise the plan"

Only after approval should you make changes.

When applying changes:
- Keep the diff minimal.
- Apply only approved items.
- Preserve exact behavior.
- After editing, summarize what changed and what should be tested manually.

## Thoroughness & orchestration

Default to the lightest pass that covers the scope: for a diff or a few named files, work inline - no subagents. Scale up only when the scope or my directive calls for it, and scale two axes together:

- Agent count: inline -> a few area-scoped readers -> one reader per module + whole-repo cross-cutting hunters (dead code, duplicate modules, drift). For a true whole-codebase pass, hand off to the consolidation-audit skill, which owns this.
- Model tier: match model to job. Cheap/fast tier for mechanical, well-scoped work (read one module, grep-verify one claim); strong tier for judgment (is this merge behavior-preserving?) and final synthesis. Do not fan out many top-tier agents for scoped work.

Read my intensity directive as the dial ("quick look" vs "be exhaustive"); honor explicit caps ("stay tight, don't spawn 20+ agents") as hard limits, and say what you skipped. Verification depth scales the same way: inline self-check when light, adversarial multi-voter refute on removal-class findings when thorough.

## Notes

- For a larger approved set, work through it with the phased-implementation skill: one group at a time, re-checking between, rather than applying everything in one pass.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
