---
name: mega-review
description: Run an explicit multi-lens review/audit of a codebase, branch, or large diff into one durable mega audit document - orchestrate bug-hunt, simplification, consolidation, security, test-gap, and performance lenses, adversarially verify and dedupe findings, and produce integrated action groups, risk sequencing, and testing guidance, read-only until approved. Use when the user explicitly asks for mega-review, the works, all lenses, max-effort/everything audit, one multi-lens audit doc, or a scoped 2+ lens audit that includes security. For a security-free five-lens profile, use mega-review-core. Do not use for ordinary deep/full PR reviews unless they ask for multi-lens synthesis into one document; for one focused lens use that lens's own skill, and for a fast correctness or PR pass use the host's ordinary review workflow.
---

# Mega Review

You are running a maximum-effort, multi-lens review and producing one comprehensive audit document. This is the "do the works" pass: every review lens at once, findings verified and deduped across lenses, organized into an implementable plan. You stay read-only until the plan is approved.

This skill is an orchestrator, not a reimplementation. Each lens delegates to the skill that owns it; you run them together, then merge. Do not restate the owning skill's rules here - load and apply them. The two lenses with no owning skill (bug-hunt, performance) are specified below.

## When to use it - and when not to

- Use mega-review only when explicitly asked for multi-lens synthesis into one document: `mega-review`, "the works", "all lenses", "every lens, one doc", "one multi-lens audit doc", "max-effort audit", or a scoped 2+ lens audit such as "bugs + security + tests + perf". It is deliberately heavy.
- Do not use it for ordinary "deep review" or "full PR review" requests unless the user also asks for multi-lens synthesis or one audit document.
- For a single lens, use that lens's skill directly - simplification-review, consolidation-audit, security-remediation, test-coverage-audit. They are sharper and cheaper for a focused pass, and they still exist on their own.
- For the repeatable five-lens profile with security explicitly out of scope, use `mega-review-core`. Ad hoc lens scoping remains valid when the request calls for a different subset.
- For a fast correctness pass or PR review, use the host's ordinary review workflow. mega-review is the slow, broad, document-producing counterpart. `/code-review` is only an optional external host command when that host actually defines it; this package does not.

## The lenses

Run all six by default. The user can scope them ("everything but security", "just bugs + simplification + perf") - honor that and say which you ran.

1. **Correctness / bug-hunt** (owned here - no standalone skill). Hunt for real defects at maximum recall: logic errors, broken invariants, race conditions, error-handling gaps, off-by-one, null/None handling, contract violations, state desync. Use the finder -> refute -> synthesize protocol in `references/usage.md`.
2. **Simplification** -> simplification-review. Behavior-preserving local cleanup, code quality, narrow reuse, and efficiency within the reviewed surface. For whole-repo dedupe, dead code, and implementation drift, let consolidation own the finding and tag simplification only when the same fix has a local behavior-preserving cleanup angle.
3. **Consolidation** -> consolidation-audit. Duplication across files, parallel-implementation drift, and abstractions that should exist. Apply its map -> find -> verify -> group flow. Architecture review is a separate opt-in sibling track, never an implied default lens.
4. **Security** -> security-remediation. Its five panels (threat model, auth/authz & tenancy, input-to-sink injection, secrets/crypto/config/logging, dependency/build/test), severity & confidence rubric, and hard rules.
5. **Test gaps** -> test-coverage-audit. The few major, important tests worth adding - and what is deliberately not worth testing. Major-tests-only, never exhaustive coverage.
6. **Performance** (owned here - no standalone skill). Real hot paths only: N+1 and over-fetching, repeated expensive lookups, unnecessary recomputation/allocations, wasteful renders/state updates, blocking I/O, missing batching/caching, query/index problems, payload size. Backend-platform limits count (e.g. Convex read/write ceilings). See the perf checklist in `references/usage.md`. Do not propose speculative micro-optimizations off the hot path.

In a React/TS repo, fold react-best-practices into the simplification and performance lenses rather than running it as a seventh - it is the same lens, stack-specialized. It owns correctness, Hooks, state design, and typing; when the repo is on Next.js or the finding is bundle size or data fetching, fold in vercel-react-best-practices instead, which owns those axes.

## Orchestration

Start by reading AGENTS.md / CLAUDE.md / README for conventions, build/test gates, architectural intent, and any pre-1.0 / breaking-change stance. Treat them as constraints throughout - a finding that fights an explicit project rule is not a finding.

1. **Scope.** If a scope is given (files, a branch, a diff, a module), review that. If none is given, mega-review usually targets a whole branch (`git diff main...HEAD`) or the whole codebase - confirm which before a full-repo pass, since it is expensive.
2. **Create the audit artifact.** Unless the user explicitly asks for chat-only output, copy [the packaged template](assets/templates/mega-review-template.md) to a concrete dated file before synthesis, normally `dev-docs/mega-review-YYYY-MM-DD.md` or the repo's established review-doc location. Never edit or overwrite the packaged template. Update an existing audit only when the user points to it and it covers the same scope; otherwise choose a new dated path. The concrete audit is the sole permitted write during the otherwise source-read-only review and becomes the living source of truth for phased implementation.
3. **Fan out, one track per lens.** When the harness supports parallel subagents, run the lenses concurrently; otherwise sequentially. Each track applies its owning skill's discipline and returns raw findings with evidence. Route by model tier (see below) and use the handoff contract below.
4. **Merge across lenses.** This is the step that makes it one review, not six stapled together:
   - **Dedupe.** The same root cause often surfaces under multiple lenses (a duplicated helper is consolidation + simplification; an unbounded query is perf + security DoS). Collapse to one finding, tagged with every lens it came from.
   - **Verify adversarially.** Apply the verify-review-findings discipline to your own findings: grep before calling anything dead, confirm two paths are behavior-identical before calling them duplicates, trace source-to-sink before calling something exploitable, confirm a hot path before calling it slow. For high-consequence or removal-class findings, try to refute - majority-refute kills it. Survivors only.
   - **Considered & rejected.** Record what you checked and discarded, each with the evidence that settled it, so it is not re-raised next pass.
   - **Classify uniformly.** Give every survivor a severity, a confidence, and a behavior risk on one scale across all lenses, so the index is comparable.
5. **Group and sequence.** Organize survivors into cross-lens action groups by file overlap, dependency chains, and shared change shape - each group a cohesive unit of work. Order groups into phases: independent/low-risk first, cross-cutting/high-risk later. Treat test coverage as a continuous concern across every group.
6. **Write one mega doc.** Update the concrete audit document copied from [the packaged template](assets/templates/mega-review-template.md). The concrete document is the single source of truth; do not spill into separate action-group or commit-plan files unless asked.

## Lens subagent handoff contract

When delegating a lens, give each subagent a packet with:

- **Scope:** exact repo/path/branch/diff, baseline, exclusions, and whether the pass is whole-codebase or scoped.
- **Skill:** the owning skill to load and follow, or `mega-review`'s bug-hunt/performance protocol for ownerless lenses.
- **Boundary:** read-only, no edits, no formatting, no dependency changes, and no running external attacks or production probes.
- **Commands:** safe local reads/searches/checks allowed, plus any commands that are out of scope.
- **Output:** candidate findings with title, lens, severity/confidence/risk when applicable, evidence, trigger or source-to-sink trace, recommendation, validation, and action-group hints.
- **Rejected claims:** false positives, stale items, unverifiable claims, and not-worth-doing items with the evidence that settled them.
- **Owner-specific fields:** preserve the owning skill's required fields rather than flattening them. Security keeps source/trust-boundary/sink/impact/regression detail; test-gaps keeps worth-testing and deliberately-not-testing detail.

## Thoroughness & subagent budget

Let the user's stated intensity set the dial; do not guess. Scale agent count and model tier together; default to the lightest pass that genuinely covers all six lenses, and never exceed an explicit cap. A rough ladder:

- **Standard** - one reader per lens over a scoped diff; cheap/fast tier for reading & per-claim verification, strong tier for the cross-lens merge and synthesis.
- **Thorough** - per-lens readers plus, inside the bug/consolidation lenses, per-module readers and whole-repo cross-cutting hunters; adversarial verify on removal-class and high-severity findings.
- **Exhaustive** - loop-until-dry discovery per lens, multi-voter refute panels on every high-severity and removal-class finding, and a completeness critic that asks what lens or module went unread. The verification pass should be as long as the discovery pass - a plausible-but-wrong finding in a mega doc is expensive.

Match model to task: strongest tier for judgment, verification, and the cross-lens merge; cheapest tier that can do a mechanical, scoped read. Honor explicit caps ("stay tight, don't spawn 20+ agents") as hard limits, and report what you scoped out.

## Hard rules

- Read-only until approved for implementation/code changes. Writing or updating the audit document itself is allowed during the review; do not fix, refactor, format, or clean up code until action groups are approved.
- Defer to the owning skills; do not relax their hard rules. The simplification lens still must not change behavior; the security lens still must not invent crypto; the test lens still adds only major tests.
- Respect repo conventions and any pre-1.0 / breaking-change stance from AGENTS.md - propose the clean break where the repo allows it, scaffold compat where it does not.
- One finding per root cause. Dedupe across lenses; never list the same issue six times under six headings.
- Match verdict to evidence. Do not inflate a hardening nicety to High to look thorough, and do not bury a confirmed bug. Dismissals need the most evidence.
- Keep scope to what was asked. If a full-repo sweep was not requested, do not start one.

## After approval

Once specific findings or action groups are approved, hand execution to the phased-implementation skill: one action group at a time, run that group's gates, stop and gate between groups, and update the mega doc as the living source of truth (mark groups done, record deviations and deferrals). Do not apply the whole plan in one pass.

## Notes

- The lens skills are the single source of truth for each lens and still run standalone; mega-review composes them, it does not fork them. Keep their rules there, not duplicated here.
- consolidation-audit is the closest sibling: mega-review is consolidation-audit's structure widened from one lens to six, sharing the same doc shape and Considered & Rejected discipline.
- The host's ordinary review workflow is the fast correctness/PR pass; mega-review is the slow, broad, document-producing one. Different jobs.
- `references/usage.md` has invocation variants, lens-scoping phrases, the bug-hunt finder -> refute -> synthesize protocol, and the performance checklist.
- `assets/templates/mega-review-template.md` is the packaged template to copy; the concrete audit document is the single source of truth, with the cross-lens finding index, per-lens findings, considered/rejected, integrated action groups, risk-sequenced phases, test-suite analysis, and verification log.
