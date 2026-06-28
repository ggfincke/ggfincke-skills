# Test Pruning Audit ([Suite / Module])

**Last Updated:** [Date]
**Scope:** [Suite / test files / module / the new tests in a diff]
**Test Setup:** [Framework + runner, fixture/mock patterns, coverage gate if any]
**Mode:** [Read-only audit - no removals until approved]

## Summary

- **Flagged:** [N] tests/cases - [D] Delete / [M] Merge / [S] Simplify / [K] Keep.
- **Estimated shed:** ~[X] cases if all Delete/Merge are approved.
- **Most worth removing:** [The few highest-confidence, lowest-risk cuts, or "mostly healthy - only N candidates"].
- **Safety tradeoffs:** [None - every Delete has a named covering test / N removals drop the only coverage - see Safety check].
- **Recommended next move:** [First removal group or decision to make].

## Setup Detected

- **Framework / runner:** [name + how it runs]
- **Conventions:** [file location, naming, organization]
- **Fixtures / mocks:** [the patterns the suite uses]
- **Coverage gate / mandated tests:** [gate threshold or AGENTS.md/CLAUDE.md mandate, or "none"]

---

## Findings

_One row per candidate. Verdict is one of: Delete / Merge / Simplify / Keep. Every non-Keep row carries evidence; Delete & Merge name the covering test. Confidence is High / Med / Low - hold Delete to High._

| ID | Test / Case | Location | Claims to protect | Verdict | Conf | Evidence | Covered elsewhere by |
| -- | ----------- | -------- | ----------------- | ------- | ---- | -------- | -------------------- |
| T1 | `[test name]` | `[file:line]` | [behavior, or "nothing real"] | Delete | High | [category it fails + why it protects nothing] | `[covering test]` |
| T2 | `[test name]` | `[file:line]` | [behavior] | Merge | High | [the shared path; which survives] | `[survivor test]` |
| T3 | `[test name]` | `[file:line]` | [behavior] | Simplify | Med | [over-mocked / over-parametrized; what to keep asserting] | - |
| T4 | `[test name]` | `[file:line]` | [real invariant] | Keep | High | [what it guards] | - |

### Detail (for findings that need more than a row)

#### T1. [Finding title]

**Verdict:** Delete
**Location:** `[file:line]`
**Category:** [Trivial-coverage / Exhaustive / Tautological / Impl-detail / Redundant / Over-mocked / Vacuous / Coverage-filler]
**Hypothesis:** [This test protects nothing real / is already covered / is pure implementation detail].
**Evidence:** [The test code & what it asserts; the category it fails on; for "already covered," the named covering test & the path they share; what would NOT slip through if it were gone].
**Covered elsewhere by:** `[covering test, or N/A]`

#### T3. [Finding title]

**Verdict:** Simplify
**Location:** `[file:line]`
**Hypothesis:** [Protects real behavior but over-mocked / over-parametrized].
**Evidence:** [The redundant cases or the mocking that hides the real integration].
**Trim to:** [What the simplified test should still assert]. (In-place trim is simplification-review once approved.)

---

## Keep / Verified-Valuable

_Questionable-looking tests checked against the code and confirmed to protect real, breakable behavior. Recorded so they are not re-litigated next audit._

- **`[test]`** - guards [invariant / flow / critical path]; looks simple but protects [real consequence].
- **`[test]`** - regression pinned to [past bug]; keep.
- **`[test]`** - sole coverage of [important path]; imperfect but do not delete - flag to improve if anything.

---

## Safety Check

_Does any Delete or Merge drop the only coverage of important behavior, or break a coverage gate? List every tradeoff in the open, or state there are none._

| ID | Removal | Risk | What it would drop | Resolution |
| -- | ------- | ---- | ------------------ | ---------- |
| T7 | Delete `[test]` | High | Only coverage of `[path]` | Downgrade to Keep-or-improve; [what a stronger test should assert] |
| T8 | Merge `[test]` | Med | [Coverage gate at N%] | Note conflict; do not remove |

_If none: "No removal drops the only coverage of important behavior; no coverage gate is affected."_

---

## Recommended Removal Sequence

_Lowest-risk, self-contained removals first. Each group is approve-able on its own._

### Group 1: [Theme] (Low risk)

- Findings: [T1, T4]
- [Trivial-coverage / pure duplicates - covering tests verified; delete outright, re-run the affected file]

### Group 2: [Theme] (Med risk)

- Findings: [T2, T3]
- [Merges / simplifications that touch shared fixtures - preserve the union of real assertions; re-run after each]

### Group 3: [Theme] (Higher risk)

- Findings: [T8]
- [Touches a coverage gate or a shared path - confirm the gate first; gate for go-ahead, re-run the full suite]

---

## Approval Request

Pick which to remove. Nothing is deleted, merged, or trimmed until you approve. For many removals, hand the approved groups to phased-implementation.

## Verification Performed

- [Framework / runner detected; coverage gate checked]
- [Each flagged test read alongside the code under test]
- [Covering tests confirmed for every "already covered" claim]

## Not Run / Limitations

- [Tests not yet judged and why; scope intentionally excluded]
- [Anything needing the suite run before a removal is confirmed safe]
- [Keep tradeoffs left in place]