---
name: branch-sweep
description: "Clean up git branches whose pull requests have already merged - delete them locally and on the remote, and prune stale worktrees - behind a dry-run plan you approve before anything is deleted. Use when asked to clean up or delete merged branches, tidy the branch list, or remove stale branches or worktrees after merging PRs. Merged status comes from GitHub (gh pr), not git's local view, so it handles squash- and rebase-merged branches that 'git branch -d' refuses. Not for rewriting history or force-pushing (use git-history-surgery), nor for creating a dependency-update branch (the deps sweep)."
---

# Branch Sweep

You are cleaning up branches whose work has already landed: delete the merged ones locally and on the remote, prune stale worktrees, and leave protected branches and anything unmerged untouched. This is destructive - branch deletion, remote deletion - so it runs behind a plan you approve before anything is deleted.

The non-obvious reason this skill exists: a branch's merged status comes from GitHub, not from git. When a repo squash-merges, the branch tip is never an ancestor of the default branch, so `git branch -d` refuses every one of them with "not fully merged." That refusal is expected, not a signal the branch is unmerged. Cross-reference `gh pr` to know what actually merged, then force-delete those specific branches.

## Hard rules

- Plan first, delete after approval. Produce the sweep plan - what would be deleted locally, what on the remote, which worktrees pruned - show it, and wait for a go-ahead. Default mode is plan-then-approve.
- Never touch a protected branch: the repo default (main/master) and the develop/prod/release family. Never delete the current branch.
- Merged means merged on GitHub. A branch is sweepable only if `gh pr` reports its PR merged. Do not infer merged-status from `git branch --merged` when the repo squash- or rebase-merges - it misses everything.
- Local and remote are two deletions. Deleting the local branch does not delete `origin/<branch>`. Sweep both, and report them separately so neither is silently skipped.
- This is deletion, not history rewriting. No force-push, no rebase, no amend. If the ask is to rewrite or squash commits, stop and point at git-history-surgery.
- An unmerged branch is deleted only if I name it explicitly and confirm. Then say plainly that it was not merged and the work is being discarded.

## What gets swept

- A local branch whose PR is merged (per `gh pr list --state merged`).
- The matching remote branch `origin/<branch>`, if it still exists.
- Worktrees that are prunable (their directory is gone) or that hold a now-swept branch - a branch checked out in a worktree cannot be deleted until that worktree is removed.

Always excluded: the default branch, the current branch, and the protected family (main, master, develop, prod, production, staging, release/*, hotfix/*). When unsure whether a branch is protected, skip it and list it as skipped.

## Procedure

1. Orient. `git fetch --prune`; note the current branch (`git branch --show-current`) and the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, or `git symbolic-ref --short refs/remotes/origin/HEAD`).
2. Build the plan. Run `scripts/sweep-plan.sh` - it is read-only and deletes nothing. It cross-references merged PRs against local and remote branches and prints the sweep set, prunable worktrees, and a skipped list. If `gh` is unavailable or the remote is not GitHub, fall back to `git branch --merged <default>` for local-only candidates and say the merged-status is best-effort.
3. Show the plan and get approval. Present the to-delete set (local / remote / worktrees) and the skipped set with reasons. Wait, unless I told you up front not to confirm.
4. Execute. For each approved branch: local `git branch -D <branch>` (force is correct here - GitHub already confirmed the merge), remote `git push origin --delete <branch>`. Remove swept worktrees with `git worktree remove <path>`, then `git worktree prune`. Do one kind at a time and keep going if a single delete fails.
5. Report. List what was deleted locally, what was deleted on the remote, worktrees removed, and everything skipped with a one-line reason.

## Modes

- Default - plan, show, wait, then delete.
- "just do it" / "don't confirm" - skip the approval gate but still print the full plan as you execute it, and still honor every protection.
- Dry-run - run step 2 and stop; show the plan, delete nothing.
- A named branch - if I point at a specific branch, sweep just that one (still local + remote), under the unmerged-branch rule above.

## Edge cases

- Detached HEAD - there is no current branch to protect; confirm the intended default before sweeping.
- Branch checked out in a worktree - remove the worktree first, then the branch; never delete a branch that is checked out.
- No GitHub remote / no `gh` - degrade to `git branch --merged <default>` for local branches only, do not guess at remote merges, and say so.
- A protected pattern that is really a feature branch (e.g. `release/spike`) - when in doubt, skip and list it; let me override.

## Notes

- Read-only until approval, like the review skills: the plan is the output; deletion waits for the go-ahead.
- Sibling skills: git-history-surgery rewrites and force-pushes (a different, more dangerous job); the deps sweep CREATES a dated dependency branch - this is the opposite end, cleaning up after merges.
- `scripts/sweep-plan.sh` is read-only by design; the destructive commands live only in the procedure above, gated on your approval.
