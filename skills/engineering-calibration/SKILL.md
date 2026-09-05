---
name: engineering-calibration
description: Right-size software designs and implementations. Use before implementing or when reviewing architectural, cross-cutting, stateful, or abstraction-heavy changes; when asked whether code is overengineered or oversimplified; or when auditing a repository for unnecessary complexity, missing structure, weak contracts, or misplaced responsibilities.
---

# Engineering Calibration

Choose the simplest design that completely satisfies the demonstrated requirements, invariants, failure modes, and repository conventions.

Do not optimize for the fewest lines. Do not optimize for maximum abstraction. Optimize for the lowest total cognitive and maintenance cost.

## Standing rule

The compact rule below applies to ordinary implementation work even when this full review workflow is not invoked.

<!-- always-on:start title="Engineering calibration" -->
Implement the simplest design that fully preserves the requirements, invariants, failure behavior, and existing repository boundaries.

Do not equate simplicity with fewer files or fewer lines. Do not introduce abstractions, configuration, indirection, or extension points without a present repository-backed need. When adding a meaningful abstraction, state what concrete variation or policy it captures.
<!-- always-on:end -->

## Review boundary

For a standalone calibration review, stay read-only: do not edit code, tests, plans, configuration, dependencies, or generated artifacts. Return the review and wait for implementation approval.

Inside an already authorized implementation, use calibration as a bounded design checkpoint. Record the decision and continue within the approved scope; loading this skill does not invalidate that approval. Stop for a new decision only if the checkpoint exposes a scope, risk, dependency, or behavior change that the approval does not cover. Test edits still require their own requested or approved scope.

Honor the requested scope. Do not turn a scoped review into a whole-repository audit.

## Modes

Determine the requested mode:

- `plan` - review a proposed implementation before substantial work begins. Compare the proposal with the live repository and identify missing behavior, unnecessary machinery, and justified complexity.
- `diff` - review completed changes against their stated intent, baseline behavior, and surrounding contracts.
- `audit` - inspect a named module, subsystem, or repository for accumulated structural complexity and missing structure.
- If unspecified, infer the narrowest mode that covers the request. Prefer `diff` when concrete changes exist, `plan` when a proposal exists without implementation, and `audit` only for an explicitly broader area.

State the selected mode, scope, and baseline before giving the verdict.

## Evidence first

Before judging complexity:

1. Read the relevant plan or diff, implementation, tests, repository instructions, and nearby documentation.
2. Trace callers, consumers, state ownership, data flow, side effects, and public or persistent contracts.
3. Identify existing repository primitives and conventions that constrain the design.
4. State the concrete requirements, invariants, failure modes, and compatibility needs.
5. Separate observed present needs from hypothetical future flexibility.

Do not recommend architectural changes from filenames, isolated snippets, file size, line count, or generic best practices alone. When evidence is missing, mark the point unverified instead of turning it into a finding.

## Calibration test

For every meaningful design element, ask:

1. What present requirement does this serve?
2. What failure or invalid state does it prevent?
3. Why does this responsibility belong at this boundary?
4. What becomes materially harder if this element is removed?
5. Is an existing repository primitive already sufficient?
6. Is the complexity inherent to the domain or introduced by the design?

Do not assume that unusual code is wrong. Preserve complexity whose cost is lower than the invalid states, coupling, or repeated policy it prevents.

## Flag underengineering

Look for:

- important concepts collapsed into unrelated primitives;
- responsibilities combined despite changing independently;
- implicit state transitions or invalid representable states;
- missing validation, cancellation, concurrency, or failure behavior;
- business rules scattered through UI or transport code;
- APIs that expose implementation details;
- duplicated policy likely to drift;
- a small patch that violates established system boundaries;
- tests that prove only the happy path;
- complexity hidden rather than eliminated.

## Flag overengineering

Look for:

- abstractions with only one genuine implementation or consumer;
- interfaces that merely repeat an implementation;
- configuration for values that are not meaningfully variable;
- factories, registries, adapters, or event systems without demonstrated need;
- generic types whose flexibility is unused;
- wrappers that add vocabulary but no policy;
- excessive file fragmentation;
- dependency injection where direct construction is clearer;
- speculative extension points;
- multiple representations of the same state;
- duplicated layers that perform equivalent validation or transformation;
- indirection justified only by future flexibility.

Duplication alone is not sufficient reason to abstract. Prefer a small amount of obvious duplication over the wrong shared abstraction.

## Evaluate alternatives

For each confirmed finding, compare:

- the current design;
- the smallest complete design;
- a more structured design when the smallest design would lose an important invariant.

Explain what each alternative buys and costs. It is valid to conclude that the current design is already the smallest complete design.

Do not recommend simplification that changes required behavior, weakens correctness or observability, removes a meaningful domain boundary, creates hidden coupling, moves complexity elsewhere, or makes evidence-backed likely changes harder.

## Finding standard

Include a finding only when the live evidence demonstrates a current cost or risk.

- `High` - threatens correctness, data integrity, public contracts, essential failure behavior, or creates a widespread structural blocker.
- `Medium` - creates recurring drift, coupling, invalid-state, or maintenance risk across a meaningful boundary.
- `Low` - adds localized cognitive or maintenance cost with a safe, contained correction.

Severity measures present consequence, not aesthetic dislike or implementation size.

## Output

### Verdict

Use exactly one:

- Underengineered
- Appropriately engineered
- Overengineered
- Mixed

### Evidence

List concrete paths, symbols, dependencies, contracts, and execution paths. Distinguish verified evidence from unresolved assumptions.

### Findings

For each finding include:

- severity;
- location;
- observed problem;
- why it matters now;
- comparison of the current, smallest complete, and more structured shapes when applicable;
- smallest safe correction;
- what should remain unchanged.

If there are no findings, say so directly rather than inventing work.

### Recommended shape

Describe the minimum architecture that preserves all current requirements, invariants, and failure behavior.

### Non-findings

Identify unusual-looking complexity that is justified and should not be removed. Include credible candidates that were investigated and rejected so they are not re-raised without new evidence.

## Relationship to sibling skills

- Use `simplification-review` when the primary goal becomes local, behavior-preserving cleanup within existing boundaries.
- Use `architecture-review` when the primary goal becomes redesigning subsystem boundaries, ownership, dependency direction, or runtime and data flow.
- Use `consolidation-audit` when the primary goal becomes finding and merging duplicated or drifting implementations across a codebase.
- Keep this skill focused on the neutral calibration verdict. Recommend the appropriate sibling as a separate follow-up instead of expanding the current review into its workflow.
