---
name: phased-implementation
description: "Execute an approved implementation plan in scoped phases, run each phase's checks, and keep its ledger current. Carry approval across listed groups and tests; pause at user-requested checkpoints or when scope, consequences, or authorization changes. Use after a phased plan or action groups are approved, not for creating plans or a single one-off edit."
---

# Phased Implementation

You are executing an approved, phased implementation plan - a set of patches, action groups, or numbered changes that has already been reviewed and approved. Carry it out one phase at a time, verify and gate between phases, and keep the plan updated as the source of truth. You are not re-planning or expanding scope; you are implementing what was approved.

## Preconditions

Before starting, confirm:

- There is an approved plan broken into discrete phases (groups, patches, or numbered steps). If it is a single small change, just make it - this discipline is for multi-phase work.
- You know the scope of each phase and what "done" looks like for it: tests pass, behavior preserved, the finding closed.
- You know where the plan lives. If it is a doc - a review artifact, an action-groups or commit-plan file, a patch plan, or REVIEW.md - that doc is the living source of truth, and you will update it as phases close.

If any of these is missing, get it before editing.

## Executing a phase

For the current phase only:

- Implement just that phase. Keep the diff scoped to it; do not pull later-phase work forward, and do not add drive-by cleanup.
- Follow the repo's conventions and the constraints the plan was approved under - no new dependencies, no API or behavior changes, whatever the originating review set.
- Run the phase's existing checks. Edit tests only when the approved phase explicitly names the major tests to add or change; otherwise propose a separate test plan instead of expanding the phase.

## Gating between phases

After each phase, report its result and run the next approved group. Approval of the entire plan carries across its listed groups and named tests. Stop for a new decision only at a checkpoint the user requested, when only the current group was approved, or when the plan's scope, consequences, or authorization changes:

- What changed in this phase: files, and the specific change.
- Tests or checks run for this phase and their result. If you could not run them, give the exact command.
- Whether reality matched the plan, or you found something the plan did not anticipate.
- The next approved phase, or the specific missing decision if a stop is required.

The gate makes progress reviewable and lets the user course-correct. It does not expire an unchanged approval.

## When a phase contradicts the plan

If implementing a phase reveals the plan was wrong - a finding was already resolved, an unforeseen dependency between phases emerged, the scope was larger than approved, or a change would break something the plan did not foresee - stop and report. Do not improvise a bigger change to make the plan work. Re-plan the affected part with me, then continue.

## Closure

When all approved phases are done:

- Update the source-of-truth doc: mark the phases complete, and record any deviations, deferrals, or dropped items with the reason.
- Summarize: phases completed, files changed, tests run and their results, anything intentionally left for follow-up, and residual risk.

Claim only what you implemented and verified. Do not assert the whole plan is finished if any phase was deferred.

## Notes

- This skill executes approved phased plans or action groups from plan mode or review skills without scope drift.
- To create the plan in the first place, use plan mode or the relevant review skill - not this skill.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
