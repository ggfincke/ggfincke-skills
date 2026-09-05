---
name: workspace-cleanup
description: Inventory and safely clean local project or disk clutter using ownership, live process/worktree checks, exact-target approval, recovery, reversible staging, and measured results. Also use for static inspection of an unfamiliar executable before a requested launch decision. Do not use for code refactoring, Git branch-only cleanup, or automatic execution of unfamiliar software.
---

# Workspace Cleanup

Preserve user-owned state while finding and carrying out the specifically approved cleanup. Size, age, duplicate-looking names, an archive label, or a passing build does not authorize deletion.

## Inventory before proposing removal

1. Establish the requested roots and cleanup purpose. Record paths, types, logical sizes, timestamps where useful, symlink targets, and inaccessible areas without traversing unrelated private stores or printing secrets.
2. Identify ownership and use: user source, generated output, installed dependency, application cache, worktree, active process, or unknown. Inspect Git status including relevant untracked/ignored work, worktree registrations, and open handles/process ownership before classifying a project directory as disposable.
3. Find the maintained owner. Prefer an application's supported cleanup/update mechanism for managed caches and installations. A generated copy may need a source fix and regeneration; do not patch or purge managed files just because they are old.
4. Establish a recovery route for each consequential target. A configured remote is not proof of a backup: check the exact commits/data and whether local-only work is preserved. Bind proposed targets to current paths and hashes/OIDs when identity matters.
5. Present a bounded exact-target plan with expected effect, preserved state, recovery location, and unresolved ownership. Keep uncertain candidates out of the executable removal list.

Use `branch-sweep` for Git branch/worktree cleanup and its exact-OID approval contract. This skill does not introduce another Git deletion mechanism. Use the relevant source-code review skill for duplication or refactoring inside code.

## Inspect unfamiliar executables without launching

For an investigation or “look into this” request, inspect file type, provenance, signatures, archive contents, metadata, and readable resources with available inspection tools. Do not run the binary, installer, package lifecycle scripts, or a bundled helper merely to learn what it does. Do not bypass quarantine, security warnings, or permissions. A valid signature or static scan alone is not proof of safety.

Report what the inspection establishes and what remains unknown. Execution or installation requires the user's requested scope plus the current host's applicable approval rules. Prefer an isolated environment when execution is later authorized; isolation is not a substitute for authorization.

## Execute only the approved plan

1. Reconcile each target immediately before mutation. If the path, owner, contents, OID, active use, or recovery assumptions changed, stop that target and revise the plan. Reuse still-valid specific approval; approval to inventory is not approval to remove.
2. Use reversible Trash or a private, recorded quarantine when appropriate. Preserve relative paths, relevant metadata, and a manifest that makes restoration unambiguous. Refuse destination collisions and do not overwrite unrelated recovery data.
3. Keep independent targets separate so a failure can be reported or reversed without broad cleanup. Restore only the changes owned by this operation; a failed command does not authorize a recursive reset, force deletion, or killing unrelated processes.
4. Verify both sides: approved targets left their discovery/use location, preserved files still match, and the recovery copies exist and can be restored. For installations, verify discovery and the maintained replacement before retiring old entrypoints.
5. Remeasure the requested outcome. On copy-on-write or snapshotting filesystems, logical directory totals do not equal physically reclaimed space. Moving to quarantine or Trash often frees no space; report actual free-space change separately.

Permanent deletion, emptying Trash, deleting snapshots, and removing the recovery copy are separate consequential actions. Do not infer them from successful staging or from an instruction to clean up a different target. Follow current host confirmation requirements at the action boundary.

## Close with a recovery receipt

Record the exact completed, skipped, and failed targets; before/after evidence; recovery location and restore procedure; and actual measured outcome. Keep sensitive manifests local with appropriate access controls. Do not claim removal or recovered capacity from a submitted command alone. If anything is blocked, name the one ownership or authorization decision needed next.
