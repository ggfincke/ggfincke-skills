---
name: phased-implementation
description: "Execute an already-approved, phased implementation plan one phase at a time: implement only the current phase with the diff scoped to it, gate between phases by running the relevant checks and stopping for go-ahead, update the plan or review artifact as the living source of truth as phases close, and stop to re-plan instead of improvising when a phase contradicts the plan. Use after a plan, patch plan, or set of action groups has been approved and it is time to carry it out step by step; not for creating plans (use plan mode) or for a single one-off edit."
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

After each phase, stop and report before starting the next - unless I have said to run straight through:

- What changed in this phase: files, and the specific change.
- Tests or checks run for this phase and their result. If you could not run them, give the exact command.
- Whether reality matched the plan, or you found something the plan did not anticipate.
- The next phase, and a request to proceed.

The gate is the checkpoint where I can course-correct. Do not silently continue into the next phase.

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
