---
name: git-history-surgery
description: "Safely rewrite local Git history and publish rewritten branches with explicit checkpoints: amend, squash, split, drop, reorder, cherry-pick, move commits between branches, recover with reflog or backup refs, and push rewritten refs with --force-with-lease. Use when asked to clean up commit history, amend an existing commit, squash or split commits, reorder or drop commits, move work onto another branch, recover from a bad rebase/reset, or force-push a rewritten branch. Not for deleting already-merged branches or stale worktrees (use branch-sweep), routine new commits without rewriting history, or dependency-update branch creation."
---

# Git History Surgery

You are doing deliberate Git history rewrite work. Your job is to preserve the user's existing work, make the rewrite auditable, and publish rewritten refs only when the user has clearly approved that risk.

## Start Here

Run [this skill's snapshot helper](scripts/git-snapshot.sh) first from the target repo. If the script is unavailable, manually collect the same facts: branch, HEAD, upstream, default branch, merge-base, staged/unstaged/untracked files, submodules, worktrees, recent log, and ahead/behind state.

Then classify the request:

- Simple local rewrite: amend the last commit, squash unpushed commits, or rename the last commit.
- Branch cleanup rewrite: squash, drop, reorder, or split commits in the current branch.
- Work relocation: move commits or uncommitted changes onto another branch.
- Recovery: undo a bad rebase/reset/amend using a backup ref or `git reflog`.
- Publish rewritten history: push a rewritten branch with `--force-with-lease`.

For anything beyond a trivial unpushed amend, read `references/playbooks.md` and choose the smallest matching playbook.

## Hard Rules

- Snapshot first. Do not run rewrite commands until current branch, upstream, dirty state, and recent history are known.
- Protect user work. Never discard staged, unstaged, or untracked changes unless the user explicitly asks to discard that exact work. If unrelated dirty work is present, stop and isolate it before rewriting.
- Plan before rewrite. State the intended base, commits affected, backup ref name, commands, and expected result before changing history. If the user already said "do it" or equivalent, still create the backup and report the plan as you execute.
- Create a backup ref before any destructive or branch-wide rewrite: `git branch backup/<branch-or-head>-<timestamp> HEAD`. If detached, use a clear backup name and include the current short SHA.
- Prefer non-interactive commands. Use `commit --amend`, `reset --soft`, `rebase --onto`, `cherry-pick -n`, or scripted sequence editing where possible.
- Do not rewrite protected branches (`main`, `master`, `develop`, `development`, `prod`, `production`, `staging`, `release/*`, `hotfix/*`) unless the user explicitly names the protected branch and confirms the consequence.
- Never use plain `git push --force`. Use `git push --force-with-lease origin HEAD:<branch>` after verifying the remote branch and upstream state.
- Do not run `git reset --hard`, `git clean`, branch deletion, or stash dropping unless the user explicitly asked for that exact destructive operation.
- Avoid broad cleanup. History surgery is about the requested commits and refs, not formatting, dependency refreshes, or opportunistic code changes.

## Approval Gates

Require explicit approval before:

- Rewriting already-pushed commits.
- Force-pushing or changing a remote ref.
- Dropping commits, files, or uncommitted work.
- Rewriting a protected branch.
- Continuing after a conflict when the resolution is not mechanically obvious from the requested change.

Approval can be a direct instruction such as "rewrite and force-push this branch" or a follow-up after the plan. If the approval is ambiguous, ask one focused question.

## Execution Pattern

1. Orient: run [this skill's snapshot helper](scripts/git-snapshot.sh), then inspect any commit range involved in the request.
2. Confirm scope: identify the commits to keep, combine, split, drop, or move.
3. Backup: create a local backup branch from the pre-op HEAD.
4. Rewrite: use the relevant playbook from `references/playbooks.md`.
5. Verify: inspect `git status --short --branch --untracked-files=all`, `git log --oneline --decorate --graph`, and any tests/checks needed for the changed code.
6. Publish only if approved: fetch, verify the lease target, then push with `--force-with-lease`.
7. Report: backup ref, rewritten range, commands that mattered, verification results, and any remaining local or remote work.

## Recovery Discipline

If a rewrite goes wrong, stop making new changes. Use the backup ref first. If no backup exists, inspect `git reflog --date=iso` and identify the exact pre-op entry before resetting or branching from it. Prefer recovery by creating a new branch from the known-good SHA, then decide whether to reset the active branch.

## Relationship To Other Skills

- Use `branch-sweep` to delete merged branches or stale worktrees. This skill rewrites history and force-pushes; it does not clean up merged branches.
- Use `phased-implementation` when the user has approved a multi-step code patch plan. This skill is only for Git history shape.
- Use repo-specific validation guidance after the rewrite if the affected commits changed source behavior.
