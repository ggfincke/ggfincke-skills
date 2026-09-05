# Test Coverage Audit - Usage

Ready-made prompts for the `test-coverage-audit` skill. The skill's rule is major, important tests only - not exhaustive coverage - so these prompts ask for a short, high-value list. The first-turn variants name the stack or scope; the follow-ups steer the work after the list. Fill in the `[BRACKETED]` parts.

## First-turn variants by stack

Naming the stack helps the skill find the framework and conventions faster.

### A. JavaScript / TypeScript (Jest / Vitest)

```
Look at [SCOPE] in this [JEST / VITEST] project and tell me the few tests actually worth
writing - the ones protecting important, breakable behavior. Skip trivial code and edge-case
exhaustiveness, and say what you are deliberately not testing. Use the existing setup and
fixtures. Give me the short list before writing anything.
```

### B. Python (pytest / unittest)

```
For [SCOPE] in this [PYTEST / UNITTEST] project, what are the major tests worth adding? Focus
on logic with real consequences and complex non-obvious code; ignore trivial paths. Follow the
existing fixtures. Short list first - no edits yet.
```

### C. Go

```
For [SCOPE] in this Go module, give me the handful of tests that matter - core behavior and
risky logic, not every branch. Standard testing package, existing style. List them before any
_test.go changes.
```

### D. Mixed or unknown stack

```
Detect the test framework and conventions for [SCOPE], then tell me the few important tests
worth adding and what you would deliberately skip. Do not chase coverage. Plan before editing.
```

## First-turn variants by scope

### E. Is this change tested where it matters?

```
Look at my current diff and tell me whether the parts that matter are tested. I do not want
exhaustive coverage - just the important tests this change should have. Name what is fine to
leave untested. Plan first, no edits.
```

### F. A module or feature

```
What are the major tests missing for [MODULE / FEATURE]? Map the core flows and the logic with
real consequences, give me a short list worth writing, and say what is not worth testing. Wait
for approval before writing.
```

## Follow-up prompts after the list

### Approve the list

```
Write [all of them / the first N]. Use the existing fixtures and style, give each a real
assertion that can fail, and run them. Do not touch source. Summarize what they protect and
anything that failed.
```

### Hand off to phased-implementation

```
That is more than a couple of tests - carry it out with phased-implementation: a batch at a
time, run them after each, and stop for go-ahead between batches.
```

### A bug surfaced while testing

```
That failing test looks like a real bug, not a test mistake. Stop on it - do not change source
to make it pass. Verify and report it, then request a scoped bug fix (security-remediation for security bugs; the host's ordinary bug-fix workflow otherwise). Use simplification-review only for behavior-preserving cleanup.
```

### Strengthen a weak test on critical logic

```
For the existing test you flagged on [CRITICAL BEHAVIOR] that asserts little or is over-mocked,
propose a stronger version that asserts the real behavior with real inputs. Just that one - keep
it consistent with the suite.
```
