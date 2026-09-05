---
name: mega-review-core
description: Run a thorough five-lens codebase, branch, or large-diff review into one durable audit document using bug-hunt, simplification, consolidation, test-gap, and performance lenses, with security explicitly out of scope. Use when the user asks for a mega-review without security or cybersecurity analysis, wants a bounded review that avoids security-review model limits, or wants the other five lenses synthesized into one document. Do not use for full all-lens audits, security audits, ordinary deep reviews, or single-lens work.
---

# Mega Review Core

Run a thorough five-lens review and produce one comprehensive audit document. This is the security-free profile of `mega-review`: it preserves the durable artifact, cross-lens merge, adversarial verification, and phased action-plan workflow while omitting the security lens and its reviewer panels.

## Scope boundary

- Run only bug-hunt, simplification, consolidation, test-gaps, and performance.
- Do not load or invoke `security-remediation`.
- Do not perform threat modeling, authz review, input-to-sink exploit tracing, secrets/crypto review, dependency-security review, or security severity classification.
- If a security concern appears incidentally, record it as an out-of-scope follow-up without analyzing or proposing a security remediation. Point the user to a separate `security-remediation` pass when appropriate.
- Use the full `mega-review` skill for all six lenses or any request that explicitly includes security.

Use the local [neutral protocol](references/review-protocol.md) for standalone lens baselines when sibling specializations are absent. Never load the full profile or its security material to supply a missing reference.

## Lenses

Run all five lenses unless the user narrows the set, and state the final lens set in the audit document.

1. **Correctness / bug-hunt** - use the finder -> refute -> synthesize protocol in [references/usage.md](references/usage.md).
2. **Simplification** - use the local baseline, optionally specialized by `simplification-review`.
3. **Consolidation** - use the local baseline, optionally specialized by `consolidation-audit`. `architecture-review` is an optional sibling track outside this five-lens profile, not an implied part of consolidation.
4. **Test gaps** - use the local baseline, optionally specialized by `test-coverage-audit`; do not pursue exhaustive coverage.
5. **Performance** - use the hot-path checklist in [references/usage.md](references/usage.md), including React/TS guidance where relevant.

## Orchestration

1. Read `AGENTS.md`, `CLAUDE.md`, `README`, and relevant project docs before reviewing. Treat repository conventions, gates, and compatibility policy as constraints.
2. Confirm the target scope. Use the requested files, branch, diff, or codebase; do not expand a scoped review into a whole-repo pass.
3. Copy [the packaged template](assets/templates/mega-review-core-template.md) to a concrete dated audit file, normally `dev-docs/mega-review-core-YYYY-MM-DD.md`, before synthesis. Never edit or overwrite the packaged template; update an existing audit only when the user points to the same scope. The concrete audit is the sole permitted write during the otherwise source-read-only review.
4. Fan out the five lens tracks when the harness supports parallel work. Give each track the exact scope, baseline, exclusions, read-only boundary, allowed commands, and output contract.
5. Merge findings across lenses. Deduplicate by root cause, verify every survivor against live code, and preserve refuted or unverifiable claims in the appropriate audit sections.
6. Group survivors into cohesive action groups by shared files, dependency chains, and change shape. Sequence low-risk independent work before cross-cutting work.
7. Keep the audit file as the source of truth. Do not create separate findings or action-group documents unless the user asks.

## Handoff contract

Each delegated track must return:

- exact scope, baseline, exclusions, and whether the pass is whole-codebase or scoped;
- the owning skill or the bug-hunt/performance protocol;
- read-only constraints: no edits, formatting, dependency changes, or external attacks/probes;
- candidate findings with evidence, trigger or trace, severity/confidence where applicable, recommendation, validation, and action-group hints;
- rejected, stale, unverifiable, and deliberately-not-worth-doing claims with the evidence that settled them;
- no security findings or security analysis.

## Effort and verification

Scale agent count and model tier to the user's requested effort. Do not exceed an explicit cap.

- **Standard** - one reader per lens over the requested surface and a focused merge.
- **Thorough** - per-module readers for bug-hunt and consolidation, plus adversarial verification of high-risk or removal-class findings.
- **Exhaustive** - loop-until-dry discovery, multi-voter refutation where justified, and a completeness check for every requested lens and module.

Keep the review read-only until action groups are approved. Match every verdict to evidence, distinguish `Needs measurement` from confirmed performance findings, and dedupe one root cause into one finding tagged with all relevant lenses.

## After approval

Hand approved action groups to `phased-implementation`. Implement one group at a time, run that group's gates, continue through groups already approved, and update the audit file with status, validation, deviations, and deferrals.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
