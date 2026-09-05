# Git History Surgery - Playbooks

Use these recipes after `SKILL.md` orientation and backup. Replace placeholders literally; do not paste commands with angle brackets.

## Contents

- [Command Conventions](#command-conventions)
- [Amend The Latest Commit](#amend-the-latest-commit)
- [Squash The Top Of A Branch](#squash-the-top-of-a-branch)
- [Split The Latest Commit](#split-the-latest-commit)
- [Split An Older Commit](#split-an-older-commit)
- [Drop A Commit](#drop-a-commit)
- [Reorder Commits](#reorder-commits)
- [Move Commits To Another Branch](#move-commits-to-another-branch)
- [Move Uncommitted Changes](#move-uncommitted-changes)
- [Cherry-Pick Cleanup](#cherry-pick-cleanup)
- [Publish A Rewritten Branch](#publish-a-rewritten-branch)
- [Recover From A Bad Rewrite](#recover-from-a-bad-rewrite)
- [Conflict Handling](#conflict-handling)

## Command Conventions

- `BRANCH` is the branch being rewritten.
- `BASE` is the parent commit or base branch that should remain unchanged.
- `OLD` is the commit being split, dropped, or moved.
- `NEW_BRANCH` is the destination branch.
- `BACKUP` is the local backup ref created before rewriting.
- For an approved publication, record the exact push URL, full destination ref, and full remote OID before rewriting. Resolve all configured push URLs and select the one authorized destination; do not assume the fetch URL is the push destination. Use the exact matching `git ls-remote --exit-code` result for that destination/ref, and stop if it is absent or ambiguous. Keep the approved OID unchanged across later fetches. Do not copy credential-bearing URLs into logs or reports.

Before any playbook:

```bash
branch="$(git branch --show-current)"
stamp="$(date +%Y%m%d-%H%M%S)"
backup_branch="backup/${branch:-detached}-before-history-surgery-${stamp}"
git branch "$backup_branch" HEAD
```

If `branch` is empty, include the short SHA in the backup name instead of relying on `detached`.

## Amend The Latest Commit

Use when the latest commit needs a message change or should include a small known set of staged changes.

```bash
git status --short --branch --untracked-files=all
git diff --cached --stat
git commit --amend --no-edit
```

For a message edit:

```bash
git commit --amend -m "New concise message"
```

If the commit was already pushed, use [Publish A Rewritten Branch](#publish-a-rewritten-branch). If it was not pushed, do not force-push.

## Squash The Top Of A Branch

Use when all commits after `BASE` should become one commit. This is cleaner than interactive rebase when the final result is one commit.

Preconditions:

- The dirty worktree is empty or contains only changes the user wants included.
- `BASE` is exact, such as `origin/main`, a merge-base SHA, or `HEAD~N`.

```bash
git log --oneline --decorate --graph BASE..HEAD
git reset --soft BASE
git status --short
git commit -m "Final commit message"
```

If the branch had unrelated staged/unstaged work before the rewrite, stop instead of mixing that work into the squash.

## Split The Latest Commit

Use when `HEAD` should become two or more commits.

```bash
git reset HEAD^
git status --short
```

Stage and commit each logical group:

```bash
git add path/to/file-a path/to/file-b
git commit -m "First split commit"
git add path/to/file-c
git commit -m "Second split commit"
```

Use `git add -p` only when the chunks are clear and reviewable. After splitting, inspect the branch log and run focused checks for the changed code.

## Split An Older Commit

Use when `OLD` is not `HEAD`.

Use a scripted interactive rebase that stops at `OLD`. Avoid hand-editing the todo file.

```bash
old_short="$(git rev-parse --short OLD)"
GIT_SEQUENCE_EDITOR="perl -0pi.bak -e 's/^pick $old_short /edit $old_short /m'" git rebase -i OLD^
```

When the rebase stops, break `OLD` back into unstaged changes:

```bash
git reset HEAD^
```

Stage and commit each logical group:

```bash
git add path/to/first-group
git commit -m "First split commit"
git add path/to/second-group
git commit -m "Second split commit"
git rebase --continue
```

If later commits depend on files from `OLD`, conflicts can be legitimate. Resolve only the requested scope. If the todo edit does not stop at the intended commit, abort immediately and use the backup ref to re-plan.

## Drop A Commit

Use when a commit should disappear and its changes should not remain.

For the latest commit:

```bash
git reset --hard HEAD^
```

Only run this after explicit approval to discard the commit's changes.

For an older commit:

```bash
git rebase --onto OLD^ OLD BRANCH
```

Inspect the result:

```bash
git log --oneline --decorate --graph OLD^..HEAD
git status --short --branch
```

If the commit was pushed, publish with `--force-with-lease` only after approval.

## Reorder Commits

Use a scripted sequence editor when commit order matters and the operation cannot be expressed with `rebase --onto`.

First show the current range:

```bash
git log --reverse --oneline BASE..HEAD
```

Then build a temporary sequence editor script that writes the intended `pick` order. Keep the script under `/tmp` or another throwaway path and show the intended order before running it.

```bash
GIT_SEQUENCE_EDITOR=/tmp/reorder-sequence.sh git rebase -i BASE
```

If the requested reorder is really a squash, use [Squash The Top Of A Branch](#squash-the-top-of-a-branch) instead.

## Move Commits To Another Branch

Use when commits on the current branch belong on `NEW_BRANCH`.

Create the destination from the desired base:

```bash
git switch -c NEW_BRANCH BASE
git cherry-pick FIRST_COMMIT^..LAST_COMMIT
```

Return to the original branch and remove those commits only if the user wants them gone there:

```bash
git switch BRANCH
git rebase --onto FIRST_COMMIT^ LAST_COMMIT BRANCH
```

If the original branch is shared or pushed, treat the removal as a pushed-history rewrite and require approval before force-pushing.

## Move Uncommitted Changes

Prefer a temporary commit when precision matters.

For a precise subset:

```bash
git switch -c move-work-tmp
git add path/to/changes
git commit -m "temp: move work"
temp_commit="$(git rev-parse HEAD)"
git switch NEW_BRANCH
git cherry-pick -n "$temp_commit"
git reset
```

The original branch ref was not moved; the temporary branch owns the temp commit. Delete the temp branch only after confirming the destination has the changes.

For all dirty work when a stash is acceptable:

```bash
git stash push -u -m "history-surgery move work"
git switch NEW_BRANCH
git stash apply
```

Do not run `git stash drop` until the user confirms the applied changes are correct.

## Cherry-Pick Cleanup

Use when the target branch should receive selected commits without preserving the source branch history shape.

```bash
git switch TARGET_BRANCH
git cherry-pick COMMIT_A COMMIT_B
```

For squash cherry-pick:

```bash
git cherry-pick -n FIRST_COMMIT^..LAST_COMMIT
git commit -m "Squashed commit message"
```

If conflicts occur, resolve only files in the requested change. Use `git cherry-pick --abort` if the conflict shows the request is broader than expected.

## Publish A Rewritten Branch

Use only after local rewrite verification and approval to update the remote ref.

The values below come from the pre-rewrite publication receipt, not a newly fetched tracking branch. Replace the placeholders before running. A missing remote ref needs a separately verified branch-creation plan rather than an empty lease value.

```bash
publish_url='APPROVED_PUSH_URL'
publish_ref='refs/heads/BRANCH'
approved_oid='APPROVED_FULL_REMOTE_OID'
git status --short --branch --untracked-files=all
git log --oneline --left-right --cherry-pick "$approved_oid"...HEAD
git push --force-with-lease="$publish_ref:$approved_oid" "$publish_url" "HEAD:$publish_ref"
```

Compare a fresh remote observation with the recorded OID before publishing. The explicit lease also rejects a concurrent movement between that check and the push. On a mismatch or rejected lease, stop and show the intervening work; never refresh the approval OID automatically. A background fetch changing local tracking refs must not weaken the lease.

Never use:

```bash
git push --force
```

## Recover From A Bad Rewrite

Prefer the backup ref:

```bash
git log --oneline --decorate --graph BACKUP -n 10
git branch recovery/from-backup BACKUP
```

If the active branch should be restored:

```bash
git reset --hard BACKUP
```

Only reset after confirming that restoring the branch is the intended outcome.

Without a backup ref:

```bash
git reflog --date=iso
git branch recovery/from-reflog SHA
```

Create a recovery branch first. Inspect it before resetting the active branch.

## Conflict Handling

When rebase or cherry-pick conflicts:

```bash
git status --short
git diff --name-only --diff-filter=U
```

If the resolution is mechanical and inside the requested scope, fix it, run the relevant checks, then continue:

```bash
git add resolved/file
git rebase --continue
```

For cherry-pick:

```bash
git add resolved/file
git cherry-pick --continue
```

If the conflict implies a scope change, stop and report the conflicted files, current operation, and recovery command (`git rebase --abort` or `git cherry-pick --abort`).
