# Review chain

How the review family composes across sessions into one loop: Audit -> Approve -> Implement -> Re-verify -> Reconcile. Each skill owns one stage; this doc is the hand-off contract between them - which skill produces what, what the next one consumes, and how one audit doc stays the single source of truth across sessions (and sometimes across models). It lives as a workflow, not an auto-firing skill, because no single trigger fires the whole loop and the loop runs across many sittings - you consult it to know what stage you're in and what the next one expects.

The spine: every stage reads from and writes to the SAME audit document - not a fresh report per session. Don't spawn parallel `action-groups.md` / `commit-plan.md` files; the skills keep it in the one doc. Findings land grouped w/ risk sequencing; preserve the group IDs across stages so a phase maps back to a finding.

## The loop

### 1. Audit - pick the lens, produce one read-only doc

Choose by how many lenses the work needs:

- Multi-lens / "the works" / everything-at-once -> `mega-review`. Orchestrates bug-hunt, simplification, consolidation, security, test-gap, and performance together, dedupes across lenses, emits one mega audit doc. Also the right call for a scoped 2+ lens pass (e.g. bugs + security + tests). It runs this verify/dedupe loop within a single session; this workflow is the across-session form.
- Many-file dedupe / merge / drift / refactor-across-files -> `consolidation-audit`. Maps the codebase, verifies/refutes each candidate, groups survivors.
- One focused lens -> that lens's own skill, which owns its audit:
  - simplify / local cleanup / narrow reuse pass -> `simplification-review`
  - vulnerabilities / authz / injection / secrets / harden -> `security-remediation`
  - missing tests / test gaps / is this covered -> `test-coverage-audit`

Output in every case: ONE read-only audit doc w/ grouped findings + risk sequencing. That doc is the hand-off artifact for the rest of the loop.

### 2. Approve - the gate

The audit stays read-only until Garrett reads it and picks which action groups to do. Approval is per-group, not all-or-nothing - take some, defer others, drop the rest. The selected group IDs are the input to Implement. Nothing below this line runs before this happens; don't let an audit slide into edits because a fix looks obvious.

### 3. Implement - carry out approved groups

Hand the approved group IDs to `phased-implementation`; it works one phase at a time and writes status back into the audit doc as each phase closes - marking groups done, recording deviations. The doc is now mutating, and its statuses are the truth of how far the work got - which matters most when the work pauses here and resumes a session later.

```
/phased-implementation   # hand it the approved group IDs
```

If a phase contradicts the plan, it stops to re-plan rather than improvising - that kicks back to Audit/Approve for the affected group, not a freehand edit.

### 4. Re-verify - before acting on a doc you didn't just write

A guard, not a fixed-in-time step: run it whenever trust has decayed - the audit sat a while, came from another model, or came from a prior session, i.e. you're about to act on claims you can't vouch for against the LIVE code right now. (Another model - Codex or any agent - counts, every time, regardless of how confident it reads. A long pause mid-Implement means re-verify the not-yet-done groups before resuming. A doc you wrote this session -> skip it.)

```
/verify-review-findings   # classifies each claim confirmed / stale / incorrect / speculative / unverifiable
```

It classifies each claim against live code w/ cited evidence and stays read-only until you approve the confirmed ones. Feed only the confirmed findings back into Approve -> Implement; stale/incorrect/speculative ones get struck or rewritten in the doc, not silently carried. This is the audit-doc reconciliation pattern that recurs across the repos (TLB, SwimMate, vsc-mdx, coral): a long-lived audit/spec doc is never trusted blind.

### 5. Reconcile - fix the doc's bookkeeping

At the end, a mechanical sweep over the audit doc: fix internal counts ("12 findings" when 4 were struck), correct group statuses (done / deferred / dropped), and scrub stale wording that describes a state the code has moved past. No new findings, no edits to source. The goal: the doc's own summary matches its body and the body matches the code, so the next person (or next session) can trust it at a glance.

## Notes

- Scope creep guard: discoveries made mid-Implement don't get fixed inline. They go back to the audit doc as new findings -> Approve -> a later phase. The loop is what keeps the diff scoped.
