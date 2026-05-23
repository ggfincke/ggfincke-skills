# Codebase Consolidation Audit ([Project Name])

**Last Updated:** [Date]
**Codebase Size:** [X source files in src/]

## Approach

- [Describe first area: e.g., traced bootstrap/initialization to understand how system components wire together]
- [Describe second area: e.g., walked main interaction/request flow to follow data flow, permissions, routing, and historical patterns]
- [Describe third area: e.g., reviewed core service stacks for duplication & drift]
- [Describe fourth area: e.g., mapped UI/presentation layer for repeated patterns & execution flows]
- [Describe testing: checked test suite to align coverage gaps with the above systems]

## Current Architecture Snapshot

### Core Components ([X] files)

- `[path/to/entrypoint.ts]` ([X] lines) - [Brief description of what it does]
- `[path/to/main.ts]` ([X] lines) - [Brief description: initialization, dependency wiring, etc.]
- `[path/to/other-core.ts]` ([X] lines) - [Brief description]

### Services & [Domain Area] ([X]+ files)

- **[Service Category 1]**: [List key files with line counts and brief descriptions]
  - `path/file1.ts` ([X] lines) - [Description]
  - `path/file2.ts` ([X] lines) - [Description]
- **[Service Category 2]**: [List files]
- **[Service Category 3]**: [List files]

### [Another Major Component Area] ([X] files)

- [List and describe key files in this area]
- [Group related functionality]

### [UI/Presentation/API Layer] ([X]+ files)

- [Describe organization of presentation layer]
- [List key directories and file counts]

### [Utilities/Helpers] ([X]+ files)

- **[Category 1]**: [List utility files]
- **[Category 2]**: [List utility files]
- **[Category 3]**: [List utility files]

### [Configuration & Types] ([X] files)

- [List configuration and type definition files]

---

## Findings & Consolidation Opportunities

### 1) [Finding Title: Describe the architectural mismatch or duplication]

**Issue:**

- [Bullet point describing specific problem discovered]
- [Bullet point with evidence or concrete examples]
- [Bullet point explaining the impact or consequence]

**Recommendation:** [Specific actionable recommendation to address this issue]

### 2) [Finding Title: Another issue]

**Issue:**

- [Problem description]
- [Specific examples]
- [Impact]

**Recommendation:** [How to fix it]

### 3) [Finding Title: Continue pattern]

**Issue:**

- [Details]

**Recommendation:** [Solution]

### 4) [Add as many findings as discovered]

**Issue:**

- [Details]

**Recommendation:** [Solution]

---

## Master Consolidation Action Groups

_(Current audit + prior carryovers)_

### 0. Quick Map (What's in Each Group)

| Group | Theme                                          | Carryovers     | New findings ([Date])          |
| ----- | ---------------------------------------------- | -------------- | ------------------------------ |
| A     | [Theme A: e.g., Services & runtime]            | [Prior issues] | [New findings from this audit] |
| B     | [Theme B: e.g., Configuration & architecture]  | [Prior issues] | [New findings]                 |
| C     | [Theme C: e.g., UI & interaction patterns]     | [Prior issues] | [New findings]                 |
| D     | [Theme D: e.g., Parsing & validation]          | [Prior issues] | [New findings]                 |
| E     | [Theme E: e.g., Error handling & presentation] | [Prior issues] | [New findings]                 |
| F     | [Theme F: e.g., Observability & tests]         | [Prior issues] | [New findings]                 |
| G     | [Theme G: e.g., Command handlers & utilities]  | [Prior issues] | [New findings]                 |

Below is the per-group view: what remains, what changed, and how to proceed.

---

### Group A – [Group Name & Theme]

**Theme:** [One-line description of what this group addresses]

**From [previous audit name]**

- [Issue/finding from prior audit that belongs in this group]
- [Another prior issue]

**From [current audit name]**

- [New finding from current audit (reference F# from above)]
- [Another new finding]

**Net plan (delta)**

- [Consolidated action item combining old + new issues]
- [Another action item]
- [Clear implementation steps]

---

### Group B – [Group Name & Theme]

**Theme:** [Description]

**From [previous audit]**

- [Prior issues]

**From [current audit]**

- [New findings]

**Net plan (delta)**

1. [Numbered action items work well for complex plans]
2. [Second action]
3. [Third action]

---

### Group C – [Group Name & Theme]

**Theme:** [Description]

**From [previous audit]**

- [Prior issues]

**From [current audit]**

- [New findings]

**Net plan (delta)**

- [Action items]
- [Can use bullets or numbers]

---

### Group D – [Continue pattern for remaining groups]

**Theme:** [Description]

**From [previous audit]**

- [Issues]

**From [current audit]**

- [Findings]

**Net plan (delta)**

- [Actions]

---

### [Repeat for Groups E, F, G, etc.]

---

## Test Suite Analysis

### Coverage Status

**Test Infrastructure:** [Test framework/runner details]

| Category           | Files                | Test Status                                |
| ------------------ | -------------------- | ------------------------------------------ |
| [Component Area 1] | [file1.ts, file2.ts] | [TESTED / PARTIAL / UNTESTED - with notes] |
| [Component Area 2] | [files]              | [Status + notes]                           |
| [Component Area 3] | [files]              | [Status + notes]                           |
| [Component Area 4] | [files]              | [Status + notes]                           |
| [Component Area 5] | [files]              | [Status + notes]                           |
| [etc.]             | [etc.]               | [etc.]                                     |

### Key Testing Gaps

1. [Major testing gap #1: describe what's untested and why it matters]
2. [Major testing gap #2: describe missing coverage area]
3. [Major testing gap #3: continue for all significant gaps]
