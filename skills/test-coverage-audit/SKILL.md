---
name: test-coverage-audit
description: "Audit test gaps and propose the few major tests that protect critical, breakable behavior. Detect the existing framework, reuse fixtures, and explain what is not worth testing. Use for coverage questions or an approved test plan; never chase a percentage, silently add tests, or change source behavior to make them pass."
---

# Test Coverage Audit

You find the few tests that are genuinely worth writing - the ones that protect important, breakable behavior - and you deliberately stop there. This is not an exhaustive-coverage pass. Most code does not need a dedicated test, and a short list of high-value tests beats a large suite that is expensive to maintain and mostly low signal.

Default to recommending few tests. If you are unsure whether something is worth a test, it probably is not. Coverage percentage is not a goal and is barely relevant here.

## Finding the scope

If a scope is provided - files, a module, a feature, or a diff - assess that. If nothing is provided, default to the current change set: the working-tree diff, or the branch diff against the base branch (e.g. `git diff`, `git diff main...HEAD`). Do not sweep the whole repo; if the scope is unclear, ask or pick the most important module.

Read adjacent code and existing tests to understand behavior, fixtures, and conventions. Stay within the scope.

## Detect the test setup

Before proposing anything, learn how this repo tests:

- Test framework and runner - the one already in package.json / pyproject / go.mod / the build files. Do not assume.
- Test file location and naming conventions, and how tests are organized.
- The fixture, factory, and mock patterns the suite already uses.
- Whether a coverage command exists - but treat its number as noise, not a target (see below).

Match everything you propose to what is already here. Do not introduce a new test framework, assertion library, or mocking tool.

## What counts as worth testing

Recommend a test only when the behavior is both important and breakable. The bar is high. Worth testing:

- Core user-facing flows that would be costly or embarrassing if they broke.
- Logic with real consequences if wrong: data integrity, money, auth and permissions, persistence, anything destructive or irreversible.
- Complex, non-obvious logic where bugs are likely and reading is not enough - algorithms, parsing, calculations, state machines, tricky conditionals.
- Real past bugs worth a regression test - the ones that actually mattered, not every fix.
- The narrow set of error paths that protect data, money, or security - not every error branch.

A small piece of important logic outranks a large pile of trivial code.

## What to deliberately not test

Naming this is part of the job, and the list should be generous. Skip, and say briefly why:

- Trivial code: getters, simple data shaping, pass-throughs, config, plain wiring.
- Anything the types or compiler already guarantee.
- Glue that would mostly exercise the framework, the ORM, or your own mocks.
- Exhaustive edge cases, every branch, every boundary - keep only the few that matter.
- Low-risk display and formatting logic.
- Code that is unlikely to break, or cheap to fix if it does.

## Coverage tools

You are not measuring coverage, so the percentage does not matter. If a coverage command exists and runs safely, use it for one thing only: spotting whether an important flow is entirely unexercised. Ignore the number. If there is no coverage tooling, do not add any - reason from the code.

## Assertion quality

A major test that asserts nothing is not coverage. For every test you propose:

- It must assert the actual behavior and be able to fail for a real reason.
- It must not just restate the implementation or test the mocks.
- Prefer real inputs and the suite's existing fixtures over heavy mocking.

If an existing test on important behavior asserts little or is over-mocked, flag it - strengthening one weak test on critical logic is often worth more than adding a new one.

## Hard rules

- Add tests; do not change source behavior. If code must be refactored to be testable, propose it and hand it off - do not do it here.
- Keep the list short. Resist completeness. It is correct to conclude that only one or two tests are worth writing, or none.
- Use the repo's existing framework, fixtures, helpers, naming, and style. Do not add a new test dependency.
- Prefer deterministic, fast, isolated tests. No real network or external systems.
- If proposing or writing a test reveals an actual bug, report and verify it. Do not silently fix source; obtain scoped bug-fix approval or carry an existing approval that covers this behavior. Route security bugs to security-remediation; use the host's ordinary bug-fix workflow for other behavior changes. Simplification-review is only for behavior-preserving cleanup.

## Required output before edits

### Summary
- One or two lines: what was assessed, and the headline - usually a small number of tests worth adding, or that coverage is already adequate.

### Test setup detected
Framework, runner, test location/naming, and the fixture/mock patterns you will follow.

### Worth testing
The short list. For each:
1. Location (file/symbol) and the behavior to protect.
2. What breaks if it is wrong, and why that matters.
3. The specific test - inputs, the scenario, and what to assert.

### Deliberately not testing
The notable things you are leaving untested, each with a one-line reason. This shows the scoping is intentional, not an oversight.

### Optional
A few judgment-call tests worth it only if cheap or if you happen to care. Keep this short; it is fine to omit.

### Approval request
Ask which tests to write only if they are not already named in an approved plan. Carry that approval into implementation; do not add unapproved tests.

## After approval

Once I approve specific tests:

- Write only the approved tests, in the repo's existing style, with real assertions and the suite's fixtures.
- Run the new tests, and the affected suite, if possible; report what passed and failed. If you cannot run them, give the exact command.
- For more than a couple of tests, carry it out with the phased-implementation skill: a batch at a time, run it, gate between.
- If a new test fails because of a real bug rather than a test mistake, stop and report it - do not change source to make it pass without approval.
- After writing, summarize: tests added, what they protect, tests run and results, and anything deliberately left.

Claim only what you added. Do not call the scope well tested beyond the important tests you wrote.

## Notes

- This produces a short list and waits for approval before adding tests. Approve with phrases like "write them", "do the first two", "show the tests first", or "skip it, coverage is fine".
- The guiding rule is major, important tests only - not exhaustive coverage. Default to few; name what you are not testing.
- references/usage.md has first-turn variants by stack (JS/TS, Python, Go, mixed or unknown) and by scope (a diff, a module/feature), plus follow-ups (approve the list, hand off to phased-implementation, a bug surfaced while testing, strengthen a weak test on critical logic).
- This systematizes the "add a regression test" step the other skills mention. It produces the short test list; phased-implementation executes an approved plan. A newly exposed behavior bug needs scoped fix approval; security-remediation owns security work, and ordinary bug fixing owns other behavior corrections.
- For the inverse - pruning low-value tests that already exist rather than adding missing ones - use test-pruning-audit. This skill finds the few major tests worth adding; that one finds the excess tests worth deleting.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
