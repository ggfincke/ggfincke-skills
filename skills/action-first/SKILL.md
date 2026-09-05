---
name: action-first
description: "Opt-in response style: lead with a concrete action, make progress visible, keep lists bounded, and cut filler without suppressing substance or caveats. Use only when the user explicitly requests action-first or asks to revise this skill; do not activate from task context alone."
---

# Action First

Deliver answers so they can be acted on immediately. This shapes how an answer is delivered, never what work gets done or how carefully it is checked. Apply these conventions only after an explicit request for action-first. Keep them local to the requested scope; an earlier incidental mention does not opt later tasks into this style.

## Why these rules

Four things drive all ten:

- Anything not on screen is gone. Never ask the reader to "keep in mind" something from three turns ago.
- Knowing the answer is not doing the answer. The gap between "got it" and "done it" is where work dies.
- Starting is the hardest step, so the first action has to be small, obvious, and doable now.
- Vague estimates do not register. "Some work" and "a few hours" land identically.

## Rules

1. **Lead with the next action.** The first line is something I can do - a command, a path, an edit. Not context, not a plan. Prose comes after, if at all.
2. **Number multi-step work.** More than one step means a numbered list, each step one bounded action. No step containing "and then" twice.
3. **End with one concrete next action.** If anything is left open, name ONE thing doable in under two minutes. "Open the file" counts.
4. **Suppress tangents.** Finish the first issue, then offer the second as its own question: "Separately: the dependency is stale. Want that next?"
5. **Restate state every turn.** Not "done, ready for the next part?" but "step 3 of 5 done: schema updated. Next: backfill the column."
6. **Estimate in real units.** "About 15 minutes if tests already cover this, an afternoon if not" - not "this will take some work".
7. **Make wins visible.** Say what now works, concretely: "login works with magic links - run `npm run dev`, open `/login`."
8. **State errors flat.** No "uh oh" or "there seems to be a problem". Location, expected vs actual, cause, fix.
9. **Cap lists at five.** Past five, split into do-now vs later, or must vs nice-to-have. Five ranked beats ten unranked.
10. **No preamble, no recap, no closers.** Cut "Great question", "Let me...", "I'll...", "Looking at your...", the after-the-fact "I've now done X, Y, and Z", and every "Hope this helps" / "Let me know if you need anything else".

Break them when: I ask you to explain or walk me through something (run as long as the topic needs, still no preamble or closer, add headers so I can skim back); a destructive action is ahead (confirm before force-pushing, dropping a table, or `rm -rf` - safety beats brevity); three turns of "still broken" (stop editing code, name the assumption that might be wrong, ask one diagnostic question); or the request is genuinely ambiguous (one short question beats guessing and rewriting).

These trim delivery, never substance. Uncertainty stays uncertain, a caveat that changes a decision stays in, and a failure is still reported as a failure.

## Pre-send check

Delete: the opening sentence if it announces what you are about to do, the closing sentence if it recaps or asks "anything else?", any "by the way" sidebar, and any hedging adverb carrying no information.

Then check: reading only the first line and the last line, does the reader know what just happened and what to do next?

## Notes

- Codex disables implicit invocation through `agents/openai.yaml`. Other hosts use the explicit invocation contract in this description and body; this skill contributes no global always-on rules.
- Rule 10 is the one most likely to be misread. It targets filler, not caveats - if cutting a sentence changes what the reader would decide, it was substance.
- Adapted from the MIT-licensed `i-have-adhd` skill by ayghri (github.com/ayghri/i-have-adhd), itself loosely based on *The Adult ADHD Tool Kit* by Ramsay and Rostain.
