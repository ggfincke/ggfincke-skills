---
name: fan-out
description: Orchestrate a large change in parallel, modeled on Claude Code's /batch - research the codebase, decompose the work into 5 to 30 independent units, present the plan, then after approval run one background subagent per unit in an isolated worktree that implements its unit, runs the existing checks, and opens a PR. Also takes an approved plan or audit doc, whose action groups become the units. Use only when explicitly asked - "/fan-out", "fan this out", "batch this change", "run these groups in parallel". Not for a single small edit, tightly coupled work, read-only audit fan-outs (use mega-review), or external-worker delegation (use orchestrate).
disable-model-invocation: true
---

# Fan Out

You are orchestrating a large change as parallel, independent units. The shape follows Claude Code's `/batch`: research, decompose, get the plan approved, run one isolated worktree agent per unit, and track each unit to its own PR. You own the decomposition, the plan, and the final report. Each worker owns exactly one unit.

Activate only from an affirmative current-task request. Do not activate for a contextual mention, a request to inspect or edit this skill, or generic permission to use subagents. Another skill suggesting a handoff here is a suggestion to the user, not an activation.

## Preconditions

Before researching, confirm:

- The work is in a git repository, and you know the base branch the units will target. Check `git status` and `git log` first; other sessions may be working in the same tree.
- The host can run background subagents in isolated worktrees. If it cannot, see [Without worktree agents](#without-worktree-agents).
- The input is one of two things: a plain instruction for a sweeping change, or an approved plan or audit doc with action groups.

A single small change does not need this skill. Just make it.

## Phase 1: research and plan

Nothing is edited, spawned, pushed, or opened in this phase. Use the host's plan mode where it has one.

**From an instruction.** Research the codebase read-only until you can name every file, pattern, and call site the change touches, plus the conventions a worker must follow and the commands that check the work.

**From an approved doc.** The doc's action groups are the starting units. Keep its finding and group IDs, treat it as the living source of truth, and do not re-litigate approved scope. Recheck that its evidence still matches the current tree before planning on it.

Then decompose the work into units:

- Aim for 5 to 30 units, scaled to the work: near 5 for a handful of files, near 30 for hundreds. With an approved doc the count follows its groups and may be lower.
- Each unit is independently implementable in its own worktree and mergeable on its own, without waiting for another unit's PR.
- Each unit owns its files exclusively. No two units edit the same file.
- Coupled work is one unit. Never split a dependency across units to raise the count.
- Units are roughly uniform in size and split along real seams: a directory, a module, a package.

If every unit needs a shared prerequisite, say so in the plan. It lands first, and the fan-out starts from the base that contains it. If the work will not split into independent units at all, say that and do it in this session instead of spawning.

Work out the verification recipe a worker will run: the repo's existing test, typecheck, and lint commands, plus an end-to-end check where the repo has one. If you cannot find a way to verify the change, ask instead of guessing.

Present the plan and wait for approval:

- A short summary of what the research found.
- The numbered unit list. Each unit has a title, the files or directories it owns, a one-line description of the change, its branch name, and its PR title.
- The verification recipe.
- The base branch, the worker count, and the worker model.
- The Git and external actions that approval grants: one pushed branch and one opened PR per unit, and nothing else.

Name branches by content in the repo's own style, such as `feat/`, `fix/`, or `refactor/`. Never use a tool-generated or agent-named branch.

Approving the plan authorizes exactly its listed units, branches, and PRs. It does not authorize merging, closing, force-pushing, or anything outside the listed files.

## Phase 2: spawn the workers

After approval, launch one background subagent per unit, each in its own isolated worktree, all in one batch so they run concurrently. Honor any cap the user gave as a hard limit and run the rest as later waves. Use the session's model for workers unless the user named one.

A worker knows nothing but its prompt, so make each prompt self-contained:

- The overall goal, in the user's terms.
- This unit's title, owned files, and the exact change.
- The conventions found during research that the worker must follow.
- The verification recipe.
- The worker instructions below, copied verbatim.

```
1. Implement only this unit, inside the files it owns. If the change needs a file
   outside them, stop and report instead of editing it.
2. Run the verification recipe and fix failures your change caused. Do not add or
   modify tests unless this unit names them. Do not change source to make an
   unrelated test pass; report a failure that existed before your change.
3. Review your own diff once for scope creep and leftover debris.
4. Commit on the planned branch name, in the repository's commit style.
5. Push the branch and open a PR against the base branch with the planned title
   and a one-paragraph description. If you cannot open a PR, report what you
   pushed instead.
6. End your report with one line: `PR: <url>`, or `PR: none - <reason>`.
```

## Phase 3: track progress

Right after launch, show a status table and keep it current as workers report:

| #   | Unit                | Status  | PR  |
| --- | ------------------- | ------- | --- |
| 1   | migrate auth module | running |     |

- Update a row when its worker finishes: `done` with the PR link, or `failed` with the reason.
- A worker's report is not proof. Confirm each PR exists and carries the unit's commits, and note its check status where the host exposes it.
- Relaunch a failed unit once when the cause is clear and the fix stays inside the approved unit. Otherwise leave it failed and report it.
- With an approved doc, write each unit's status, PR link, and any deviation back into the doc as the unit closes.

Finish with one summary: `N/M units landed as PRs`, the final table, each failure with its reason, and anything deferred. Claim only what you verified. Do not merge, close, or delete anything; cleanup after merge is a separate job.

## When a unit contradicts the plan

A worker that finds the plan wrong stops and reports: the finding was already fixed, the unit needs a file another unit owns, the scope is larger than approved, or the change would break something the plan did not foresee. Do not improvise a bigger change to make the plan work. Let the other units continue, re-plan the affected unit with the user, then relaunch it.

## Without worktree agents

When the host cannot run isolated worktree subagents, say so and offer the same plan run one unit at a time in this session, on one branch:

- Implement one unit, run its checks, report the result, then start the next.
- Approval of the whole plan carries across its units. Stop only at a checkpoint the user asked for or when scope, consequences, or authorization changes.
- Commit, push, and open a PR only as the user asks.

## Notes

- This skill mirrors `/batch` and adds two things: approved-doc input, and the repository's own branch, test, and approval conventions.
- It uses the host's native subagents. Read-only multi-lens fan-outs belong to mega-review. External workers through the broker belong to orchestrate.
- To clean up merged branches and worktrees afterward, use branch-sweep.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
