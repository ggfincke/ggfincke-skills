<!-- Generated from verify-review-findings/references/review-protocol.md; edit that source. -->
# Shared review protocol

Use this neutral protocol for evidence, action-group authorization, and handoffs. The calling skill owns the review question, permitted lenses, specialized evidence, and output shape. Load only references within the selected workflow's scope.

## Evidence

Establish the inspected revision, working-tree changes, and relevant runtime or configuration facts. Trace the live implementation or reproduce the behavior before treating a claim as confirmed. Record the trigger, consequence, evidence, confidence, and material limitations.

Try to refute each candidate with a concrete guard, caller invariant, type contract, or reproduction. Reject it only when that counter-evidence is established. A missing reproduction without a proven refutation remains unverified. A vote or several correlated opinions cannot outweigh concrete evidence in either direction.

Distinguish confirmed, stale, incorrect, speculative, and unverifiable claims when triaging supplied findings. A dismissal needs strong counter-evidence; preserve uncertainty instead of using a weak dismissal to close the item. Deduplicate findings by root cause and affected behavior, retaining their evidence and provenance.

## Action-group authorization

For each group, record the approval source and the following five dimensions. Use `not included` for excluded changes; do not infer an omitted permission from another column.

| Dimension | Record |
| --- | --- |
| Source edits | Approved concerns, behavior, and owned files or boundaries |
| Generated outputs | Named generators and outputs that follow the approved change |
| Hand-written tests | The specific major tests requested or included in the approved plan |
| Existing verification | Commands to run and required acceptance evidence |
| Git and external actions | Exact authorized commit, rewrite, publication, deployment, or other external scope |

Generated contract fixtures follow an approved contract-shape change through their owning generator. Hand-written tests retain their requested or plan-approved scope. Running existing checks does not authorize changing tests or changing source to make a test pass.

Approval of a complete plan covers its listed groups, generated outputs, and named tests. Carry that approval across phases, sessions, and models. Ask for a new decision only for missing authorization, changed scope or consequences, or a user-requested checkpoint. An audit by itself does not authorize implementation.

## Handoff and closeout

Keep one living report or implementation ledger with stable finding and group IDs. Carry the inspected baseline, commands/results, limitations, approved dimensions, and completion evidence into the next stage. Recheck changed or unsupported evidence and consequential assumptions; reuse evidence that still applies.

Keep unrelated staged, unstaged, untracked, and ignored work intact. Reconcile concurrent changes before overwriting or regrouping anything. Report what was changed, what was verified, and what remains unresolved. Reconcile report counts and statuses with the final evidence without inventing new findings or silently expanding approved work.

## Standalone execution

A referenced sibling skill is an optional specialization, not an installation dependency. Use only specializations permitted by the selected workflow. When a sibling is unavailable, apply this packaged protocol and the calling workflow's local references; name any resulting limitation. Do not load another review profile to fill a gap.

For a multi-lens workflow that explicitly selects these questions, the following baseline is sufficient without sibling packages:

- Simplification: trace current behavior and callers, seek removable indirection or redundant state/work, and preserve public contracts, ordering, errors, side effects, and repository boundaries. Reject cosmetic line-count reductions that weaken clarity or invariants.
- Consolidation: map parallel owners, compare concrete behavior and dependencies, identify verified duplication or drift, and group compatible changes by root cause. Record rejected apparent duplicates and the behavioral difference that requires them.
- Test gaps: inventory existing coverage and fixtures, trace important breakable behavior, identify sole or missing protection, and propose only the few major tests whose failure consequences justify maintenance. State what is deliberately not worth testing; author only named approved tests.

After implementation approval, process each approved group, run its existing gates, update the same ledger, and continue through the remaining approved groups. If the maintained phased implementation skill is present, it may supply additional execution detail. Its absence does not invalidate the approval contract or require installation of another package.
