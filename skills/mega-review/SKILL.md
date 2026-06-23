---
name: mega-review
description: Run a maximum-effort, multi-lens review of a codebase, branch, or large diff - orchestrate the bug-hunt, simplification, consolidation, security, test-gap, and performance lenses as one pass, adversarially verify and dedupe findings across lenses, and produce one mega audit document with integrated action groups, risk sequencing, and testing guidance, read-only until approved. Use only when explicitly asked for the works - a mega/deep/max-effort/full/everything review or audit into a single document; for one focused lens use that lens's own skill, and for a fast correctness or PR pass use /code-review - none of which this replaces.
---

# Mega Review

You are running a maximum-effort, multi-lens review and producing one comprehensive audit document. This is the "do the works" pass: every review lens at once, findings verified and deduped across lenses, organized into an implementable plan. You stay read-only until the plan is approved.

This skill is an orchestrator, not a reimplementation. Each lens delegates to the skill that owns it; you run them together, then merge. Do not restate the owning skill's rules here - load and apply them. The two lenses with no owning skill (bug-hunt, performance) are specified below.

## When to use it - and when not to

- Use mega-review only when explicitly asked for everything in one document: "mega/deep/max-effort/full review", "audit the whole thing", "every lens, one doc", "the works". It is deliberately heavy.
- For a single lens, use that lens's skill directly - simplification-review, consolidation-audit, security-remediation, test-coverage-audit. They are sharper and cheaper for a focused pass, and they still exist on their own.
- For a fast correctness pass or PR review, use /code-review. mega-review does not replace it; it is the slow, broad, document-producing counterpart.

## The lenses

Run all six by default. The user can scope them ("everything but security", "just bugs + simplification + perf") - honor that and say which you ran.

1. **Correctness / bug-hunt** (owned here - no standalone skill). Hunt for real defects at maximum recall: logic errors, broken invariants, race conditions, error-handling gaps, off-by-one, null/None handling, contract violations, state desync. Use the finder -> refute -> synthesize protocol in `references/usage.md`.
2. **Simplification** -> simplification-review. Behavior-preserving reuse, code-quality, efficiency, dead code, drift, missing shared helpers. Apply that skill's lenses and hard rules verbatim.
3. **Consolidation / architecture** -> consolidation-audit. Duplication across files, parallel-implementation drift, architectural mismatch, abstractions that should exist. Apply its map -> find -> verify -> group flow.
4. **Security** -> security-remediation. Its five panels (threat model, auth/authz & tenancy, input-to-sink injection, secrets/crypto/config/logging, dependency/build/test), severity & confidence rubric, and hard rules.
5. **Test gaps** -> test-coverage-audit. The few major, important tests worth adding - and what is deliberately not worth testing. Major-tests-only, never exhaustive coverage.
6. **Performance** (owned here - no standalone skill). Real hot paths only: N+1 and over-fetching, repeated expensive lookups, unnecessary recomputation/allocations, wasteful renders/state updates, blocking I/O, missing batching/caching, query/index problems, payload size. Backend-platform limits count (e.g. Convex read/write ceilings). See the perf checklist in `references/usage.md`. Do not propose speculative micro-optimizations off the hot path.

In a React/TS repo, fold react-best-practices into the simplification and performance lenses rather than running it as a seventh - it is the same lens, stack-specialized.

## Orchestration

Start by reading AGENTS.md / CLAUDE.md / README for conventions, build/test gates, architectural intent, and any pre-1.0 / breaking-change stance. Treat them as constraints throughout - a finding that fights an explicit project rule is not a finding.

1. **Scope.** If a scope is given (files, a branch, a diff, a module), review that. If none is given, mega-review usually targets a whole branch (`git diff main...HEAD`) or the whole codebase - confirm which before a full-repo pass, since it is expensive.
2. **Fan out, one track per lens.** When the harness supports parallel subagents, run the lenses concurrently; otherwise sequentially. Each track applies its owning skill's discipline and returns raw findings with evidence. Route by model tier (see below).
3. **Merge across lenses.** This is the step that makes it one review, not six stapled together:
   - **Dedupe.** The same root cause often surfaces under multiple lenses (a duplicated helper is consolidation + simplification; an unbounded query is perf + security DoS). Collapse to one finding, tagged with every lens it came from.
   - **Verify adversarially.** Apply the verify-review-findings discipline to your own findings: grep before calling anything dead, confirm two paths are behavior-identical before calling them duplicates, trace source-to-sink before calling something exploitable, confirm a hot path before calling it slow. For high-consequence or removal-class findings, try to refute - majority-refute kills it. Survivors only.
   - **Considered & rejected.** Record what you checked and discarded, each with the evidence that settled it, so it is not re-raised next pass.
   - **Classify uniformly.** Give every survivor a severity, a confidence, and a behavior risk on one scale across all lenses, so the index is comparable.
4. **Group and sequence.** Organize survivors into cross-lens action groups by file overlap, dependency chains, and shared change shape - each group a cohesive unit of work. Order groups into phases: independent/low-risk first, cross-cutting/high-risk later. Treat test coverage as a continuous concern across every group.
5. **Write one mega doc.** Use `assets/templates/mega-review-template.md`. It is the single source of truth; do not spill into separate action-group or commit-plan files unless asked.

## Thoroughness & subagent budget

Let the user's stated intensity set the dial; do not guess. Scale agent count and model tier together; default to the lightest pass that genuinely covers all six lenses, and never exceed an explicit cap. A rough ladder:

- **Standard** - one reader per lens over a scoped diff; cheap/fast tier for reading & per-claim verification, strong tier for the cross-lens merge and synthesis.
- **Thorough** - per-lens readers plus, inside the bug/consolidation lenses, per-module readers and whole-repo cross-cutting hunters; adversarial verify on removal-class and high-severity findings.
- **Exhaustive** - loop-until-dry discovery per lens, multi-voter refute panels on every high-severity and removal-class finding, and a completeness critic that asks what lens or module went unread. The verification pass should be as long as the discovery pass - a plausible-but-wrong finding in a mega doc is expensive.

Match model to task: strongest tier for judgment, verification, and the cross-lens merge; cheapest tier that can do a mechanical, scoped read. Honor explicit caps ("stay tight, don't spawn 20+ agents") as hard limits, and report what you scoped out.

## Hard rules

- Read-only until approved. mega-review produces a plan, not edits. Do not fix, refactor, or clean up during the review.
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
- /code-review is the fast correctness/PR pass; mega-review is the slow, broad, document-producing one. Different jobs.
- `references/usage.md` has first-turn invocation variants, lens-scoping phrases, the bug-hunt finder -> refute -> synthesize protocol, and the performance checklist.
- `assets/templates/mega-review-template.md` is the single audit doc: cross-lens finding index, per-lens findings, considered/rejected, integrated action groups, risk-sequenced phases, test-suite analysis, and verification log.
