---
name: branch-sweep
description: "Report and clean up local branches, live origin branches, and stale worktrees behind an exact-OID/path plan approved before deletion. Use when asked to sweep merged branches, tidy the branch list, or remove stale branches or worktrees. Covers agent, backup, and safety branches without treating their names as deletion permission; uses exact GitHub merged-PR heads and confirmed live-default ancestry as distinct evidence. Not for reconciling unfinished work, publishing branches, or rewriting history (use git-history-surgery)."
---

# Branch Sweep

Report every in-scope branch, worktree, and bounded leftover; propose cleanup, obtain approval, and execute only approved exact targets. Completion means everything is accounted for, not zero branches. This is **report and clean**, not reconciliation: do not audit feature completeness, excavate code semantics, implement or publish unfinished work, or create recovery folders, bundles, or raw archival branch pushes unless separately requested.

## Inventory and evidence

Run [the package-local plan helper](scripts/sweep-plan.sh) from the target repository. It is ref- and worktree-nonmutating; do not fetch or prune before approval.

```sh
<skill-directory>/scripts/sweep-plan.sh [--default <branch>] [--scan-root <path>]...
```

`--default` remains an optional, validated default-branch override, not permission to invent a default. Repeat `--scan-root` for additional bounded roots. Default discovery inspects immediate entries in the primary repository's `worktrees/` and `.worktrees/`, plus repository-name-prefixed sibling directories. Each additional root scans immediate child directories only. Never recursively scan a home directory or follow directory symlinks. Call a leftover a worktree only after finding actual `.git` metadata and proving the same Git common directory; separately report ambiguous, non-Git, foreign-repository, or symlink remnants without inferred deletion permission.

Inventory all local heads, including agent/backup/safety names; live origin heads; remote-tracking refs; every registered worktree, including detached and noncandidate checkouts; and bounded discovered directories. Include full OIDs, counts, duplicate-tip groups, registration, locks, content status, and discovery boundaries. Tracking refs are snapshots, not live-remote proof. Other remotes are inventory-only. Preserve the original checkout/path and branch, the current checkout/path and branch, the confirmed default, and the protected family: `main`, `master`, `develop`, `development`, `prod`, `production`, `staging`, `release[/...]`, and `hotfix[/...]`. Default/protected tracking refs and symbolic `*/HEAD` are also retained.

Keep these evidence lanes distinct:

- **Exact merged PR head:** named refs require current tip and branch name to match a repository-owned merged PR in the complete paginated GitHub API result. A detached worktree can instead match its exact HEAD OID to a repository-owned merged PR head without a branch label. This supports squash/rebase merges that ancestry alone misses. A reused or advanced name does not inherit its old PR's authorization.
- **Confirmed live-default ancestry:** the exact current tip is an ancestor of the exact live push-destination default OID, and the required commit objects are locally readable. Check independently of whether GitHub returned PR matches; report ancestry as ancestry, not a claim that a PR merged.
- **Unmatched or unverified:** give a short metadata warning and disposition: protected, held pending evidence, or needs explicit discard approval because potentially unique work may be lost. Age, a backup/agent name, remote absence, and duplicate-tip labels are context, not authorization. Do not end with a generic pile of "no merged PR" skips or turn these rows into a reconciliation project.

Origin-tracking cleanup is a separate local-ref decision. Propose its full `refs/remotes/origin/...` name and OID only when complete live-origin discovery proves the head absent and the tracking OID has exact PR-head or live-default ancestry evidence. A tracking ref at the same OID as a live-origin cleanup candidate is conditional on that separately approved live deletion and a fresh absence check. Divergent tracking/live tips stay held; "remote gone" alone is insufficient. Do not use broad fetch/prune to substitute for these exact-ref decisions.

Bind discovery and deletion to exactly one `origin` fetch URL and one push URL resolving to the same canonical GitHub host/owner/repository. Use `gh api --hostname <host> repos/<owner>/<repo>/... --paginate` and query the exact push URL with `git ls-remote`. An ambiguous, unsupported, or divergent identity suppresses every deletion candidate. Confirm the default through live origin HEAD, the concrete GitHub repository API, or validated `--default`; reject conflicts with an available authoritative default. Until confirmed, suppress every deletion candidate; a stale `origin/HEAD` or assumed `main` is orientation only. Discard partial GitHub results on failure, suppress live-remote candidates, and label incomplete evidence. Local/tracking ancestry evidence can still qualify against a bound, locally readable live-default OID; never substitute stale refs for a missing live OID.

The helper's inventory, candidate, skip, worktree, duplicate, conditional ignored-output, and discovery sections are inputs to one consolidated plan. No partial authorization: any failed sort, lookup, filter, pipeline, copy, move, or render must abort nonzero before candidate output. A failed current-branch query is an error, not detached HEAD; successful detached HEAD still protects the original checkout.

## Worktree disposition

Inspect every registered live worktree with NUL-delimited porcelain, including those held or detached:

```sh
git --no-optional-locks -C <path> status --porcelain=v2 -z --untracked-files=all --ignored=matching --ignore-submodules=none
```

Use reversible shell-escaped tokens for paths and porcelain-supplied free-text reasons. Check registration, common-directory identity, lock state, registered gitlinks, and relevant active processes/open handles. A clean status query alone is not permission to remove a worktree.

- **Clean removal:** the worktree is not original/current/protected or in active use, its HEAD has approved cleanup evidence or explicit discard approval, and its full status is empty with no registered submodule surface. For a branch-held worktree, every live holder must qualify; one blocking sibling holds the branch and every sibling removal. A remote-only candidate never authorizes a same-named divergent local branch or worktree.
- **Conditional ignored-output cleanup:** known regenerable ignored output may have exact cleanup targets proposed after bounded inspection confirms its nature. Cache/build-looking names alone are not proof; include the paths and regeneration basis. These are conditional targets, not already-clean worktrees. Approve cleanup first, recheck full status is empty, then use ordinary worktree removal. Unknown ignored files, config, databases, tracked/untracked changes, submodules, locks, failed inspection, or active use remain held or require a separate explicit discard decision; do not silently treat them as caches.
- **Registration-only cleanup:** `ALL PRUNABLE WORKTREE RECORDS` is inventory, not a safe prune batch. A missing-path registration can still own Git metadata/index used by a moved checkout. `WORKTREE PRUNE HOLDS` reports live/protected/locked records, associated or unregistered holders, and unresolved holder discovery; any entry blocks repository-wide prune until the registration dependency is explicitly resolved and the plan rerun. Keep detached/noncandidate records in this inventory; pruning never authorizes branch or worktree-content deletion. Unregistered or ambiguous leftovers stay held, and a same-common-directory holder blocks its branch and siblings. Do not automatically repair registration or guess a `worktree remove` target.

If the complete worktree query fails, suppress every local candidate and local removal while preserving independently proven remote candidates. A status or submodule-query failure blocks the affected local branch and all its holders. Top-level status cannot prove ignored submodule contents; retain submodule-bearing worktrees.

## Approval and execution

1. **Present one exact plan.** Show canonical repository identity, exact shell-escaped push URL, confirmed default and live OID, counts, and full local/live-remote/tracking OIDs and paths. Separate clean cleanup, conditional output/tracking cleanup, explicit-discard decisions, protected items, and held items with short reasons. Include every registered worktree and the entire proposed prune set. Batches may reference exact rows so the user need not name each item again. Approval binds those OIDs, paths, contents, and destination; it never binds only a name. Wait for approval.
2. **Revalidate immediately.** Repeat identity/default/live-ref discovery, full NUL-delimited worktree inventory, all-holder path/registration/lock/status/submodule checks, and active-use checks before mutation. Retain the originally approved OIDs. Any identity, default, tip, protection, original/current checkout, holder set, path, contents, lock, or active-use drift stops that item for a new plan. Any query error aborts local worktree removal and local compare-and-delete. Require a quiescent repository: ref CAS cannot atomically include separate occupancy and content checks.
3. **Resolve approved path prerequisites.** Remove only explicitly approved ignored-output targets after revalidating their identity and contents; never broad-clean a worktree to force an empty status. Recheck full status is empty and all holders still qualify, then run `git worktree remove <exact-path>` without `--force`. Explicit content discard requires its own exact-target approval and cannot bypass original/current/protected, lock, or active-use guards. For repository-wide `git worktree prune`, revalidate the complete set and its registration dependencies; execute only with no `WORKTREE PRUNE HOLDS` and every record it would now prune approved. A new record, dependent live holder, or unresolved discovery requires a new plan, not automatic repair.
4. **Compare-and-delete refs.** Local branch deletion is forbidden until every approved holder removal succeeded and an immediate complete `git worktree list --porcelain -z` shows no remaining binding. Use `git update-ref -d refs/heads/<branch> <approved-local-oid>`, never unchecked `git branch -D`. Independently delete an approved live-remote ref with `git push --force-with-lease="refs/heads/<branch>:<approved-remote-oid>" <approved-push-url> :refs/heads/<branch>`. Keep the exact URL and fully qualified deletion refspec; do not substitute a remote name or unchecked `--delete`. After a fresh live-origin absence check, delete each separately approved tracking ref with `git update-ref -d refs/remotes/origin/<branch> <approved-tracking-oid>`; conditional rows also require their approved live deletion to have succeeded. A failed comparison is retained, not retried against a newly observed tip. Continue only with independent approved items whose prerequisites still hold.
5. **Account for the result.** Report local branches, live-origin branches, and origin-tracking refs deleted separately, plus worktrees/output removed and registrations pruned; distinguish retained protected, declined, blocked, or unverified items. State any potentially unique work explicitly discarded and any incomplete discovery. Do not call retained work deleted or imply that an empty local branch list proves remote cleanup.

## Modes and boundaries

- Default: comprehensive report, consolidated approval, then cleanup. Dry-run stops at the plan; it changes nothing.
- "Just do it" / "don't confirm" waives the ordinary clean-cleanup confirmation only. Still print exact targets and honor every guard; potentially unique work and unknown content still require explicit discard approval.
- A named branch narrows deletion to that branch's independent local/remote tips; still inspect every holder and any repository-wide prune set before proposing those operations.
- An unmatched tip can be discarded only when the user explicitly approves its full-OID row or a clearly identified discard batch after the loss warning. Generic sweep approval is not discard approval.
- Never rebase, amend, update branch tips, or publish archival refs as part of this sweep. The deletion-only remote lease is an OID guard, not permission to rewrite history; route a separately requested rewrite to `git-history-surgery`.
