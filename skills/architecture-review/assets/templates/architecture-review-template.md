# Architecture Review: [Project or Scope]

**Last Updated:** [Date]
**Review Scope:** [Repository, branch, diff, package, module, or subsystem]
**Baseline:** [HEAD, branch/base, merge-base, or working-tree state]
**Mode:** Read-only review and implementation plan
**Compatibility Posture:** [Pre-1.0 clean contract / public compatibility required / migration allowed / unknown]
**Reviewed Surface:** [Source roots, file counts, line counts, and explicit exclusions]

## Executive Summary

- **Overall assessment:** [Short architectural judgment]
- **Confirmed findings:** [Count by risk and change class]
- **Strong boundaries worth preserving:** [Short list]
- **Highest-value changes:** [Short list]
- **Decision-gated changes:** [Public contract, persistent data, runtime, or deployment decisions]
- **Recommended first move:** [Action group or prerequisite decision]

## Scope, Questions & Constraints

### Questions This Review Answers

- [Question about subsystem decomposition or ownership]
- [Question about dependency direction or contracts]
- [Question about runtime/data flow]
- [Question about files, modules, packages, or directories]

### In Scope

- [Area]

### Out of Scope

- [Area and why]

### Constraints

- [Repository instruction, compatibility constraint, framework convention, deployment constraint, or explicit user direction]

### Evidence Sources

- [Repository instructions and architecture docs]
- [Source/config/package/runtime surfaces]
- [Dependency or graph tooling]
- [Tests and deployment/build config]
- [History, only when used]

## Architectural Intent

### Documented Intent

- [Claim with source]

### Inferred Intent

- [Inference with supporting evidence and confidence]

### Drift Between Intent & Implementation

- [Difference, or "No material drift found"]

## Current Architecture Snapshot

### System Context

[Describe users, external systems, deployable units, data stores, and trust/runtime boundaries.]

### Runtime Topology

| Runtime or Deployable Unit | Entry Point | Responsibilities | State/Data Owned | External Dependencies |
| --- | --- | --- | --- | --- |
| [Unit] | `[path]` | [Responsibilities] | [State/data] | [Dependencies] |

### Component & Ownership Map

| Component | Locations | Responsibility | Public Surface | Depends On | Dependents | State/Data Owner |
| --- | --- | --- | --- | --- | --- | --- |
| [Component] | `[path]` | [Responsibility] | [Entry points/contracts] | [Dependencies] | [Dependents] | [Owner] |

### Physical Layout

```text
[current repository tree, limited to architecturally meaningful paths]
```

### Representative Flows

#### Flow 1: [Request, command, event, UI action, or background job]

1. `[entry point]` - [Step]
2. `[boundary]` - [Step]
3. `[state/integration]` - [Step]

**Ownership observations:** [Where policy, orchestration, transformation, state, and side effects live]

#### Flow 2: [Name]

1. [Step]

### Dependency Rules Observed

- **Intended direction:** [Layer/package/component direction]
- **Actual exceptions:** [Edges with evidence]
- **Cycles:** [Confirmed cycles or "None found in reviewed surface"]
- **Dynamic/framework edges:** [Discovery, registries, string imports, generated wiring]

### Strong Boundaries to Preserve

- **[Boundary]** - [Why it is cohesive, stable, and appropriately owned]

## Finding Index

| ID | Area | Finding | Change Class | Risk | Confidence | Action Group |
| --- | --- | --- | --- | --- | --- | --- |
| AR-1 | [Area] | [Short title] | [Physical/Internal/Public/Data/Runtime] | [Low/Medium/High] | [Low/Medium/High] | [A] |

## Verified Findings

### AR-1. [Finding Title]

**Status:** Confirmed
**Area:** [Boundary / dependencies / runtime / data / package / module / physical layout]
**Change Class:** [Physical-only / internal contract / public contract / persistent data / runtime-deployment]
**Risk:** [Low/Medium/High] - [Reason]
**Confidence:** [Low/Medium/High]
**Action Group:** [A/B/etc.]

#### Current Structure

- [Current responsibility, location, ownership, and dependency shape]

#### Evidence

- `[path:line or symbol]` - [Evidence]
- `[dependency edge or runtime flow]` - [Evidence]
- [Config, test, graph, or history evidence when applicable]

#### Architectural Problem

- [Concrete mismatch or ambiguity]
- [Impact on change isolation, correctness, understanding, testing, operability, or evolution]

#### Recommendation

- [Proposed boundary and responsibility]
- [Smallest structural change that establishes it]

#### Target State

```text
[Before/after tree or dependency sketch when useful]
```

#### Migration & Stable Intermediate State

1. [First safe step]
2. [Intermediate state that builds and remains behaviorally coherent]
3. [Final boundary enforcement]

#### Contract, Data & Runtime Implications

- **Public contracts:** [None or exact changes]
- **Internal contracts:** [None or exact changes]
- **Persistent data:** [None or migration/ownership changes]
- **Runtime/deployment:** [None or exact changes]

#### Affected Surfaces

- **Code:** `[paths]`
- **Tests:** `[paths]`
- **Config/build/tooling:** `[paths]`
- **Docs:** `[paths]`

#### Validation If Implemented

- [Targeted tests, static checks, build/package gates, runtime smoke checks, migration rehearsal]

#### Non-Goals

- [Behavior, contract, or adjacent redesign explicitly excluded]

### AR-2. [Finding Title]

[Repeat the complete finding structure.]

## Considered & Rejected

_Record plausible reorganizations and redesigns checked against the live code but not recommended._

| Candidate | Verdict | Evidence | Why Rejected |
| --- | --- | --- | --- |
| [Split, merge, package extraction, layer, relocation, service boundary, etc.] | [False positive / intentional / premature / no material benefit] | `[paths or edges]` | [Reason] |

## Target Architecture

### Design Principles Derived From This Repository

- [Repo-specific principle tied to evidence]

### Target Component Boundaries

| Component | Owns | Public Surface | May Depend On | Must Not Depend On |
| --- | --- | --- | --- | --- |
| [Component] | [Responsibilities/state/data] | [Contracts/entry points] | [Allowed dependencies] | [Forbidden dependencies] |

### Target Runtime & Data Flow

1. [Flow step with policy/orchestration/state ownership]

### Target Physical Layout

```text
[proposed repository tree, limited to changed or boundary-defining paths]
```

### Dependency Rules to Enforce

- [Rule, enforcement mechanism, and exceptions]

### Architectural Decisions Required

| Decision | Options | Recommendation | Tradeoff | Needed Before |
| --- | --- | --- | --- | --- |
| [Decision] | [A/B] | [Choice] | [Tradeoff] | [Group] |

## Integrated Action Groups

These groups are the implementation plan. Keep them in this review unless the user requests another artifact.

### Quick Map

| Group | Boundary or Theme | Findings | Change Class | Risk | Prerequisites | Stable End State |
| --- | --- | --- | --- | --- | --- | --- |
| A | [Theme] | AR-1 | [Physical/Internal/etc.] | [Low/Medium/High] | [None/decision/group] | [Buildable coherent state] |

### Group A: [Name]

**Authorization:** [source concerns; generated outputs; named hand-written tests; existing verification commands; Git/external actions; approval source]

**Findings:** [AR-1, AR-2]
**Boundary Established:** [Responsibility/dependency rule]
**Change Class:** [Physical-only / internal contract / public contract / persistent data / runtime-deployment]
**Risk:** [Low/Medium/High] - [Reason]
**Prerequisites:** [Decisions or earlier groups]
**Stable End State:** [What is true and verifiable after this group]

#### Why Group These Changes

- [Shared boundary, dependency chain, file overlap, or migration constraint]

#### Implementation Steps

1. [Step]
2. [Step]

#### Move, Split & Contract Map

| Current | Target | Operation | Contract Impact |
| --- | --- | --- | --- |
| `[path/symbol]` | `[path/symbol]` | [Move/split/merge/invert/extract] | [None/internal/public/data/runtime] |

#### Validation Gate

- [Commands and manual/runtime checks]

#### Rollback or Recovery

- [How to recover if the group cannot reach its stable end state]

#### Open Decisions

- [Decision or "None"]

### Group B: [Name]

**Authorization:** [source concerns; generated outputs; named hand-written tests; existing verification commands; Git/external actions; approval source]

[Repeat the complete action-group structure.]

## Recommended Migration Sequence

### Phase 0: Decisions & Baseline

- [Resolve decisions, capture baseline, add no unapproved behavior]
- **Gate:** [Checks]

### Phase 1: Dependency Rules & Low-Risk Structure

- **Groups:** [A]
- **Why first:** [Reason]
- **Gate:** [Checks]

### Phase 2: Internal Boundaries

- **Groups:** [B]
- **Gate:** [Checks]

### Phase 3: Public, Data, Runtime or Deployment Changes

- **Groups:** [C]
- **Decision required:** [Explicit approval]
- **Gate:** [Compatibility, migration, deployment, and rollback proof]

## Test & Verification Strategy

### Existing Protection

- [Tests/gates mapped to boundaries and flows]

### Major Gaps Relevant to This Migration

- [Only important behavior needed to make a proposed group safe]

### Per-Group Expectations

| Group | Static/Build | Targeted Behavior | Integration/Runtime | Migration/Compatibility |
| --- | --- | --- | --- | --- |
| A | [Checks] | [Tests] | [Smoke] | [Proof or N/A] |

## Verification Log

### Performed

- `[command or inspection]` - [Result and what it proved]

### Not Run or Unavailable

- `[gate/tool]` - [Reason and resulting uncertainty]

### Evidence Limitations

- [Missing history, unavailable runtime, generated code not present, incomplete docs, etc.]

## Implementation Ledger

Update this table only after the user approves implementation. Keep review findings and shipped state synchronized.

| Group | Status | Date | Changes | Verification | Decisions/Deviations |
| --- | --- | --- | --- | --- | --- |
| A | Proposed | - | - | - | - |

## Approval Checklist

- [ ] Approve/reject prerequisite architecture decisions.
- [ ] Approve specific action groups for phased implementation.
- [ ] Confirm compatibility and migration posture for public/data/runtime changes.
- [ ] Confirm any major tests needed before implementation.
