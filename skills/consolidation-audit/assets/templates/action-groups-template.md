# Consolidation Action Groups

**Purpose:** Organize findings from consolidation audit document(s) into logical implementation groups based on overlapping files, dependencies, and similar change patterns.

**Sources:**

- [Audit v1]: [X] findings ([Brief description of areas covered])
- [Audit v2]: [X] findings ([Brief description of areas covered])

**Strategy:** Group by file overlap and dependency chains. Each group can be tackled as a cohesive unit.

## Quick Reference

| Group                      | Focus Area                   | Findings                 | Key Benefit                                             |
| -------------------------- | ---------------------------- | ------------------------ | ------------------------------------------------------- |
| [A](#group-a-[group-name]) | [Brief description of focus] | [Audit]#[X], [Audit]#[Y] | [Expected outcome: e.g., ~X lines reduced, consistency] |
| [B](#group-b-[group-name]) | [Brief description]          | [Findings list]          | [Benefit]                                               |
| [C](#group-c-[group-name]) | [Brief description]          | [Findings list]          | [Benefit]                                               |
| [D](#group-d-[group-name]) | [Brief description]          | [Findings list]          | [Benefit]                                               |
| [E](#group-e-[group-name]) | [Brief description]          | [Findings list]          | [Benefit]                                               |
| [F](#group-f-[group-name]) | [Brief description]          | [Findings list]          | [Benefit]                                               |
| [Continue as needed]       |                              |                          |                                                         |

---

## Group A: [Group Name & Focus Area]

**Findings:** [audit]#[X], [audit]#[Y]
**Estimated Impact:** [e.g., ~X lines reduced, consistency gain, architectural clarity]
**Risk:** [Low/Medium/High] ([Brief justification: e.g., isolated changes, touches core systems])

### Why Group Together

[Explain the logical connection between findings in this group. Examples:]

- All findings touch the same set of files
- Changes follow identical refactoring patterns
- Dependencies require changes to be made together
- Same architectural concern addressed from different angles

### Findings in This Group

| Source     | #   | Finding                        | Files Affected                 |
| ---------- | --- | ------------------------------ | ------------------------------ |
| [Audit v1] | [X] | [Brief description of finding] | [file1.ts, file2.ts, file3.ts] |
| [Audit v2] | [Y] | [Brief description of finding] | [file2.ts, file4.ts]           |
| [Continue] | [Z] | [Description]                  | [Files]                        |

### Implementation Order

1. **[First step description]:**
   - [Specific action/change to make]
   - [Another action]
   - [Details about approach, patterns, or new abstractions]

2. **[Second step description]:**
   - [Actions]
   - [Can include code examples if helpful for complex patterns]

   ```typescript
   // Example of new pattern or interface if relevant
   interface Example {
     // ...
   }
   ```

3. **[Continue for all steps]**

### Files Modified

- `path/to/file1.ts` - [Brief description of changes]
- `path/to/file2.ts` - [Description]
- `path/to/file3.ts` - [Description]

### Files Created (if applicable)

- `path/to/newFile.ts` - [Purpose of new file]

### Files Deleted (if applicable)

- `path/to/obsoleteFile.ts` - [Why it's being removed]

---

## Group B: [Group Name & Focus Area]

**Findings:** [List findings]
**Estimated Impact:** [Impact description]
**Risk:** [Level] ([Justification])

### Why Group Together

[Explanation of grouping logic]

### Findings in This Group

| Source    | #   | Finding | Files Affected |
| --------- | --- | ------- | -------------- |
| [Entries] |     |         |                |

### Decision Required (if applicable)

[Use this section when findings require architectural decisions with multiple valid approaches]

**Option A: [Approach Name]**

1. [Step]
2. [Step]
3. [Pros/cons if relevant]

**Option B: [Alternative Approach]**

1. [Step]
2. [Step]
3. [Pros/cons if relevant]

**Recommendation:** [Which option and why, or "requires discussion"]

### Implementation Order

[Same structure as Group A]

### Files Affected

[List by category: Modified/Created/Deleted]

---

## Group C: [Continue pattern for remaining groups]

**Findings:** [List]
**Estimated Impact:** [Impact]
**Risk:** [Level] ([Justification])

### Why Group Together

[Explanation]

### Findings in This Group

[Table]

### Implementation Order

[Steps]

### Files Modified/Created/Deleted

[Lists]

---

## [Repeat Group Template for Groups D, E, F, etc.]

---

## Group [X]: Test Coverage

**Findings:** [Test-related findings]
**Estimated Impact:** Regression protection for all changes
**Risk:** Low (additive)

### Why Group Together

This is a cross-cutting concern. Every other group should include relevant test updates. [Explain specific test gaps identified in audit]

### Findings in This Group

| Source  | #   | Finding                    | Files Affected                |
| ------- | --- | -------------------------- | ----------------------------- |
| [Audit] | [X] | [Description of test gaps] | [Components lacking coverage] |

### Test Coverage by Group

**Group A ([Name]):**

- Test [specific behavior/scenario]
- Test [another scenario]

**Group B ([Name]):**

- Test [behaviors]
- Test [edge cases]

**[Continue for all groups]**

### Key Gaps to Address

1. [Major untested area #1]
2. [Major untested area #2]
3. [Continue...]

---

## Recommended Implementation Order

### Phase 1: [Phase Name] ([Risk Level])

**Groups:** [List group letters]
**Why first:** [Justification - e.g., Independent changes, low risk, enable cleaner code in later phases]

1. **Group [X]** - [Group Name]
2. **Group [Y]** - [Group Name]

### Phase 2: [Phase Name] ([Risk Level])

**Groups:** [List groups]
**Why second:** [Justification]

[Numbered groups]

### Phase 3: [Phase Name] ([Risk Level])

**Groups:** [List groups]
**Why third:** [Justification]

[Numbered groups]

### Phase 4+: [Continue as needed]

### Phase [N]: [Test Coverage] (Continuous)

**Groups:** [Test group]
**Why continuous:** Should be done alongside each group.

[Test group entry]

---

## Summary

| Group                     | Findings        | Impact            | Risk    | Order        |
| ------------------------- | --------------- | ----------------- | ------- | ------------ |
| [A]: [Name]               | [List findings] | [Impact estimate] | [Level] | [Sequence #] |
| [B]: [Name]               | [List findings] | [Impact estimate] | [Level] | [Sequence #] |
| [C]: [Name]               | [List findings] | [Impact estimate] | [Level] | [Sequence #] |
| [Continue for all groups] |                 |                   |         |              |

**Total Findings:** [X] ([breakdown by audit source])
**Unique Issues:** [X] ([note any overlap identified])
**Total Estimated Impact:** [Summary: lines reduced, consistency gains, architectural improvements]
