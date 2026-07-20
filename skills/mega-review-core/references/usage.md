# Mega Review Core Usage

Invocation variants, lens scoping, and the two ownerless lens protocols for the security-free five-lens profile.

## Invocation variants

- **Whole branch:** "mega-review-core this branch vs main - all five lenses, one doc, be thorough."
- **Whole codebase:** "run the core mega-review over the whole repo - bug-hunt, simplification, consolidation, tests, and performance; write one doc."
- **Large diff / worktree:** "run mega-review-core on the current diff - skip security entirely and synthesize the five remaining lenses."
- **Scoped lenses:** "mega-review-core - bugs + simplification + perf only."
- **With a cap:** "mega-review-core, stay tight - do not exceed 10 agents, use lean tiers, and report what was skipped."

Security is out of scope for every invocation. If the request includes security, use `mega-review` or `security-remediation` instead.

## Bug-hunt: finder -> refute -> synthesize

1. Fan out finders by file, region, or failure mode: logic/control flow, state/lifecycle, error handling, concurrency, boundary/encoding, and contract/data shape.
2. Report candidates with a concrete trigger and code evidence. Then try to refute each candidate against the live code using guards, caller invariants, types, and runtime checks.
3. Keep only verified survivors. Put refuted claims in Considered and Rejected and unresolved claims in Not Run / Limitations or Needs Measurement; do not force binary certainty.
4. Dedupe the survivors, rank by severity and confidence, and keep the high-signal shortlist.

## Performance checklist

Confirm that a path is materially exercised before calling it a performance finding.

- **Data access:** N+1 queries, over-fetching, full scans, repeated queries, unbatched writes, and missing pagination or indexes.
- **Compute:** repeated expensive lookups, avoidable allocations, unnecessary recomputation, and real O(n^2) work.
- **Frontend:** wasteful renders, unstable dependencies or keys, large unvirtualized lists, main-thread work, and layout thrash.
- **I/O and async:** blocking I/O, serialized independent awaits, chatty round trips, missing caching, and oversized payloads.
- **Platform limits:** backend read/write ceilings, serverless time or memory caps, and request or response size limits.

Without profiling or runtime evidence, put static suspicions in Needs Measurement with the exact measurement needed to confirm or reject them. Do not propose speculative micro-optimizations off the hot path.

## Cross-lens dedupe

Collapse one root cause into one finding and tag every lens that surfaced it. Common overlaps include duplicated helpers across consolidation and simplification, unbounded queries across performance and correctness, and untested critical logic feeding the test-gap lens.
