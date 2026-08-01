# Model plan

The model plan is the single authorization boundary between an orchestrate invocation and any `start_worker` call. It fixes, per stage, which provider/model/effort runs and how many workers may launch. No worker starts before the plan is approved.

## Invocation grammar

```
/orchestrate [workflow=<template>] [<stage>=<provider>[:<model>[:<effort>]]]... [max-workers=<n>] [--yes] <task>
```

- The session model is the orchestrator (driver). The skill never selects or switches its own driver; inline arguments configure workers only.
- `workflow=` pins a template; otherwise infer the template from the task and say so in the plan.
- `<stage>=` overrides one stage's binding. Omitted segments fall back down the precedence chain. Cursor encodes effort in its model identifier; reject an effort segment for Cursor.
- When the value's leading segment is not a configured broker provider, treat the whole value as `model[:effort]` — a model-only override. The user picks models; the orchestrator routes each model to a harness that can run it (for example Anthropic models through Cursor) and re-gates if no configured harness can.
- `max-workers=` caps the run's total worker budget regardless of what the plan proposes.
- `--yes` skips the approval gate and launches with the resolved plan. Only an explicit `--yes` does this.

The same grammar is accepted in replies at the gate, so an edited plan (from chat or from a UI plan card) round-trips as ordinary text.

## Workflow templates

Stage identifiers are stable strings; defaults and profiles key on them. Every plan row has a unique stage id. In multi-wave plans, suffix repeated logical stages by wave (for example `implement-w1`, `implement-w2`); reply grammar addresses rows by id and renderers may reject duplicate ids. A run uses only the stages it needs.

| Template | Stages (in order) |
| --- | --- |
| `implement` | `research`, `implement`, `review`, `verify` |
| `review` | `fanout`, `verify`, `synthesize` |
| `research` | `source`, `deep-read`, `synthesize` |
| `migrate` | `discover`, `transform`, `verify` |

For work that fits no template, declare an ad-hoc stage list in the plan; the gate rules apply unchanged.

## Defaults and precedence

User defaults live in `~/.config/worker-broker/profiles.json`:

```json
{
  "workflows": {
    "implement": {
      "research": { "provider": "codex", "model": "gpt-5.6-luna", "effort": "high" },
      "implement": { "provider": "codex" }
    }
  },
  "stages": {
    "verify": { "provider": "cursor", "model": "opus-5-high" }
  },
  "repos": {
    "/absolute/normalized/repo": {
      "workflows": {
        "implement": {
          "implement": { "provider": "codex", "effort": "high" }
        }
      },
      "stages": {
        "verify": { "provider": "cursor" }
      }
    }
  }
}
```

Resolve each stage binding in increasing priority:

1. broker provider default (binding omits `model`/`effort`);
2. global `stages.<stage>` entry;
3. global `workflows.<template>.<stage>` entry;
4. repository `repos.<normalized-absolute-repo>.stages.<stage>` entry;
5. repository `repos.<normalized-absolute-repo>.workflows.<template>.<stage>` entry;
6. approved plan edits from the gate;
7. inline `<stage>=` arguments in the invocation.

Read the file if present. A missing file means step 1 only. If the file is present but invalid, use step 1 only and state that fallback in one line when emitting the plan; never fall back silently. Never hardcode account-dependent model names in the skill itself.

On a user request such as "remember these models", atomically write the approved bindings back to `profiles.json`. Persist at the narrowest scope, repository plus workflow, unless the user requests another scope.

## Plan block

Before launching anything, emit the resolved plan as a fenced block with info string `orchestrate-plan` (renderable as an interactive card by clients that support it; readable as text everywhere else):

```orchestrate-plan
{
  "workflow": "implement",
  "task": "one-line task summary",
  "stages": [
    {
      "id": "research",
      "provider": "codex",
      "model": "gpt-5.6-luna",
      "effort": "high",
      "mode": "read",
      "workers": 3,
      "scope": "map auth boundaries and session flows"
    }
  ],
  "totalWorkers": 7,
  "maxWorkers": 9
}
```

- Field types are fixed: every stage field is a scalar — `scope` is one string (summarize multiple packages in prose, never an array), `workers` an integer, `effort` a string or omitted. Renderers may reject shape drift.
- For multi-wave runs, add an optional `phase` label (one string, e.g. `"wave 1: research"`) to each stage; renderers group stages under their phase in first-appearance order. Omit it for single-wave plans.
- Include a `runId`: a short unique identifier for this run (task slug plus a random suffix). Reuse the same `runId` when re-emitting the plan after gate edits; generate a fresh one only for a genuinely new run.
- After approval, pass the metadata on every `start_worker` call: `run` = the plan's `runId`, `workflow` = the template, `stage` = the stage id. Dashboards correlate live job status to the approved plan through these fields.
- `workers` is the planned count per stage; `maxWorkers` is the hard budget the approval covers across the whole run.
- `mode` and `scope` per stage make read vs edit exposure visible before anything runs.
- For every edit wave, declare the lane ETA threshold in the plan; use 30 minutes by default and re-gate when `serializes_behind` makes the projected lane exceed it.
- Keep counts honest: if a stage's fan-out is unknown, state the cap you will enforce, not a guess.

## Approval gate

1. Present the plan block and ask for approval. The canonical approval reply is `approve`, optionally followed by grammar tokens for edits (`approve review=cursor:opus-5-high max-workers=6`); apply edits, and re-emit the plan only when edits changed it. Any other reply is discussion — keep gating.
2. Call `start_worker` only after approval or an explicit `--yes`. In a session where no user can respond, an invocation without `--yes` ends at the plan: report it and stop rather than launch.
3. The approval covers scale as well as models. If the run needs to exceed `maxWorkers`, stop, present a delta plan (added workers, stage, reason), and re-gate before launching more.
4. Changing an approved stage's provider or model mid-run also re-gates; effort-only changes within an approved stage do not.
5. Record deviations from the approved plan (failed workers replaced, stages skipped) in the final report.
