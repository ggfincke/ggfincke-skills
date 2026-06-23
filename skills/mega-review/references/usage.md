# mega-review usage

First-turn variants, lens scoping, and the two owner-less lens protocols (bug-hunt, performance).

## First-turn variants

- **Whole branch into one doc:** "mega-review this branch vs main - all lenses, one doc, be thorough."
- **Whole codebase:** "full max-effort audit of the whole repo - every lens, exhaustive, write the mega doc." (Confirm scope; this is the most expensive form.)
- **Large diff / worktree:** "the works on the current diff - bugs, simplification, consolidation, security, tests, perf - one document."
- **Scoped lenses:** "mega-review but skip security" / "just bugs + simplification + perf" / "everything except the test-gap lens."
- **With a cap:** "mega-review, but stay tight - don't spawn more than ~10 agents, lean tiers, tell me what you skipped."

## Lens scoping

Default is all six. Honor explicit scoping and state which lenses ran in the doc's header. Common scopes:

- Drop security when it was just reviewed, or when the scope is pure UI with no trust boundary.
- Drop test-gaps for a throwaway/spike branch.
- Bug-hunt + performance only, for a "why is this slow / what's broken" pass that does not need refactor proposals.

If the user names a stack-specific concern (React render churn, Convex limits, Django ORM), make sure the relevant lens (perf/simplification) picks up the stack specialization - react-best-practices for React/TS.

## Bug-hunt lens: finder -> refute -> synthesize

The correctness lens has no standalone skill; run it as a recall-first harness, scaled by the effort dial.

1. **Fan out finders.** Spawn fine-grained finder readers - per file, per region, or per lens of failure (logic/control-flow, state & lifecycle, error handling, concurrency, boundary/encoding, contract & data-shape). Each finder is blind to the others and reports candidate defects with a concrete trigger and the code evidence. Err toward surfacing: a candidate is cheap, a missed bug is not.
2. **Adversarially verify each candidate.** For every candidate, try to *refute* it against the live code - find the guard, the caller invariant, or the type that makes it a non-issue. Default a candidate to rejected if you cannot show a concrete trigger. At higher effort, use a multi-voter refute panel and kill on majority-refute. The verification pass should be at least as long as the discovery pass.
3. **Sweep and synthesize.** Dedupe survivors (same root cause found by multiple finders = one finding), rank by severity x confidence, and cut to a focused shortlist (the high-signal ones, not everything that survived). Push refuted candidates to Considered & Rejected with the evidence that killed them.

Effort ladder for this lens: Standard = a few region finders + single-pass verify; Thorough = per-module finders + per-candidate refute; Exhaustive = loop-until-dry finders + multi-voter refute panels + a completeness critic ("which module or failure-lens went unread?").

This is recall-first by design: surface aggressively, then let the refute pass earn each finding's place. It is the inverse of simplification-review (behavior-preserving, not bug-hunting) and of verify-review-findings (triages claims others produced); here you generate the claims and refute your own.

## Performance lens checklist

Real hot paths only - confirm something is hot before calling it slow, and preserve outputs.

- **Data access:** N+1 queries, over-fetching, missing indexes, full scans, repeated identical queries, unbatched writes, missing pagination.
- **Compute:** unnecessary recomputation, work inside loops that could hoist, repeated expensive lookups, avoidable allocations, O(n^2) where the n is real.
- **Frontend/React:** wasteful re-renders, unstable deps/keys, derived state recomputed each render, large lists without virtualization, heavy work on the main thread, layout thrash. (Fold in react-best-practices.)
- **I/O & async:** blocking I/O on a hot path, serialized awaits that could be parallel, missing caching/memoization, chatty network round-trips, oversized payloads.
- **Platform limits:** backend ceilings that turn into correctness failures at scale - e.g. Convex per-query read limits and per-second write throughput, serverless time/memory caps, request/response size limits. Propose the chunk/batch/stream fix.

Skip: speculative micro-optimizations off the hot path, anything the profiler/measurement does not support, readability-harming rewrites for marginal gains. A perf finding without evidence it is on a hot path is hardening, not a perf finding.

## Cross-lens dedupe - common overlaps

Collapse these to one finding tagged with both lenses:

- Duplicated helper / copy-paste = consolidation + simplification.
- Unbounded query or unpaginated list = performance + security (DoS).
- Dead code path = simplification + (sometimes) security (unreachable-but-exploitable-if-reached).
- Missing validation = security + bug-hunt.
- Untested critical logic surfaced by another lens = feeds the test-gaps lens directly.

## Follow-ups after the doc

- Approve groups: "do Group A and B", "apply all low-risk", "show diffs for Group C first", "skip security findings for now".
- Hand execution to phased-implementation: one action group at a time, gate between, keep the mega doc updated as the source of truth.
- Re-verify: "re-check F3, I think it's stale" / "the refute on F7 was weak - prove it's not real."
- Narrow: "just the bug-hunt findings - ignore the rest for now."
