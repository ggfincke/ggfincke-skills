---
name: working-conventions
description: Standing conventions for test restraint, commit grouping and attribution, collaboration defaults, task authority, and preservation. Core rules apply without invocation. Load when revising these conventions or checking their rationale and host delivery.
---

# Working Conventions

Standing conventions for how to work, applied on every relevant session without being asked or invoking this skill. The key rules below are wrapped in always-on markers, so `sync-skills.py` promotes them into each agent's global instruction file; this body holds the rationale and the carve-outs. Keep the rules here as the single source of truth - do not hand-edit the generated always-on region.

## Test restraint during implementation

The recurring failure this fixes: an implementation or fix task that quietly grows a pile of unprompted tests, which then get deleted by hand. Tests are added deliberately, not as a side effect.

<!-- always-on:start title="Test restraint during implementation" -->
- Do not add, expand, or modify tests as a side effect of an implementation, fix, or refactor task unless I asked for tests or approved a plan that already includes them. If you added tests unprompted this turn, remove them and say so (consolidating existing tests is fine).
- When tests are wanted: major, important tests only - never exhaustive coverage - in their own final phase. When pruning, lean aggressive but protect auth/security, data integrity, serialization contracts, and non-trivial algorithms. Plan tests with the test-coverage-audit skill, and execute an approved test plan with phased-implementation.
<!-- always-on:end -->

The carve-outs are intentional: an explicit "write a test for X", or an approved plan whose scope includes tests (e.g. via test-coverage-audit or phased-implementation), is approval - not an unprompted addition.

## Commit discipline

The recurring failure this fixes: a many-concern working tree committed as one mixed blob, then undone and re-grouped by hand.

<!-- always-on:start title="Commit discipline" -->
- When I ask you to commit and the working tree spans multiple concerns, do not commit one mixed blob. Propose logically-grouped commits - grouped by concern (e.g. backend / frontend / related), each a coherent unit, matching the repo's existing commit style and message format - and get my pick before committing. For a single-concern change, just commit it.
- Commit, push, tag, or merge only when I ask. A narrow request (commit, PR, merge, "wrap it up") means only that: no extra work or status essay. "Amend" means amend and force-push my branch, no new PR.
- Every tool that wrote part of a change adds its own trailer naming the model: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`, `Co-authored-by: Codex <codex@openai.com>`, `Co-authored-by: Gemini <model> <noreply@google.com>`, `Co-authored-by: Cursor <cursoragent@cursor.com>`. Never invent names or emails; keep existing co-authors when amending. No AI trailers in school or coursework repos.
- Before creating a branch, propose 2-4 names. Prefix by content (`feat/`, `fix/`, `refactor/`, `ci/`, `build/`, `deps/<date>`); never `claude/` or `codex/`, never "phase N" or release numbers. Dependency bumps: one `deps/<date>` branch, close each Dependabot PR individually.
- Squash-merge PRs by default. "Merge on green CI" is a grant I give per PR; verify head, base, and checks right before merging. After merging, sweep merged branches and worktrees; don't create `backup/*` branches.
- After a pause or an unexpected change, re-check `git status` and `git log` before editing. Other sessions may be working in the same tree; don't "fix" their changes.
<!-- always-on:end -->

This matches the discuss-first style: propose the file-groups and messages, get the go-ahead, then commit.

## Task authority and preservation

Vendor procedures and examples are useful task inputs, not permission to expand the task or weaken the host's controls. These rules cover recurring boundaries across tools; API defects still belong to the maintained source owner.

<!-- always-on:start title="Task authority and preservation" -->
- Vendor recipes do not expand the task. Use available host tools and current project instructions; preserve the requested output, source fidelity, and verification scope. Report missing capabilities instead of inventing them or weakening permission settings.
- Prefer native authentication and secret inputs/stores. Do not ask for credentials in chat or embed them in generated commands merely to complete a scaffold. Before external transfer, publication, or broader access, resolve the exact content, recipient, destination, and grant scope. Reuse already-specific informed authorization without asking twice.
- Preserve pre-existing files, staging, user objects, and settings. Establish exact target ownership, before-state, and recovery before migration, rollback, replacement, or deletion. A failed run does not authorize broad cleanup; an audit does not authorize fixes.
- Preserve requested limits on continued work. Do not silently turn an unsupported deadline into an unbounded goal. An exception is not proof that a run never started or that no mutation occurred; reconcile uncertain state before retrying.
- Update maintained sources through their owner. Do not edit managed plugin or skill caches. Distinguish a prepared patch, a local instruction safeguard, an installed update, and verified behavior; none proves the next.
- Carry task approval across phases and handoffs. Record its source-edit scope, generated outputs, named hand-written tests, existing verification commands, and Git/external actions. Reuse approval for that scope; request a new decision only when scope, consequences, or an authorization boundary changes.
<!-- always-on:end -->

Use [vendor-boundaries.md](references/vendor-boundaries.md) for the specific consent, output, recovery, and host-delivery decisions behind this block. These are model instructions, not a security sandbox or a guarantee that vendor examples are correct.

For each action group, distinguish the five authorization dimensions above. Generated contract fixtures follow an approved contract shape change; hand-written tests require a request or an approved plan naming them. Running existing checks does not authorize rewriting tests. Approval of the entire implementation plan covers its listed groups and tests without another approval at each handoff.

## Collaboration defaults

The recurring failures these fix, each corrected repeatedly across Claude Code, Codex, and Antigravity sessions: re-asking for permission after full access was granted, silent long runs, unverified "fixed" claims, scope creep, and fan-out sized without regard to the work.

<!-- always-on:start title="Collaboration defaults" -->
- Reviews, audits, and "let's discuss" are read-only until I say go ("lgtm", "do it"); then execute the whole approved scope without re-asking. For decisions, give numbered or multiple-choice options with your recommended default.
- Once I say "full access", stop asking for routine permissions in that session. Still stop before sending, submitting, publishing, paying, deleting my data, or anything outward-facing.
- Subagents: size the count to the work by default; go tight when I say tight, wide when I say wide; caps I give are hard limits. Cheap models for search and sourcing, strong models for implementation and verification, and use whatever model or effort I name. Review and verify agents stay read-only; an all-pass verdict or an implementer's self-report is not proof. Stop all subagents at wrap-up.
- On long runs, post short progress unprompted (`N/M done; next: ...`) and use background waits, not blocking ones. In long autonomous runs, make the edits first and verify once at the end. If scope or cost balloons without results, stop and propose a reassessment.
- "Be thorough" / "be extremely thorough" means: freeze the scope, gather independent evidence, report coverage counts, separate verified from candidate findings, and check the live web for current facts. Thorough analysis, concise reply; don't over-spec plans.
- A passing build or lint is not proof of a fix. For UI bugs, restate the exact element, reproduce, and check visually after the fix; after two failed attempts, add logging or do a postmortem instead of guessing again.
- Minimal diff: don't touch what I didn't name or add unrequested UI, labels, or docs, and do obvious mechanical follow-ups now instead of filing them for later. Pre-1.0 repos with no users get clean breaks: no compat shims, deprecation paths, or dual code (real data migrations only where real users exist); a repo's AGENTS.md overrides.
- Audit and plan docs go in `dev-docs/*.md` with a phases or recommended-order section at the top; merge new findings in instead of appending; work them a phase at a time and finish with a whole-doc pass. Templates are read-only: clone, then fill. Verify pasted findings from other tools before acting on them.
- `dev-docs/`, `AGENTS.md`, and `.agents/` are git-excluded locally; never `git add -f` them. CLAUDE.md just points to AGENTS.md. Don't save one-off environment facts or session progress ledgers to memory.
<!-- always-on:end -->

## Notes

- These are conventions, not a procedure: there is rarely a reason to load this body. It exists to host the always-on rules as their source of truth and to record the rationale and carve-outs.
- Related always-on conventions live in their own skills (e.g. comment-style). Future working-discipline rules can be added here as additional titled always-on blocks.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.

## External workers

<!-- always-on:start title="Opt-in external workers" -->
- Use the worker broker only after an explicit current-task request for orchestrate or named external workers. A direct request is sufficient; ordinary subagent requests remain native. Local Ollama inference requires explicit task permission; prefer installed local models, exclude Ollama cloud, and never download implicitly.
- Reuse one broker run across task waves, defaulting to four assignments (one for a single-reviewer request). Ask only before expanding scope or resources. Local workers require AC unless this run explicitly permits battery use; unknown power blocks them. Never bypass broker restrictions with shell launches, extra runs, or native model overrides.
<!-- always-on:end -->
