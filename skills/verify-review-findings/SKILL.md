---
name: verify-review-findings
description: "Triage externally-supplied review findings - from a human reviewer, another model, a linter or scanner, CI, or PR comments - by verifying each claim against the live code before acting: trace or reproduce it, classify it as confirmed, stale, incorrect, speculative, or unverifiable with cited evidence and a confidence rating, and stay read-only until told to address the real ones. Use when given a code review, audit, scan report, or findings list to check, when asked whether reported issues are real, still valid, already fixed, or false positives, or to vet, adjudicate, or triage claims someone else made about the code before changing anything."
---

# Verify Review Findings

You are triaging review findings that someone else produced - a human reviewer, another model, a linter or scanner, CI, or PR comments. Your job is to verify each claim against the live code before anything is changed, classify it by what the evidence actually shows, and stay read-only until I approve acting on the confirmed ones.

This is the inverse of a review skill: you are not hunting for new issues, you are adjudicating claims that already exist. The claim's description of the code is a hypothesis, not a fact - confirm it against the current code in either direction. Do not act on a finding because it sounds plausible, and do not dismiss one because it sounds wrong.

## Finding the inputs

You need two things: the claims, and the code they are about.

- Claims: pasted review text, a findings file (REVIEW.md, a scanner's SARIF/JSON, an exported PR review), linter or CI output, "what another model said," or a single nagging assertion. Break the input into a numbered list of atomic claims - one claim = one assertion about one location. Split bundled claims; flag vague ones.
- Code: the current working tree at HEAD by default. If a claim cites a file and line, go there; if it does not, locate the code it describes.
- Baseline: establish what revision the claims were written against (stated in the input, or inferable from a cited PR, branch, commit, or old line numbers) versus what is live now. The gap between the two is where staleness lives. If they match, say so; if you cannot tell, note it.

If either the claims or the relevant code cannot be found, say what is missing instead of guessing.

## Hard rules

- Read the live code before judging. Never classify from the claim text alone. Open the cited symbol; trace or reproduce the asserted behavior.
- Every verdict needs evidence, and dismissals need the most. Confirmed needs a reproduction or a source-to-sink trace; Stale needs the change that resolved it; Incorrect needs the exact code that contradicts the claim. No bare "looks fine."
- Read-only until approved. Triage produces a report, not edits. Do not fix, refactor, or clean up anything during triage.
- Match the verdict to the evidence - do not inflate or deflate. Do not promote a speculative claim to confirmed to look thorough, and do not bury a confirmed bug to look clever.
- Preserve the reviewer's intent even when rejecting. For Stale or Incorrect, say what the reviewer likely saw (an old line, adjacent code, a real pattern in the wrong place). It is useful signal and it prevents re-litigating the same claim later.
- Separate the bug from its proposed fix. A claim can be a real bug and ship with a bad suggested fix. Judge whether the issue exists first; evaluating or applying a fix is a later, separate step.
- Flag the unverifiable rather than forcing it. If you cannot prove or disprove a claim with the code in front of you, say so and state exactly what you would need.
- Keep scope to the claims. Do not expand into a general review of the surrounding code. If you spot something new and serious while verifying, note it separately as out-of-scope; do not fold it into the triage.

## Classification

Assign each claim exactly one verdict.

### Confirmed
The claim is true against the current code. You reproduced it or traced the full path.
- Evidence: the reproduction, or the source -> sink / missing-enforcement trace, against live code.
- Action: candidate to fix. Record impact and which skill should own the fix (see After approval).

### Stale
The claim was true at the revision it was written against, but the current code no longer has the issue - it was refactored, fixed, or removed.
- Evidence: the current code that no longer matches the claim, ideally with the commit or change that resolved it.
- Action: no code change. Note what resolved it so the reviewer's item can be closed.

### Incorrect
The claim was never true; the reviewer misread the code.
- Evidence: the exact code that contradicts the claim (e.g. the validation that does happen, one frame up).
- Action: reject, with the counter-evidence and a note on what was likely misread.

### Speculative
The claim is true in principle but is not reachable, not triggered, or has no real impact in this codebase - it depends on a caller, config, or input that does not exist here.
- Evidence: why the precondition or path does not hold; the guard or invariant that makes it unreachable.
- Action: downgrade to optional hardening. Your call whether it is worth it; do not change behavior to satisfy a non-issue.

### Unverifiable
You cannot prove or disprove it with the available code - it needs runtime data, missing context, an external system, or maintainer intent.
- Evidence: what you checked and where the trail ended.
- Action: needs your input. State precisely what would resolve it.

## Confidence

Rate each verdict High / Medium / Low.

- High: clear, reproduced, or directly contradicted by the code.
- Medium: likely, but depends on runtime config, caller behavior, or data shape.
- Low: a judgment call you are not sure of.

Hold dismissals (Stale, Incorrect, Speculative) to a high bar: a weak dismissal is how a real bug gets waved away. If a dismissal would only be Medium or Low confidence, do not dismiss - mark the claim Unverifiable and say what would settle it.

## Triage process

1. Collect and atomize. Turn the input into a numbered list of atomic claims with their cited locations.
2. Establish the baseline. Determine the revision the claims target versus the live code; note any gap.
3. Verify each claim. Open the code, trace or reproduce, decide whether it holds now.
4. Classify. Assign one verdict, cite the specific evidence, rate confidence.
5. Report. Group by verdict; produce the recommended-actions split and the approval request.
6. Wait. Do not edit until I approve which confirmed findings to act on.

## Required output before edits

### Summary
- One line: N claims - X confirmed, Y stale, Z incorrect, S speculative, U unverifiable.
- The 1-3 confirmed findings that actually matter, if any.

### Baseline
- The revision the claims targeted versus live HEAD, and whether staleness is in play.

### Verdicts
Grouped by verdict. For each claim:
1. The claim, quoted or tightly paraphrased, with its source.
2. Location (file/symbol) in the live code.
3. Verdict + confidence.
4. Evidence, as required by the verdict above.
5. For Confirmed: impact, and which skill should own the fix.

### Recommended actions
Three lists:
- Fix now: the confirmed findings, by priority.
- Drop: stale and incorrect findings, each with the one-line reason to close it out.
- Needs your call: speculative and unverifiable findings, with what you would decide or supply.

### Approval request
Ask which confirmed findings to act on. Separately name each major regression test you propose and state that approving a finding does not approve test edits unless the user also approves that named test. Do not edit until approval.

## After approval

Once I say which findings to address:

- For a small, self-contained fix, apply it directly and keep the diff minimal and idiomatic. Add or update a regression test only when that named major test was approved; otherwise run the existing checks and propose a separate test plan.
- For anything substantial, hand the confirmed finding to the skill that owns that kind of change: simplification-review for behavior-preserving cleanup, security-remediation for a vulnerability, consolidation-audit for a cross-file dedupe or refactor. Carry over the evidence you already gathered so the work is not re-derived.
- For several confirmed findings approved together, work through them with the phased-implementation skill: one finding at a time, gate between, rather than fixing all at once.
- After editing, summarize: which findings were addressed, files changed, tests added or updated and their result, and which findings were intentionally left (stale, incorrect, declined) so the original review can be closed out.

Only claim what you verified. Do not assert the rest of the review is fine - only the claims you triaged.

## Notes

- This produces a triage report first; wait for approval before editing. Approve with phrases like "fix the confirmed ones", "address findings 2 and 5", "show diffs first", "re-verify finding 3 - I think it's real", or "draft the reply to the reviewer".
- references/usage.md has first-turn variants by input source (another model's review, a human PR review, a scanner/SARIF report, CI output, a single claim, a stale-branch review) and follow-ups (approve the confirmed set, hand off to a generator skill, re-verify a verdict, demand stronger dismissal evidence, draft the reviewer reply).
- This skill vets findings that already exist. To generate findings in the first place, use simplification-review, security-remediation, or consolidation-audit - then this skill is what you run when someone hands those results back to you to check.
