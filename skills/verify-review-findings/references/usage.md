# Verify Review Findings - Usage

Ready-made prompts for the `verify-review-findings` skill. The first-turn variants kick off a triage with a concrete input source - better than dropping raw text with no framing. The follow-ups steer the work after the first triage report. Fill in the `[BRACKETED]` parts.

## First-turn variants by input source

### A. Another model's review

```
Another model reviewed [SCOPE] and produced the findings below. Verify each one against the
current code before I act on any of them - reproduce or trace it, and tell me which are
confirmed, stale, incorrect, speculative, or unverifiable, with evidence. Read-only for now.

[PASTE FINDINGS]
```

### B. Human PR review / colleague comments

```
Here are the review comments on [PR / BRANCH]. Some may be against an older revision. Check
each against the live code: which are real, which are already addressed, which are misreads.
Give me a drop list I can use to reply to the reviewer. Do not change anything yet.

[PASTE COMMENTS]
```

### C. Scanner / linter / SARIF report

```
This is output from [TOOL] over [SCOPE]. Triage it for false positives: for each finding,
confirm whether the flagged path is actually reachable and the issue real in this codebase,
or whether it is speculative or incorrect. Prioritize the confirmed ones. No edits yet.

[PASTE OR POINT TO REPORT]
```

### D. CI / automated check failure

```
[CI JOB] is reporting the issues below on [SCOPE]. Tell me which reflect a real problem in
the current code versus stale or environment/config artifacts, with evidence for each.
Read-only until I pick what to fix.

[PASTE OUTPUT]
```

### E. Single nagging claim

```
Someone says [CLAIM] about [FILE / SYMBOL]. Is that actually true against the current code?
Trace it and show me the evidence either way before suggesting any change.
```

### F. Stale-branch review

```
These findings were written against [OLD REVISION / PR] and the code has moved since. Figure
out which still apply to HEAD, which were resolved by later changes (and what resolved them),
and which were never right. Do not edit; just give me the current status of each.

[PASTE FINDINGS]
```

## Follow-up prompts after the first triage

### Approve the confirmed set

```
Fix the confirmed findings only - [ALL / NUMBERS]. Keep each diff minimal and idiomatic, add
a regression test where there is an existing pattern, and do not touch the stale, incorrect,
or speculative ones. Summarize what changed and what to test.
```

### Hand a finding to a generator skill

```
Finding [N] is confirmed but bigger than a spot fix. Hand it to [simplification-review /
security-remediation / consolidation-audit] using the evidence you already gathered, and
produce that skill's plan before editing.
```

### Re-verify a verdict

```
You marked finding [N] as [VERDICT], but I think it is [OTHER]. Re-verify it: show the exact
code path and either change the verdict or hold it with stronger evidence.
```

### Demand stronger dismissal evidence

```
For everything you dismissed as stale or incorrect, show me the specific current code that
disproves the claim. If any dismissal is only medium or low confidence, move it to
unverifiable and tell me what would settle it.
```

### Draft the reply to the reviewer

```
Draft a concise reply to the reviewer: for each finding, the verdict and a one-line reason -
confirmed (will fix), already addressed (with what fixed it), or not applicable (why). Neutral
tone, no edits to the code.
```
