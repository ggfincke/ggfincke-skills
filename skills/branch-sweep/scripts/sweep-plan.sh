#!/usr/bin/env bash
# skills/branch-sweep/scripts/sweep-plan.sh
# read-only sweep plan - merged-PR branches (local + remote) & prunable worktrees; deletes nothing

set -uo pipefail

# protected branch names that are never swept
PROTECTED_RE='^(main|master|develop|development|prod|production|staging|release(/.*)?|hotfix(/.*)?)$'

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not inside a git work tree" >&2
  exit 1
fi

# refresh remote-tracking refs (non-destructive to local branches)
git fetch --prune --quiet 2>/dev/null || echo "warn: git fetch failed (offline?)" >&2

current="$(git branch --show-current 2>/dev/null || true)"

# default branch via gh, else origin/HEAD, else main
default=""
if command -v gh >/dev/null 2>&1; then
  default="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
fi
if [ -z "$default" ]; then
  default="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@' || true)"
fi
[ -z "$default" ] && default="main"

echo "default branch : $default"
echo "current branch : ${current:-<detached>}"
echo

is_protected() {
  local b="$1"
  [ "$b" = "$default" ] && return 0
  [ -n "$current" ] && [ "$b" = "$current" ] && return 0
  echo "$b" | grep -Eq "$PROTECTED_RE"
}

# merged PR head branches from GitHub - the source of truth for squash/rebase merges
merged_file="$(mktemp)"
trap 'rm -f "$merged_file"' EXIT
have_gh=0
if command -v gh >/dev/null 2>&1 && gh pr list --state merged --limit 1 >/dev/null 2>&1; then
  have_gh=1
  gh pr list --state merged --limit 300 --json number,headRefName \
    -q '.[] | "\(.headRefName)\t\(.number)"' 2>/dev/null | sort -u > "$merged_file" || true
fi

echo "=== LOCAL branches to sweep (PR merged on GitHub) ==="
if [ "$have_gh" -eq 1 ]; then
  while IFS=$'\t' read -r br pr; do
    [ -z "$br" ] && continue
    git show-ref --verify --quiet "refs/heads/$br" || continue
    is_protected "$br" && continue
    echo "  $br  (PR #$pr)"
  done < "$merged_file"
else
  echo "  (gh unavailable - falling back to 'git branch --merged $default', best-effort, local only)"
  { git branch --merged "$default" --format '%(refname:short)' 2>/dev/null || true; } | while read -r br; do
    [ -z "$br" ] && continue
    is_protected "$br" && continue
    echo "  $br  (merged into $default)"
  done
fi
echo

echo "=== REMOTE branches to sweep (origin/<branch>, PR merged) ==="
if [ "$have_gh" -eq 1 ]; then
  while IFS=$'\t' read -r br pr; do
    [ -z "$br" ] && continue
    git show-ref --verify --quiet "refs/remotes/origin/$br" || continue
    is_protected "$br" && continue
    echo "  origin/$br  (PR #$pr)"
  done < "$merged_file"
else
  echo "  (skipped - need gh to confirm remote merges)"
fi
echo

echo "=== WORKTREES (prunable / to review) ==="
git worktree prune --dry-run -v 2>/dev/null | sed 's/^/  prune: /' || true
git worktree list 2>/dev/null | sed 's/^/  /' || true
echo

echo "note: this script deletes nothing. review the plan, then sweep per the skill procedure."
