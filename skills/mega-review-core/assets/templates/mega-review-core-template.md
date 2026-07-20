# Mega Review Core ([Project Name])

**Last Updated:** [Date]
**Audit File:** `[path/to/this-doc.md]`
**Lifecycle Status:** Proposed / Approved / In Progress / Complete / Partially Complete
**Scope:** [Repo/path/branch/diff surface reviewed]
**Codebase Size:** [X source files / Y lines, with exclusions named]
**Lenses run:** [bug-hunt, simplification, consolidation, test-gaps, performance]
**Security:** Out of scope by design; use a separate security-remediation pass when needed.
**Mode:** Read-only review / implementation plan / implementation tracking
**Effort:** [Standard / Thorough / Exhaustive - agent count & model tiers used, caps honored]

## Executive Summary

- **Confirmed findings:** [Count] across [N] lenses.
- **Top issues to address first:** [The 1-5 highest severity-x-confidence findings].
- **Biggest risks:** [Areas that need careful sequencing].
- **Clean areas checked:** [Lenses/modules that came back clean or were refuted].
- **Recommended next move:** [First action group or decision to make].

## Approach

- [Lens tracks run and how they were fanned out]
- [Conventions and gates read first]
- [Cross-lens merge and dedupe method]
- [Verification discipline and limitations]

## Architecture Snapshot

- `[path/to/entrypoint]` ([X] lines) - [what it does]
- [Core service stacks, UI/presentation layer, utilities, config/types - key files + counts]

## Finding Index

_One row per root cause. Tag every lens that surfaced the finding._

| ID | Lens(es) | Finding / Recommendation | Severity / Priority | Confidence | Risk | Action Group | Status |
| -- | -------- | ------------------------ | ------------------- | ---------- | ---- | ------------ | ------ |
| F1 | bug-hunt | [Short title] | [Crit/High/Med/Low] | [H/M/L] | [Low/Med/High] | A | Proposed |
| F2 | consolidation, simplification | [Short title] | [..] | [..] | [..] | A | Proposed |
| F3 | performance | [Short title] | [..] | [..] | [..] | B | Proposed |
| F4 | test-gaps | [Behavior to protect] | [High/Med/Low priority] | [H/M/L] | [N/A or Low/Med/High] | B | Proposed |

## Findings

### Bug-hunt

#### F1. [Finding title]

**Status:** Confirmed
**Lens(es):** bug-hunt
**Severity / Confidence / Risk:** [Crit/High/Med/Low] / [H/M/L] / [Low/Med/High]
**Action Group:** [A]

**Issue:** [What is wrong, trigger/preconditions, and impact]
**Evidence:** `[path/to/file]` - [line/symbol; reproduction or trace]
**Recommendation:** [Minimal fix; behavior to preserve]
**Validation Needed If Implemented:** [Focused tests, gates, or manual checks]

### Simplification

#### F2. [Finding title]

**Status:** Confirmed
**Lens(es):** simplification, consolidation when applicable
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Action Group:** [A]

**Issue:** [Unnecessary complexity, local duplication, or efficiency problem]
**Behavior preservation:** [Outputs, side effects, API, and error behavior]
**Evidence:** [Live references and why the change is safe]
**Recommendation:** [Behavior-preserving simplification]
**Validation:** [Focused checks or comparison]
**Considered and rejected:** [Nearby candidates and why they were not recommended]

### Consolidation / Architecture

#### F[n]. [Finding title]

**Status:** Confirmed
**Lens(es):** consolidation / architecture
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Action Group:** [A]

**Issue:** [Duplication, drift, architectural mismatch, or missing abstraction]
**Evidence:** [Parallel implementations or boundaries, with proof of sameness or intentional divergence]
**Impact:** [Drift, maintenance cost, bug risk, or boundary confusion]
**Recommendation:** [Shared abstraction, deletion, relocation, or documented divergence]
**Validation:** [Tests, checks, and grep confirmations]
**Considered and rejected:** [Similar candidates checked and refuted]

### Performance

#### F[n]. [Finding title]

**Status:** Confirmed / Needs measurement
**Lens(es):** performance
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Action Group:** [B]

**Issue:** [The hot path, why it is hot, and the cost]
**Evidence:** [Trace, measurement, query plan, or static evidence]
**Recommendation:** [Fix; preserve outputs]
**Validation:** [How to confirm the win without changing behavior]

### Test gaps

#### F[n]. [Behavior to protect]

**Lens(es):** test-gaps
**Priority:** [High/Med/Low]
**Why it matters:** [Data integrity, money, complex logic, or other consequence]
**Test setup detected:** [Framework, runner, fixtures, and location]
**The test:** [Inputs, scenario, and exact assertion]
**Assertion quality check:** [Why it would catch a real regression]
**Action Group:** [B]

#### Deliberately Not Testing

- **[Area/behavior]** - [Why it is not worth testing: trivial, type-guaranteed, framework glue, low-risk display, or too exhaustive].

### Needs Measurement / Runtime Context

- **[Suspicion]** - [Static evidence, possible impact, and exact measurement needed before promotion].

## Considered and Rejected

- **[Rejected claim]** - [False positive, intentional divergence, already resolved, or not on a hot path, with evidence].

## What's Not Worth Doing

- **[Tempting change]** - [Why it is low-value, risky, or outside the five-lens scope].

## Integrated Action Groups

| Group | Theme | Findings | Lenses | Risk | Suggested Order | Status | Key Benefit |
| ----- | ----- | -------- | ------ | ---- | --------------- | ------ | ----------- |
| A | [Theme] | F1, F2 | bug-hunt, simplification | [..] | 1 | Proposed | [Benefit] |
| B | [Theme] | F3, F4 | performance, test-gaps | [..] | 2 | Proposed | [Benefit] |

### Group A: [Name and theme]

**Theme:** [One line]
**Findings:** [F1, F2]
**Status:** Proposed / Approved / In Progress / Done / Deferred
**Risk:** [Low/Med/High] - [Why]
**Why group together:** [Shared files, dependency chain, or change shape]
**Implementation notes:** [Actions and behavior to preserve]
**Files likely affected:** `[path]` - [Change]
**Validation:** [Commands, tests, or manual checks]
**Open decisions:** [Decision or "None"]
**Implementation result:** [Empty until implemented]
**Implemented validation:** [Empty until implemented]
**Deviations / deferrals:** [Empty until implemented]

### Group B+: [Continue as needed]

## Recommended Implementation Sequence

### Phase 1: [Name] ([Risk level])

**Groups:** [Letters] - **Why first:** [Justification]
**Status:** Proposed / Approved / In Progress / Done / Deferred
**Gate / validation:** [Commands, tests, or manual checks]
**Done when:** [Observable closeout condition]

### Phase 2+: [Continue as needed]

## Verification Performed

- [Command, manual check, or review step] - [Result and date]

## Not Run / Limitations

- [Commands not run and why; scope intentionally excluded]
- [Unresolved or unverifiable claims parked here rather than forced to a verdict]
- [Facts to re-verify before implementation, including measurements owed to Needs Measurement items]
