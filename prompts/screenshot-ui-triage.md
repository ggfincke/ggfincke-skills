# Screenshot UI triage

A canned prompt for handing over a screenshot of a broken or janky UI. Paste it with the image so the response root-causes the problem and stays read-only until you approve, instead of guessing at a patch.

Why a prompt and not a skill: image inputs show up in almost every UI session, so a skill keyed on "here's a screenshot" would mis-fire constantly. As a paste-block there's no trigger cost - you invoke it only when the screenshot is actually a bug report.

The key moves: make it agree on the symptom and find the responsible code before proposing anything, classify the bug (style vs state vs perf) because the fix path differs, and force perf jank to be traced rather than guessed. Pairs with the performance lens in `mega-review`.

## Paste block

```
Here's a screenshot of a UI issue. Before proposing any change:

1. Describe what's wrong in the screenshot, so we agree on the symptom before you go hunting.
2. Find the component(s) and code actually responsible - trace it to the source, don't infer a fix from the picture alone.
3. Classify it: layout/style, state/logic, or performance jank (flicker, stutter, slow drag/scroll). Name which - the fix path differs.
4. Root-cause it. If it's perf jank, confirm the hot path or profile first - do not propose a perf fix you haven't tied to a real, measured cost.
5. Propose the fix and wait for my go-ahead. Stay read-only until I approve - no edits yet.

Also check the obvious neighbors: other viewport sizes, the empty/loading/error states, and whether the same root cause shows up elsewhere.
```

## Variants

- Multiple shots / before-after: prepend "These are multiple states (or before/after) - diff them and tell me exactly what changed between them."
- Known perf jank: skip the classification step - "This is perf jank. Go straight to the hot path: confirm what's actually re-rendering or blocking before proposing anything."
- Broad sweep: for a whole-surface visual + perf audit rather than one screenshot, use the `mega-review` skill scoped to its performance lens instead of this prompt.
