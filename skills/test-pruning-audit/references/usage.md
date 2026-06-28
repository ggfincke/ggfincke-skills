# Test Pruning Audit - Usage

Ready-made prompts for the `test-pruning-audit` skill. This skill prunes an EXISTING suite: it finds tests that should not exist - measured against the bar (protects critical, breakable behavior), not against a coverage number - and classifies each Delete / Merge / Simplify / Keep, read-only until you approve removals. It is the inverse of test-coverage-audit; if you actually want MISSING tests, test gaps, or better coverage, use that skill instead. Fill in the `[BRACKETED]` parts.

## First-turn variants by input

### A. A whole suite

```
Audit the test suite in [SCOPE] for tests that do not earn their place - trivial, redundant,
exhaustive, tautological, brittle, or over-mocked. Measure each against whether it protects real,
breakable behavior, not against coverage. Classify Delete / Merge / Simplify / Keep with evidence,
name the covering test for anything you mark redundant, and tell me how many cases the suite would
shed. Read-only - findings doc first, no removals.
```

### B. One test file or module

```
Go through [TEST FILE / MODULE] and tell me which tests are worth keeping and which are not. Read
the code under test, not just the test names. Flag the low-value ones with a Delete/Merge/Simplify
verdict and evidence, but do not touch the only test of an important path. Plan first, no edits.
```

### C. The new tests in a diff

```
Look at just the tests added in my [DIFF / PR] and tell me which ones are bloat - tautological,
over-mocked, exhaustive permutations, or duplicating coverage that already exists. Name the
covering test where there is one. Keep only the ones protecting real, breakable behavior. Give me
the verdicts before I merge. Read-only.
```

### D. Our tests are too brittle

```
Our tests break on almost every refactor without catching real bugs. Audit [SCOPE] for the
brittle, implementation-detail tests - exact call order, private internals, log strings,
snapshot/DOM structure - and tell me which to delete, which to simplify to assert behavior, and
which actually guard something. Do not delete the only coverage of a real path; flag those to
improve. Plan first; do not touch anything.
```

### E. A pre-refactor prune

```
Before I refactor [AREA], prune the tests that would break on a safe refactor without protecting
real behavior, so they do not block me. Audit the suite for that area, classify Delete / Merge /
Simplify / Keep with evidence, and confirm no removal drops the only coverage of something
important. Read-only until I approve.
```

### F. A post-merge bloat sweep

```
We just merged several branches and the suite ballooned; the run is slow. Sweep [SCOPE] for the
low-value tests dragging it down - near-identical permutations, unit + integration overlapping the
same path, vacuous "does not throw" cases, coverage-gate filler - and give me one findings doc:
per-test verdicts, what the suite would shed, and the safety check. Read-only.
```

## Follow-up prompts after the findings doc

### Approve a subset to remove

```
Remove [ALL the Deletes / the Merges only / findings 2, 5, 7]. Delete/merge/trim only those in the
suite's existing style, then re-run the affected suite and confirm it is still green. Do not change
any source to make a test go away. Summarize what you removed, the cases shed, and the run result.
```

### Hand the removals to phased-implementation

```
That is a lot of removals - carry it out with phased-implementation: one group at a time, re-run
the suite after each, and gate for go-ahead between groups. Start with the lowest-risk,
self-contained removals. Findings doc is the source of truth.
```

### Re-justify a Keep

```
You marked [TEST] as Keep, but I think it is low-value. Re-check it against the bar: read the code
under test and either show the real, breakable behavior it protects (and what would slip through
without it), or change the verdict to Delete/Merge/Simplify with evidence and the covering test.
```

### Wrong direction - send it to the sibling

```
This turned into hunting for missing tests. Stop - that is test-coverage-audit. Stay in the prune
direction here, or switch skills if gaps are what I actually want.
```