# Mega Review ([Project Name])

**Last Updated:** [Date]
**Audit File:** `[path/to/this-doc.md]`
**Lifecycle Status:** Proposed / Approved / In Progress / Complete / Partially Complete
**Scope:** [Repo/path/branch/diff surface reviewed]
**Codebase Size:** [X source files / Y lines, with exclusions named]
**Lenses run:** [bug-hunt, simplification, consolidation, security, test-gaps, performance - note any scoped out and why]
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
- [Conventions/gates read first: AGENTS.md / CLAUDE.md / README; pre-1.0 stance]
- [Cross-lens merge: how duplicates were collapsed, how findings were verified]
- [Verification discipline: every included claim checked against live code; refuted claims below]

## Codebase Snapshot

_Brief - enough to ground the findings. Lean on consolidation-audit's fuller map only if the consolidation lens needed it._

- `[path/to/entrypoint]` ([X] lines) - [what it does]
- [Core service stacks, UI/presentation layer, utilities, config/types - key files + counts]

---

## Finding Index

_One row per root cause. The Lens column lists every lens it surfaced under (dedupe across lenses). For test gaps, use priority/importance rather than defect severity when severity is not meaningful._

| ID | Lens(es) | Finding / Recommendation | Severity / Priority | Confidence | Risk | Action Group | Status |
| -- | -------- | ------------------------ | ------------------- | ---------- | ---- | ------------ | ------ |
| F1 | bug-hunt | [Short title] | [Crit/High/Med/Low] | [H/M/L] | [Low/Med/High] | A | Proposed |
| F2 | consolidation, simplification | [Short title] | [..] | [..] | [..] | A | Proposed |
| F3 | security | [Short title] | [..] | [..] | [..] | B | Proposed |
| F4 | performance | [Short title] | [..] | [..] | [..] | C | Proposed |
| F5 | test-gaps | [Behavior to protect] | [High/Med/Low priority] | [H/M/L] | [N/A or Low/Med/High] | C | Proposed |

---

## Findings

_Grouped by lens for readability; cross-lens findings appear once, under their primary lens, with all lenses tagged._

### Bug-hunt

#### F1. [Finding title]

**Status:** Confirmed
**Lens(es):** bug-hunt
**Severity / Confidence / Risk:** [Crit/High/Med/Low] / [H/M/L] / [Low/Med/High]
**Action Group:** [A]

**Issue:**
- [What is wrong]
- [The trigger / preconditions]
- [Impact if it fires]

**Evidence:**
- `[path/to/file]` - [line/symbol; the reproduction or trace]

**Recommendation:**
- [Minimal fix; behavior to preserve]

**Validation Needed If Implemented:**
- [Focused tests/gates/commands]

### Simplification

#### F2. [Finding title]

**Status:** Confirmed
**Lens(es):** consolidation, simplification
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Action Group:** [A]

**Issue:** [what is unnecessarily complex, duplicated locally, inefficient, or harder to understand than needed]
**Behavior preservation:** [outputs / side effects / API / error behavior that must stay unchanged]
**Evidence:** [live references showing duplication, dead code, confusing control flow, or hot-path efficiency issue]
**Recommendation:** [behavior-preserving simplification; no public API or data-shape changes unless explicitly approved]
**Validation:** [focused tests/checks/manual comparison needed]
**Considered and rejected:** [nearby simplifications checked but not recommended, with reason]

### Consolidation

#### F[n]. [Finding title]

**Status:** Confirmed
**Lens(es):** consolidation
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Action Group:** [A]

**Issue:** [duplication, drift, or missing abstraction]
**Evidence:** [parallel implementations/files/symbols; why they are behavior-identical or intentionally divergent]
**Impact:** [drift risk, maintenance cost, boundary confusion, bug risk, performance impact]
**Recommendation:** [shared abstraction, deletion, relocation, or documented divergence]
**Validation:** [tests/checks/grep confirmations needed]
**Considered and rejected:** [similar candidates checked and refuted]

### Security

#### F3. [Finding title]

**Status:** Confirmed
**Lens(es):** security
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Vulnerability class:** [OWASP/CWE when useful]
**Action Group:** [B]

**Evidence:** [attacker-controlled source -> trust boundary -> propagation -> dangerous sink or missing enforcement point]
**Current guard:** [what exists today and why it is insufficient]
**Impact:** [who can exploit, what they gain, preconditions]
**Recommendation:** [minimal fix; alternative if invasive; existing primitive to use]
**Regression tests:** [malicious case that must fail safe; legitimate case that must still work]
**Residual risk after fix:** [remaining exposure or "None expected"]

### Performance

#### F4. [Finding title]

**Status:** Confirmed
**Lens(es):** performance
**Severity / Confidence / Risk:** [..] / [..] / [..]
**Action Group:** [C]

**Issue:** [the hot path; why it is hot; the cost]
**Evidence:** [trace/measurement/query plan; confirmation it is on a real hot path]
**Recommendation:** [the fix; outputs must be preserved]
**Validation:** [how to confirm the win without changing behavior]

#### Needs Measurement / Runtime Context

- **[Suspicion]** - [static evidence], [why it may matter], [exact measurement/profile/runtime context needed before promoting to a confirmed finding].

### Test gaps

#### F5. [Behavior to protect]

**Lens(es):** test-gaps
**Priority:** [High/Med/Low - importance of the behavior, not defect severity]
**Why it matters:** [what breaks if wrong - data integrity / money / auth / complex logic]
**Test setup detected:** [framework/runner/location/fixtures relevant to this test]
**The test:** [inputs, scenario, and exact assertion]
**Assertion quality check:** [why this would fail for a real regression rather than just testing mocks]
**Action Group:** [C]

#### Deliberately Not Testing

- **[Area/behavior]** - [why it is not worth testing: trivial, type-guaranteed, framework glue, low-risk display, too exhaustive].

---

## Considered and Rejected

_Claims checked against live code and discarded, so they are not re-raised next pass._

- **[Rejected claim]** - [false positive / intentional divergence / already resolved / not on a hot path / unreachable], with the evidence that settled it.
- **[Stale/refuted claim]** - [reason + evidence].

## What's Not Worth Doing

_Tempting changes deliberately not recommended (e.g. splitting a large-but-cohesive file, over-abstracting a 2-site pattern, testing trivial glue)._

- [Item] - [why it is the wrong call here]

---

## Integrated Action Groups

These groups are the implementation plan. Do not create a separate action-groups document unless asked.

### Quick Map

| Group | Theme | Findings | Lenses | Risk | Suggested Order | Status | Key Benefit |
| ----- | ----- | -------- | ------ | ---- | --------------- | ------ | ----------- |
| A | [Theme] | F1, F2 | bug-hunt, simplification | [..] | 1 | Proposed | [Benefit] |
| B | [Theme] | F3 | security | [..] | 2 | Proposed | [Benefit] |
| C | [Theme] | F4, F5 | perf, test-gaps | [..] | 3 | Proposed | [Benefit] |

### Group A: [Name and theme]

**Theme:** [One line]
**Findings:** [F1, F2]
**Status:** Proposed / Approved / In Progress / Done / Deferred
**Risk:** [Low/Med/High] - [why]
**Why group together:** [shared files / dependency chain / same change shape]
**Implementation notes:** [actions; behavior to preserve]
**Files likely affected:** `[path]` - [change]
**Validation:** [commands/tests/manual checks]
**Open decisions:** [decision or "None"]
**Implementation result:** [empty until implemented; summary of actual change]
**Implemented validation:** [empty until implemented; commands/tests run and outcome]
**Deviations / deferrals:** [empty until implemented; anything that changed from the plan and why]

### Group B / C: [continue]

---

## Recommended Implementation Sequence

Phases and gates, not staged `git add` commands, unless commit commands are explicitly requested.

### Phase 1: [Name] ([Risk level])
**Groups:** [letters] - **Why first:** [justification]
**Status:** Proposed / Approved / In Progress / Done / Deferred
**Gate / validation:** [commands, tests, or manual checks required before moving on]
**Done when:** [observable condition that closes the phase]

### Phase 2+: [continue]

---

## Test Suite Analysis

**Test infrastructure:** [framework/runner detected]

| Area | Files | Status |
| ---- | ----- | ------ |
| [Area 1] | [files] | [TESTED / PARTIAL / UNTESTED + note] |

**Key gaps (major only):** [the few that matter - from the test-gaps lens]
**Test strategy by action group:** [Group A: ...; Group B: ...]

---

## Verification Performed

- [Commands/reads/traces run; refute panels; gates executed]

## Implementation Log

_Update this section only after approved action groups are implemented._

| Date | Group(s) | Status Change | Files Changed | Validation | Deviations / Deferrals |
| ---- | -------- | ------------- | ------------- | ---------- | ---------------------- |
| [Date] | [A] | [Proposed -> Done] | [paths] | [commands + result] | [None / details] |

## Not Run / Limitations

- [Commands not run and why; scope intentionally excluded; facts to re-verify before implementation]
- [Runtime/profile/production-like data unavailable; measurements needed before promoting any "Needs Measurement" performance items]
