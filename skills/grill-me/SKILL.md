---
name: grill-me
description: Relentless interview that stress-tests a plan, decision, or idea until every branch of the design tree is resolved. Use only when explicitly asked - "/grill-me", "grill me", "grill this", "stress-test this plan", "interview me about this design". Writes no files and does not implement until the user confirms shared understanding.
---

# Grill Me

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

This skill is opt-in and **stateless**. Do not write files, ADRs, `CONTEXT.md`, or a plan document. Do not implement. The only output is the interview and, at the end, a confirmation that understanding is shared.

Activate only from an affirmative current-task request. Do not activate for a contextual mention, a request to inspect or edit this skill, or a request to write a plan that did not ask for an interview.

While this skill is active, the interview format below wins over action-first's one-question and five-item-list rules. Ask the whole frontier each round, then wait.

## Rounds and the frontier

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled - the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree - settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

"I don't know" is a real answer. If the user tells you to wrap up, stop and summarize the settled decisions rather than draining the remaining tree.

## Facts vs decisions

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), look it up or dispatch a sub-agent to find it - don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report - ask the rest of the frontier now. The _decisions_ are the user's - put each to them and wait. Answering your own decisions is a failed run, not a shortcut.

## Ungrillable questions

Stop grilling a question that talking cannot settle (how something should look or feel, which of several layouts is right). Say so in one line and wait; do not rephrase it into more interview.

## Close

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## Sources

Adapted from Matt Pocock's MIT-licensed `grill-me` and `grilling` skills. Pins and refresh notes are in [sources.md](references/sources.md); license in [LICENSE.txt](references/LICENSE.txt).
