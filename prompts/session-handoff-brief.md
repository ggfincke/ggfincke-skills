# Session handoff brief

A canned prompt that makes the current session write a tight continuation brief before you `/compact` or `/clear`, so the next stretch resumes from something you controlled instead of a lossy auto-summary. It pairs with the `session-context-hygiene` workflow, which covers when to reach for it (compact vs. clear, what to carry forward).

Why a prompt and not a skill: you fire this deliberately at a stopping point. A skill keyed on "about to compact" can't see your intent and would mis-fire on something destructive.

The key move: force a BRIEF, not a transcript. The summarizer already keeps the broad shape; what you want preserved is the lossy part - exact anchors, the why behind decisions, the precise next step.

## Paste block

```
Before we compact/clear, write a continuation brief so a fresh session can pick this up cold. Keep it TIGHT - a brief, not an essay. No transcript, no narration of what we tried; just what the next session needs:

1. Task & goal - one line: what we're doing and what "done" looks like.
2. Key decisions - the choices made and WHY, including anything we ruled out so it's not re-litigated.
3. Open threads - what's unresolved, in progress, or still in question.
4. Anchors - the file:line locations where the work sits (and any commands/checks that matter).
5. Next step - the single exact action to take first on resume. Be specific.

Pull only from what's actually in context - don't invent state. If an anchor or result is something you'd have to re-derive, say so rather than guessing.
```

## Variants

- Pre-`/clear` (carrying nothing automatically): append "Also state explicitly what NOT to carry forward - the dead-ends, abandoned approaches, and side-quests that should die with this session, so they don't get revived."
- Resume from this brief (paste at the top of the fresh session, above the brief): "This is a continuation brief from a prior session. Read it, restate the goal & exact next step back to me in one line to confirm you've got it, then re-anchor against the live code before doing anything - don't trust a remembered line number or result across the boundary."
