# Git history surgery

Consulted checklist for rewriting git history safely: amend/reword a tip, drop a trailer, split a commit, extract work into a worktree, or deliberately overwrite a remote. Open it and follow the sequence - do not improvise these. Rewriting published history is destructive: a wrong force-push clobbers a teammate's work or your own, and the recovery window is the reflog's expiry.

Why a workflow and not a skill: it must NOT auto-fire (a "git" trigger is maximally greedy and the blast radius is destructive). You invoke it deliberately by opening this file.

## Non-negotiables (every rewrite)

1. Know where you are: `git status -sb` - confirm the branch and that the tree is what you think.
2. Capture an escape hatch before touching anything: `git tag backup/<desc>` (or note `git rev-parse HEAD`). The reflog has it too, but an explicit tag is cheaper to find under pressure.
3. If the branch is pushed, know what you'd overwrite: `git fetch` then `git log @{u}..HEAD` and `git log HEAD..@{u}`. The second must be empty - if it isn't, someone pushed and you'd lose their commits.
4. Force-push ONLY with `--force-with-lease`, never bare `--force`. A lease failure means the remote moved under you - stop and re-fetch, do not override it.
5. Never rewrite a shared/protected branch (main) that others build on. Rewrite your own feature tip.

## Recipes

### Reword or amend the tip
- Message only: `git commit --amend` (or `--amend -m "..."`).
- Fold staged changes into the tip: `git add <paths> && git commit --amend --no-edit`.
- Publish: `git push --force-with-lease`.

### Drop a trailer from history (e.g. a stray Co-authored-by)
- Tip only: `git commit --amend` and delete the line, then `git push --force-with-lease`.
- A handful of commits: `git rebase -i <base>`, mark each `reword`, strip the line in the editor.
- Many commits / whole branch: `git filter-repo --message-callback '...'` (separate install; the supported replacement for the deprecated `filter-branch`). Test on a clone first.
- Going forward this shouldn't recur - the co-author trailer is killed at the source by the `attribution` setting in `~/.claude/settings.json`. This recipe is for cleaning up trailers already in history.

### Split or slice a commit
- Pull changes out of the tip: `git reset --soft HEAD^` (keeps changes staged) or `git reset HEAD^` (unstages), then re-commit in pieces with `git add -p` to stage hunks selectively.
- Split a commit deeper in history: `git rebase -i <base>`, mark it `edit`; when it stops, `git reset HEAD^`, then stage and commit the pieces; `git rebase --continue`.

### Extract or recover work into a worktree
- Park current work on a parallel branch without disturbing this one: `git worktree add ../wt-<name> -b <branch>`.
- "Take whatever's local" into a clean checkout: `git worktree add ../wt-<name> <ref>`, copy/rework there, remove with `git worktree remove ../wt-<name>`.

### Deliberately overwrite the remote with local
- This is the "take whatever's local, force it up" case. Run the non-negotiables first (know what you're discarding), then `git push --force-with-lease`. If the lease is stale because you intend to discard the remote's commits, re-fetch, confirm those commits are truly disposable, then push.

### Undo a bad rewrite
- Back to the tag you set: `git reset --hard backup/<desc>`.
- No tag? Find the pre-rewrite SHA in `git reflog`, then `git reset --hard <sha>`.
- Already force-pushed the bad state? Reset locally to the good SHA, then `git push --force-with-lease` again.

## Note for automated/agent runs

`git rebase -i` and `git add -i`/`-p` are interactive and may be blocked in a headless agent context. Non-interactive equivalents: `git rebase <base> --exec '<cmd>'` for per-commit edits, `GIT_SEQUENCE_EDITOR=: git rebase -i` to accept a scripted todo list, `git filter-repo` for bulk message/tree rewrites, and `git restore --staged` / `git apply` to stage precise hunks without the `-p` prompt.
