#!/usr/bin/env bash
# skills/git-history-surgery/scripts/git-snapshot.sh
# print read-only git context before history rewrite

set -uo pipefail

section() {
  printf '\n== %s ==\n' "$1"
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not inside a git work tree" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
branch="$(git branch --show-current 2>/dev/null || true)"
head_short="$(git rev-parse --short HEAD 2>/dev/null || true)"
head_full="$(git rev-parse HEAD 2>/dev/null || true)"
upstream=""

if [ -n "$branch" ]; then
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
fi

default_branch=""
if command -v gh >/dev/null 2>&1; then
  default_branch="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
fi
if [ -z "$default_branch" ]; then
  default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
fi
[ -z "$default_branch" ] && default_branch="main"

merge_base=""
if git show-ref --verify --quiet "refs/remotes/origin/$default_branch"; then
  merge_base="$(git merge-base HEAD "origin/$default_branch" 2>/dev/null || true)"
fi

section "Repo"
printf 'root           : %s\n' "$repo_root"
printf 'branch         : %s\n' "${branch:-<detached>}"
printf 'head           : %s %s\n' "${head_short:-<none>}" "${head_full:-}"
printf 'upstream       : %s\n' "${upstream:-<none>}"
printf 'default branch : %s\n' "$default_branch"
printf 'merge-base     : %s\n' "${merge_base:-<none>}"

section "Status"
git status --short --branch --untracked-files=all

section "Staged"
git diff --cached --name-status || true

section "Unstaged"
git diff --name-status || true

section "Untracked"
git ls-files --others --exclude-standard || true

section "Submodules"
git submodule status --recursive 2>/dev/null || true

section "Recent commits"
git log --oneline --decorate --graph -n "${LOG_LIMIT:-16}" || true

if [ -n "$upstream" ]; then
  section "Ahead / behind"
  git log --oneline --left-right --cherry-pick "$upstream"...HEAD -n "${LOG_LIMIT:-16}" || true
fi

section "Worktrees"
git worktree list 2>/dev/null || true

section "Remotes"
git remote -v || true
