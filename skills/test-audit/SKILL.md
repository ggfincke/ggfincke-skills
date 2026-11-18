---
name: test-audit
description: "Right-size a test suite in one of two modes. Gaps mode finds the few major missing tests that protect critical, breakable behavior and names what is not worth testing; prune mode finds existing tests that are trivial, redundant, brittle, exhaustive, or over-mocked and proposes evidence-backed Delete, Merge, Simplify, or Keep verdicts. Use for coverage or test-gap questions, an approved test plan, or what tests to remove. Never chase a coverage percentage, silently add or delete tests, or change source behavior to make tests pass or go away."
---

# Test Audit

You right-size a test suite against one bar: a test earns its place only if it protects critical, breakable behavior with real consequences - data integrity, money, auth & permissions, security, complex non-obvious logic, a core user flow, or a hard-won bug regression. Coverage percentage is never the goal.

## Pick the mode

- **Gaps mode** - what tests are missing, is this change tested where it matters, write or run an approved test plan. Follow [gaps.md](references/gaps.md).
- **Prune mode** - what tests to remove, the suite is too slow or brittle, a diff added bloat. Follow [prune.md](references/prune.md).

Choose from the request and say which mode you are running. If it is unclear, ask. Run one mode per pass; if a gaps pass surfaces bloat or a prune pass surfaces a missing major test, note it as a follow-up for the other mode instead of drifting.

## Shared ground rules

- Detect the existing framework, runner, file conventions, fixtures, mocks, and any coverage gate before judging anything. Never introduce a new test framework or dependency.
- Read the code under test, not just the test names or shapes.
- Never change source behavior to make a test pass or to make a test removable. A real bug surfaced while reading is reported and verified, then routed to a scoped fix.
- Read-only until approved. Gaps mode lists tests before writing any; prune mode writes one findings doc and removes nothing until approval.
- Never drop the only coverage of an important path. Cross-check every prune against the gaps bar.

## After approval

Do only the approved additions or removals, in the suite's existing style, then run the affected suite and report results; after removals, a green re-run is mandatory before reporting done. For more than a couple of changes, hand off to phased-implementation one batch at a time.

## References

- [gaps.md](references/gaps.md) and [usage-gaps.md](references/usage-gaps.md): what is worth testing, what to deliberately skip, assertion quality, required output, and prompts.
- [prune.md](references/prune.md) and [usage-prune.md](references/usage-prune.md): what to flag, classification, the safety check, required output, and prompts.
- [the prune template](assets/templates/test-audit-prune-template.md): copy to a dated doc, normally `dev-docs/test-audit-prune-YYYY-MM-DD.md`; never edit the packaged template.

## Shared evidence and approval

Use [review-protocol.md](references/review-protocol.md) for evidence-based verification, the five action-group authorization dimensions, and handoffs. Keep this skill's specialized question, permitted references, and output requirements. The packaged protocol is neutral and self-contained.
