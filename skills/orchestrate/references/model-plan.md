# Model plan

Resolve the user's current-task request into a bounded broker run. Direct requests
supply permission; do not stop for a second approval card. A proposal-only request
still produces a proposal and no workers.

## Selection and defaults

Use the live `list_targets` response. Prefer installed local Ollama models when
local inference was explicitly requested. Antigravity uses provider `agy`. Exclude
Ollama cloud models, downloads, and automatic provider fallback. Local and Google
workers are read-only in this version.

Default to four assignments, or one for a single-reviewer request. Count accepted
assignments, including failures and cancellations. Use one run across all waves.
`create_run` freezes provider/model/mode bindings for twelve hours. Ordinary
subagent requests do not opt into the broker or local inference.

Existing explicit workflow and stage bindings remain usable. `max-workers=<n>`
overrides the default when the user requests it. `--yes` is accepted as redundant
confirmation, never as permission for unspecified local inference or battery use.

## Workflow templates

Stage identifiers are stable strings; defaults and profiles key on them. Every plan row has a unique stage id. In multi-wave plans, suffix repeated logical stages by wave (for example `implement-w1`, `implement-w2`); reply grammar addresses rows by id and renderers may reject duplicate ids. A run uses only the stages it needs.

| Template | Stages (in order) |
| --- | --- |
| `implement` | `research`, `implement`, `review`, `verify` |
| `review` | `fanout`, `verify`, `synthesize` |
| `research` | `source`, `deep-read`, `synthesize` |
| `migrate` | `discover`, `transform`, `verify` |

For work that fits no template, declare an ad-hoc stage list in the plan; the same task-permission and budget rules apply.

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
6. explicit user changes;
7. inline `<stage>=` arguments in the invocation.

Read the file if present. A missing file means step 1 only. If the file is present but invalid, use step 1 only and state that fallback in one line when emitting the plan; never fall back silently. Never hardcode account-dependent model names in the skill itself.

On a user request such as "remember these models", atomically write the approved bindings back to `profiles.json`. Persist at the narrowest scope, repository plus workflow, unless the user requests another scope.

## Present and execute

Briefly state the selected targets, purpose, and assignment count, then create the
run. Supply its returned ID as `run` on every assignment. `workflow` and `stage`
remain dashboard metadata. Hosts may render a model plan, but rendering is not a
mandatory approval gate and must not invent an ID in place of the broker's ID.

Read remaining budget from `get_run_status`. Request new permission only when
scope expands, bindings change, the run expires, or a battery exception is needed.
Never silently create additional runs to evade a spent budget. A rejected target
stays blocked; do not fall back to direct shell invocation or a native model picker.
