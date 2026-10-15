# Routing policy

Choose providers at the work-package level. Do not route individual file reads or tiny actions through separate workers.

## Current availability

Use only providers exposed by `start_worker` in the live MCP tool schema. Discover Codex, Cursor, Coral, Claude, and Antigravity (`agy`) through `list_targets`; exposure in the schema does not establish readiness.

Keep model identifiers in broker configuration, `~/.config/worker-broker/profiles.json` stage bindings, or explicit assignments. Do not hardcode account-dependent model names in this skill. Stage-level bindings and task permission are defined in [model-plan.md](model-plan.md).

- Prefer Codex for general implementation and repository-native coding work.
- Prefer Cursor for independent review, frontend work, repositories with material `.cursor` rules, or deliberate harness diversity.
- Prefer Coral for local/private exploration, repository mapping, log analysis, and bounded low-cost work through an installed local Ollama model, after local execution is authorized for the task.
- Prefer Claude for bounded implementation or review where Claude Code's native repository guidance and tool behavior are the best fit.
- Encode Cursor reasoning effort in its model identifier; the generic `effort` field is rejected for Cursor.
- Coral and Antigravity accept read-only assignments without shell phases, generic effort overrides, or nested agents. Its model must be supplied by broker configuration or the assignment.
- Claude forwards `low`, `medium`, `high`, `xhigh`, and `max`; `ultra` stays assignment metadata because the native CLI does not accept it.

## Local Ollama execution

When local execution is authorized and the assignment fits, prioritize installed local Ollama models. Exclude Ollama cloud models from plans and fallbacks. Verify installed model names and execution location from current Ollama metadata; a localhost endpoint alone does not prove inference is local. Do not download models as part of routing.

Local execution requires current-task authorization, which may come from an approved plan explicitly naming the local model. Generic permission to delegate or use cloud workers does not authorize local inference. Require AC power at launch; battery power blocks local work unless the user explicitly approves a battery exception for this run. Unknown power always blocks local execution. If power changes during a run, stop new local launches and cancel owned local work while preserving partial results. Verify inference has stopped separately from worker-process exit.

The broker enforces the declared run scope, installed-local metadata, AC checks at admission and launch, and a five-second power monitor. Battery loss cancels pending local assignments and aborts the owned request; plugging in does not restart cancelled work. One local worker runs daemon-wide. Chat permission remains instruction-enforced. Never stop the shared Ollama server or unload unrelated user models.

## Package selection

Delegate when all of the following are true:

- the objective can be explained without transferring the parent transcript;
- allowed paths are narrow and concrete;
- acceptance criteria can be observed independently;
- integration assumptions can be stated up front;
- the lead can inspect and reject the returned patch.

Keep work in the lead session when it determines architecture, spans inseparable paths, needs rapid back-and-forth with the user, or would require a worker to discover its own scope.

## Concurrency

- Run cloud read-only packages concurrently within the assignment budget; local packages serialize daemon-wide.
- Run non-overlapping edit packages concurrently when their interfaces are already fixed.
- Use `depends_on` when one package requires another worker's successful completion.
- Submit conflicting edit packages in intended order; the broker starts them FIFO.
- Cancel superseded packages instead of letting them finish against stale assumptions.

The broker conservatively queues literal prefix overlaps. The lead still owns semantic overlap that path prefixes cannot express, such as two packages changing opposite sides of one API contract, and must sequence it with `depends_on`.

## Prompt shape

Send lean assignment context rather than the parent transcript. Include exact symbols and stable module paths, known constraints, acceptance criteria, and commands. State that the worker is delegated execution, not the project lead.
