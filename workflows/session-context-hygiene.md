# Session context hygiene

Consulted process note for managing the context window across a long task: when to `/compact` vs `/clear`, what survives a compaction (& what you must restate after), and when to write a handoff brief before resuming in a fresh session.

Why a workflow and not a skill: context management can't be auto-fired - a skill that decides on its own when to compact or clear would be pointless at best and destructive at worst (a wrong `/clear` wipes the live thread). You make this call by hand. This note encodes the call you actually make.

## The decision: /compact vs /clear

- `/compact` - SAME task, context just got long. Summarize & keep going; the goal & thread survive. Tell: you'd answer "what are we doing?" with the thing you've been doing for the last hour.
- `/clear` - DIFFERENT, unrelated task. Wipe & start fresh. Tell: you'd answer "what are we doing?" with something the current context has nothing to do with.
- When in doubt it's `/compact`, not `/clear`: a compaction is recoverable (the thread continues), a clear is not.

## What survives a compaction - & what you lose

A `/compact` keeps a SUMMARY: the goal, the decisions made, the current next-step, the broad shape of what's been touched. It drops the rest. After a compact, assume gone:

- Exact tool output - test runs, error text, `git` output, command results. Re-run anything you were about to act on.
- Line-precise anchors - the `file:line` you were holding in your head. Re-grep / re-open before editing there.
- Nuance - the why behind a half-made decision, the dead-ends you already ruled out, the exact wording of a constraint I gave you.

So right after a compact, before continuing: restate the goal in one line, re-anchor the file+line you're working at, and re-run the last check whose output you needed. Don't trust a remembered SHA, line number, or test result across a compaction boundary.

## When to write a handoff brief first

A `/compact` summary is auto-generated & lossy. When the work is worth more than that, write an explicit brief BEFORE you compact or clear - then the next stretch resumes from something you controlled, not from whatever the summarizer kept. Write one when:

- You're about to `/clear`, or you'll resume in a brand-new session (new window, next day) - nothing carries automatically, so the brief IS the carry.
- There's an open thread or a non-obvious decision/constraint the goal-line alone wouldn't preserve.

Skip it for a short task you're finishing in this session, or a clean stopping point with no open threads.

To produce it: don't hand-write the brief - paste the `session-handoff-brief` prompt (prompts/session-handoff-brief.md) and let the live session generate it (task & goal, decisions made, open threads, file/line anchors, exact next step). Capture the output, THEN `/compact` or `/clear` - never the other way around, since the clear destroys the context you'd write it from. To resume: open a fresh session & paste the brief back in as the first message.

The brief is also the clean hand-off into `phased-implementation`: an approved plan + a tight brief is exactly what a fresh implementation session needs to start cold.
