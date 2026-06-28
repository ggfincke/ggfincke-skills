---
name: test-pruning-audit
description: "Audit an existing test suite and flag the tests that should not exist - low-value, redundant, exhaustive, tautological, brittle, over-mocked, or coverage-number filler - giving each a verdict (Delete / Merge / Simplify / Keep) w/ cited evidence, read-only until you approve what to remove. INVERSE of test-coverage-audit (which finds the MAJOR tests that are MISSING); send anything about test gaps, improving coverage, what to test, or writing/running tests to that skill, not this one. Use only for the prune direction: which tests to delete or prune, trimming test bloat, finding redundant / over-engineered / brittle tests, deciding which existing tests still earn their place, or that the suite tests too much or breaks on every refactor. Not simplification-review: judging that a test should not exist at all is a value call, not a behavior-preserving code cleanup."
---

# Test Pruning Audit

You audit an existing test suite for the tests that do not earn their place - the low-value, redundant, exhaustive, tautological, brittle, over-mocked, vacuous, or coverage-gate-filler tests that cost maintenance without protecting real, breakable behavior. You classify each with a verdict and cited evidence, aggregate into one findings doc, and stay read-only until I approve which to remove. This is non-destructive: you propose removals, you do not delete during the audit.

This is the prune direction. It is the INVERSE of test-coverage-audit: that skill finds the few MAJOR tests that are MISSING; this one finds the EXCESS tests that should not exist. Together they right-size a suite. If the ask is really about missing tests, gaps, improving coverage, what to test, or writing/running tests, that is test-coverage-audit - say so and stop. Do not drift into hunting for missing tests here.

It is also not simplification-review. Trimming an over-parametrized or over-mocked test in place is a behavior-preserving cleanup that simplification-review can own. The call that a test should not exist at all - that it protects nothing worth protecting - is a VALUE judgment, and that judgment is this skill's job. Do not restate simplification-review.

Treat every flagged test as a hypothesis, not a fact: "this test protects nothing real," or "this is already covered elsewhere," or "this is pure implementation detail." A test does not get a Delete because it looks trivial; it gets one because you read it AND the code under test and proved the hypothesis. Hold Delete to the highest bar. Default to Keep when you cannot clearly justify removal.

## The bar every test is measured against

A test earns its place only if it protects critical, breakable behavior with real consequences - data integrity, money, auth & permissions, security, complex non-obvious logic, a core user flow, or a hard-won bug regression. Measure each test against that bar, never against a coverage number. A high-coverage suite full of trivial tests is the problem, not the goal. Prefer a short high-value suite over chasing a percentage; tests that do not clear the bar are liabilities - they slow the suite, break on harmless refactors, and manufacture false confidence.

## Finding the scope

If a scope is provided - a whole suite, one test file or module, the new tests in a diff, a pre-refactor area, or a post-merge bloat sweep - audit that. If nothing is provided, ask or take the most important / most bloated test area; do not silently sweep the whole repo. Stay within the scope.

## Detect the setup

Before judging anything, learn how this repo tests and what it requires:

- Test framework & runner from the build files (package.json / pyproject / go.mod). Do not assume.
- Test file location, naming, & how cases are organized; the fixture, factory, & mock patterns in use.
- AGENTS.md / CLAUDE.md / README for any testing stance, and whether a coverage gate exists in CI or config. A gate that mandates a line/branch number constrains what you can recommend removing - note it.

## Hard rules

- Measure every test against the bar, not against coverage. The question is always "what real, breakable behavior does this protect?" - never "does this hit a line." A green coverage number on trivial tests is not a reason to keep them.
- Read the test AND the code under test before judging. A simple-looking test may guard a subtle invariant; an elaborate test may assert nothing. No verdict from the test name or shape alone.
- Deletion needs the most evidence. Before recommending Delete, prove the behavior is trivial, OR already covered elsewhere (name the covering test), OR purely implementation-detail. Hold Delete to the highest bar; if a Delete would only be a Medium- or Low-confidence call, downgrade it.
- Never delete the only test of a real path. If a questionable test is the sole coverage of important behavior, flag it to IMPROVE, never to remove - that is the cross-check against the gaps direction.
- Read-only until approved. The audit produces a findings doc, not edits. Do not delete, merge, or trim any test during the audit.
- Never weaken the safety net silently. If a removal would drop the last coverage of important behavior, call it a tradeoff in the open.
- Never edit source to make a test prunable. If a test only looks low-value because the source is untestable, that is a separate finding - do not change behavior to justify a deletion.
- Respect coverage gates & conventions. If a gate, AGENTS.md, or CLAUDE.md mandates a test, flag the conflict; do not recommend a deletion that breaks the gate.
- Stay in the prune direction. Missing tests -> test-coverage-audit. Behavior-preserving in-place test cleanup -> simplification-review. A real bug surfaced while reading -> stop and report it.

## What to flag

Tests that do not clear the bar. Each is a candidate, subject to the verdict and the safety check:

- **Trivial-coverage** - getters/setters, simple pass-throughs, constants, type-only assertions, dumb mappers, or framework/library behavior the project does not own.
- **Exhaustive permutations** - many near-identical cases over input variations that add no new failure mode; combinatorial blow-ups. Collapse to one representative or parametrize down.
- **Tautological / self-referential** - asserts a mock returned what you told it to return; re-implements the code under test inside the test; assertions that just restate the setup.
- **Implementation-detail / brittle** - asserts private internals, exact call order, log strings, or snapshot/DOM structure; breaks on safe refactors w/o catching real bugs.
- **Redundant / duplicate** - the same behavior already covered by another (often higher-level) test; overlapping unit + integration over the identical path.
- **Over-mocked** - so much is mocked that nothing real is exercised; the test would still pass if the real integration were broken.
- **Vacuous** - no meaningful assertion (only "does not throw" on trivial code), or assertions that can never fail.
- **Coverage-gate filler** - exists only to hit a line/branch for a number, not to protect behavior.

## What not to flag

Do not over-prune. Leave these alone (and say why if asked):

- Tests protecting critical, breakable behavior, even if they look simple.
- Regression tests pinned to a real past bug - they encode hard-won knowledge; keep them and note the bug if known.
- Characterization tests around legacy code mid-refactor.
- A test that is the ONLY coverage of an important path, even if imperfect - flag it to IMPROVE, never to delete.
- Anything a coverage gate, AGENTS.md, or CLAUDE.md mandates - note the conflict instead of recommending a deletion that breaks the gate.

## Procedure

Detect the setup first (above), then:

1. **Inventory the scope.** List the test files / cases in scope. Note the framework, fixtures, & any coverage gate.
2. **Form the hypothesis.** For each questionable test, state what real, breakable behavior it claims to protect. If the honest answer is none / trivial / already covered / only implementation detail, it is a candidate.
3. **Prove it.** Read the test AND the code under test. Confirm or refute the hypothesis with cited evidence - the test code, what it does or does not assert, and (for Delete/Merge) the named test that covers the same behavior. A subtle invariant promotes a candidate back to Keep.
4. **Classify.** Assign each candidate one verdict + evidence + confidence (see Classification): Delete / Merge / Simplify / Keep.
5. **Safety check.** Run two confirmations on every Delete and Merge:
   - (a) **Only-coverage.** Confirm it does not drop the ONLY coverage of important behavior. If it would, downgrade to Keep-or-improve and record it as a tradeoff. This is the cross-check against the gaps direction.
   - (b) **Gate / mandate.** Confirm it does not break a coverage gate or a mandated test. If it would, note the conflict and do not recommend the removal.
6. **Aggregate.** Write one findings doc (use the template) and present it. Stay read-only until I approve which to remove.
7. **After approval, act** (see After approval). Never change source behavior to make a test removable.

## Classification

Assign each candidate exactly one verdict, with evidence and a High/Medium/Low confidence. Evidence is the test code and what it does or does not protect. Hold Delete (and any dismissal of value) to the highest bar - a weak Delete is how a real test gets waved away.

### Delete
The test protects nothing worth protecting, or its behavior is fully covered elsewhere - trivial, vacuous, tautological, pure implementation-detail, or coverage-gate filler.
- Evidence: the test code + which category it fails on; for "already covered," the NAMED covering test; for implementation-detail, the internal it pins and the safe refactor that would break it.
- Bar: highest. If you cannot name the covering test or prove the behavior trivial/implementation-only - and it is not the only coverage of a real path - do not Delete; downgrade.

### Merge
Two or more tests cover the same behavior; fold the duplicates into one rather than dropping coverage.
- Evidence: the overlapping tests and the single path they share; which one survives.
- Action: collapse the duplicate / overlapping unit + integration into one; preserve the union of real assertions.

### Simplify
The test protects real behavior but is over-parametrized or over-mocked; trim it rather than remove it.
- Evidence: the redundant cases or the mocking that hides the real integration; what the trimmed test should still assert.
- Action: collapse permutations to a representative set, or replace mocks with real inputs/fixtures. Behavior-preserving - in-place trimming is simplification-review's territory once approved.

### Keep
A questionable-looking test you verified DOES protect real, breakable behavior (or is the only coverage of an important path).
- Evidence: the invariant, flow, or past bug it guards.
- Recorded so it is not re-litigated next audit - the analogue of test-coverage-audit's "deliberately not testing."

## Required output before edits

One findings doc (use `assets/templates/test-pruning-audit-template.md`). Do not edit until I pick which to remove. It must contain:

- **Summary** - N tests/cases flagged: D delete / M merge / S simplify / K keep; estimated cases the suite would shed.
- **Setup detected** - framework, runner, conventions, fixture/mock patterns, any coverage gate or mandated test.
- **Per-test findings table** - test, location, what it claims to protect, verdict, confidence, evidence, and covered-elsewhere-by (for Delete/Merge).
- **Keep / verified-valuable** - questionable-looking tests confirmed to protect real behavior, recorded so they are not re-litigated.
- **Safety check** - does any Delete or Merge drop the only coverage of important behavior, or break a coverage gate? List every such tradeoff in the open, or state there are none.
- **Recommended removal sequence** - lowest-risk, self-contained removals first; risky or coverage-dropping ones last, gated.
- **Approval request** - ask which to remove.

## After approval

Once I say which to remove:

- Delete / merge / trim only the approved tests, in the suite's existing style. Never change source behavior to make a test removable.
- **Re-running the affected suite to green is mandatory before you report done.** A pruning pass that removed tests but never re-ran the suite is unverified - it is the load-bearing gate for this destructive direction. Report what passed and failed. If you cannot run it, give the exact command and say so explicitly.
- If a removal turns the suite red because the test was load-bearing, stop and report - the verdict was wrong, not the source. Do not change source to make the suite go green again.
- For many removals, hand to phased-implementation: one group at a time, re-run between groups, gate for go-ahead, with the findings doc as the living source of truth.
- After removing, summarize: tests deleted / merged / trimmed, cases shed, suite re-run result, and any Keep tradeoffs left in place so the audit can be closed out.

Claim only what you pruned. Do not call the surviving suite well-shaped beyond the tests you audited.

## Notes

- This produces a findings doc first; wait for approval before removing anything. Approve with phrases like "delete the D's", "do the merges only", "remove findings 2, 5, 7", "trim the over-mocked ones", "re-justify that Keep", or "hand it to phased-implementation".
- Siblings: test-coverage-audit is the inverse - it finds the few MAJOR tests that are MISSING and what is deliberately not worth testing; defer all missing-coverage / test-gap / "what should we test" / write-tests work there. simplification-review owns behavior-preserving in-place test trims (a Simplify borrows its mechanics), but the value call that a test should not exist is only this skill's. verify-review-findings supplies the evidence-before-verdict discipline applied here to hold Delete to the highest bar. mega-review is the multi-lens orchestrator; its test-gaps lens delegates to test-coverage-audit, and a pruning pass is not one of its default lenses. phased-implementation is the after-approval handoff for many removals.
- references/usage.md has first-turn variants (a whole suite, one test file/module, a diff's new tests, "our tests are too brittle", a pre-refactor prune, a post-merge bloat sweep) and follow-ups (approve a subset, hand to phased-implementation, re-justify a Keep).
- assets/templates/test-pruning-audit-template.md is the findings doc: summary, setup, per-test table, keep/verified, safety check, and removal sequence.