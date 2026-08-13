# Codebase Consolidation Audit ([Project Name])

**Last Updated:** [Date]
**Scope:** [Repo/path/branch/diff surface audited]
**Codebase Size:** [X source files / Y lines, with exclusions named]
**Mode:** [Read-only audit / implementation plan only]

## Executive Summary

- **Confirmed findings:** [Count] across [areas].
- **Highest-value consolidation targets:** [Short list of the most important groups].
- **Biggest risks:** [Short list of areas that need careful sequencing].
- **Clean areas checked:** [Boundary scans or suspected issues that were refuted].
- **Recommended next move:** [First action group or decision to make].

## Approach

- [Describe first area: e.g., traced bootstrap/initialization only enough to locate overlapping implementation paths]
- [Describe second area: e.g., walked the relevant interaction/request flow to compare equivalent behavior]
- [Describe third area: e.g., reviewed parallel service or UI implementations for duplication, drift, and ownership inconsistencies]
- [Describe cross-cutting hunts: dead exports, duplicate modules, constants/schema drift, dependency surface, test duplication]
- [Describe testing: checked the relevant test suite to align coverage gaps with the audited surfaces]
- [Describe verification discipline: every included claim was checked against live code; false positives are listed below]

## Relevant System Map

_Map only the files and flows needed to establish a consolidation claim. System decomposition, dependency direction, responsibility boundaries, and target architecture belong in a separate `architecture-review`._

### Entry Points and Shared Paths ([X] files)

- `[path/to/entrypoint.ts]` ([X] lines) - [Brief description of what it does]
- `[path/to/main.ts]` ([X] lines) - [Brief description of the relevant initialization or shared flow]
- `[path/to/other-core.ts]` ([X] lines) - [Brief description of the relevant context]

### Parallel Implementation Areas ([X]+ files)

- **[Equivalent behavior or helper family]**: [List the key paths and what each owns]
  - `path/file1.ts` ([X] lines) - [Description]
  - `path/file2.ts` ([X] lines) - [Description]
- **[Another overlap candidate]**: [List paths]

### Supporting Shared Surfaces ([X] files)

- `[path/to/shared-helper.ts]` - [Shared surface that confirms or refutes overlap]
- `[path/to/types-or-config.ts]` - [Relevant type, config, or test support]

---

## Finding Index

| ID | Area | Finding | Risk | Action Group |
| -- | ---- | ------- | ---- | ------------ |
| F1 | [Area] | [Short finding title] | [Low/Med/High] | [Group A] |
| F2 | [Area] | [Short finding title] | [Low/Med/High] | [Group B] |

---

## Findings and Consolidation Opportunities

### F1. [Finding Title: Describe the duplication, drift, or ownership inconsistency]

**Status:** Confirmed
**Risk:** [Low/Medium/High]
**Action Group:** [Group A/B/etc.]

**Issue:**

- [Bullet point describing specific problem discovered]
- [Bullet point with evidence or concrete examples]
- [Bullet point explaining the impact or consequence]

**Evidence:**

- `[path/to/file.ts]` - [line/function/module evidence]
- `[path/to/other.ts]` - [line/function/module evidence]
- [Command output or search pattern if relevant]

**Impact:**

- [Why this matters: drift, review cost, bug risk, performance, unclear ownership]

**Recommendation:**

- [Specific actionable recommendation to address this issue]
- [Non-goals or behavior to preserve]

**Validation Needed If Implemented:**

- [Focused tests/gates/commands]

### F2. [Finding Title: Another issue]

**Status:** Confirmed
**Risk:** [Low/Medium/High]
**Action Group:** [Group B]

**Issue:**

- [Problem description]
- [Specific examples]
- [Impact]

**Evidence:**

- `[path/to/file.ts]` - [line/function/module evidence]

**Recommendation:**

- [How to fix it]

**Validation Needed If Implemented:**

- [Focused tests/gates/commands]

### F3. [Finding Title: Continue pattern]

**Status:** Confirmed
**Risk:** [Low/Medium/High]
**Action Group:** [Group C]

**Issue:**

- [Details]

**Evidence:**

- [Details]

**Recommendation:**

- [Solution]

### F4. [Add as many findings as discovered]

**Issue:**

- [Details]

**Recommendation:** [Solution]

---

## Considered and Rejected

_Claims checked against the live code and discarded so they are not re-raised next audit._

- **[Rejected claim title]** - [why: false positive / intentional divergence / already resolved / status quo correct], with the evidence that settled it.
- **[Another rejected/stale claim]** - [reason + evidence].

---

## Integrated Action Groups

These groups are the implementation plan. Do not create a separate action-groups document unless explicitly requested.

### Quick Map

| Group | Theme | Findings | Risk | Suggested Order | Key Benefit |
| ----- | ----- | -------- | ---- | --------------- | ----------- |
| A | [Theme A] | F1, F2 | [Low/Med/High] | 1 | [Benefit] |
| B | [Theme B] | F3 | [Low/Med/High] | 2 | [Benefit] |
| C | [Theme C] | F4, F5 | [Low/Med/High] | 3 | [Benefit] |

### Group A: [Group Name and Theme]

**Theme:** [One-line description of what this group addresses]
**Findings:** [F1, F2]
**Risk:** [Low/Medium/High] - [why]
**Estimated Impact:** [Consistency gain / complexity reduction / risk reduction]

**Why Group Together**

- [Shared files, dependency chain, same refactor shape, or same decision point]

**Implementation Notes**

- [Action item]
- [Action item]
- [Behavior to preserve]

**Files Likely Affected**

- `path/to/file1.ts` - [change]
- `path/to/file2.ts` - [change]

**Validation**

- [Commands/tests/manual checks]

**Open Decisions**

- [Decision or "None"]

### Group B: [Group Name and Theme]

**Theme:** [Description]
**Findings:** [F3]
**Risk:** [Low/Medium/High] - [why]
**Estimated Impact:** [Impact]

**Why Group Together**

- [Explanation]

**Implementation Notes**

1. [First action]
2. [Second action]
3. [Third action]

**Files Likely Affected**

- `path/to/file.ts` - [change]

**Validation**

- [Commands/tests/manual checks]

### Group C: [Group Name and Theme]

**Theme:** [Description]
**Findings:** [F4, F5]
**Risk:** [Low/Medium/High] - [why]

**Why Group Together**

- [Explanation]

**Implementation Notes**

- [Action items]

**Files Likely Affected**

- [Files]

**Validation**

- [Commands/tests/manual checks]

---

## Recommended Implementation Sequence

This replaces the old separate commit-plan artifact. Include phases and gates, not staged `git add` commands, unless the user explicitly asks for commit commands.

### Phase 1: [Phase Name] ([Risk Level])

**Groups:** [List group letters]
**Why first:** [Justification]

1. **Group [X]** - [Group name]
2. **Group [Y]** - [Group name]

### Phase 2: [Phase Name] ([Risk Level])

**Groups:** [List group letters]
**Why second:** [Justification]

1. **Group [Z]** - [Group name]

### Phase 3+: [Continue as needed]

---

## Test Suite Analysis

### Coverage Status

**Test Infrastructure:** [Test framework/runner details]

| Category | Files | Test Status |
| -------- | ----- | ----------- |
| [Component Area 1] | [file1.ts, file2.ts] | [TESTED / PARTIAL / UNTESTED - with notes] |
| [Component Area 2] | [files] | [Status + notes] |
| [Component Area 3] | [files] | [Status + notes] |

### Key Testing Gaps

1. [Major testing gap #1: describe what's untested and why it matters]
2. [Major testing gap #2: describe missing coverage area]
3. [Major testing gap #3: continue for all significant gaps]

### Test Strategy by Action Group

- **Group A:** [Focused test/gate plan]
- **Group B:** [Focused test/gate plan]
- **Group C:** [Focused test/gate plan]

---

## Verification Performed

- [Command/read/trace performed]
- [Targeted duplication, drift, or ownership scan performed]
- [Tool output inspected]
- [Manual source trace completed]

## Not Run / Limitations

- [Commands not run and why]
- [Scope intentionally excluded]
- [Facts that may need re-verification before implementation]
