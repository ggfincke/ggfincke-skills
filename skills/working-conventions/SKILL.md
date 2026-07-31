---
name: working-conventions
description: Standing working conventions applied on every relevant change without being invoked - currently test restraint during implementation and commit grouping by concern. The core rules are always-on, so they apply even when this body is not loaded. Load the body when adding or revising these conventions, wiring up commit/test discipline in a repo, or when you need the rationale behind the always-on rules.
---

# Working Conventions

Standing conventions for how to work, applied on every relevant session without being asked or invoking this skill. The key rules below are wrapped in always-on markers, so `sync-skills.py` promotes them into each agent's global instruction file; this body holds the rationale and the carve-outs. Keep the rules here as the single source of truth - do not hand-edit the generated always-on region.

## Test restraint during implementation

The recurring failure this fixes: an implementation or fix task that quietly grows a pile of unprompted tests, which then get deleted by hand. Tests are added deliberately, not as a side effect.

<!-- always-on:start title="Test restraint during implementation" -->
- Do not add, expand, or modify tests as a side effect of an implementation, fix, or refactor task unless I asked for tests or approved a plan that already includes them. If you added tests unprompted this turn, remove them and say so.
- When tests are wanted: major, important tests only - never exhaustive coverage. Plan them deliberately with the test-coverage-audit skill, and execute an approved test plan with phased-implementation.
<!-- always-on:end -->

The carve-outs are intentional: an explicit "write a test for X", or an approved plan whose scope includes tests (e.g. via test-coverage-audit or phased-implementation), is approval - not an unprompted addition.

## Commit discipline

The recurring failure this fixes: a many-concern working tree committed as one mixed blob, then undone and re-grouped by hand.

<!-- always-on:start title="Commit discipline" -->
- When I ask you to commit and the working tree spans multiple concerns, do not commit one mixed blob. Propose logically-grouped commits - grouped by concern (e.g. backend / frontend / related), each a coherent unit, matching the repo's existing commit style and message format - and get my pick before committing.
- For a single-concern change, just commit it; this is for multi-concern trees.
<!-- always-on:end -->

This matches the discuss-first style: propose the file-groups and messages, get the go-ahead, then commit.

## Notes

- These are conventions, not a procedure: there is rarely a reason to load this body. It exists to host the always-on rules as their source of truth and to record the rationale and carve-outs.
- Related always-on conventions live in their own skills (e.g. comment-style). Future working-discipline rules (edit/preserve-on-edit, branch naming, subagent tier routing) can be added here as additional titled always-on blocks.
