# Routing policy

Choose providers at the work-package level. Do not route individual file reads or tiny actions through separate workers.

## Current availability

Use only providers exposed by `start_worker` in the live MCP tool schema. Codex, Cursor, and Coral are available.

Keep model identifiers in broker configuration or explicit assignments. Do not hardcode account-dependent model names in this skill.

- Prefer Codex for general implementation and repository-native coding work.
- Prefer Cursor for independent review, frontend work, repositories with material `.cursor` rules, or deliberate harness diversity.
- Prefer Coral for local/private exploration, repository mapping, log analysis, and bounded low-cost work through an installed Ollama model.
- Encode Cursor reasoning effort in its model identifier; the generic `effort` field is rejected for Cursor.
- Coral rejects generic effort overrides and nested agents. Its model must be supplied by broker configuration or the assignment.

## Package selection

Delegate when all of the following are true:

- the objective can be explained without transferring the parent transcript;
- allowed paths are narrow and concrete;
- acceptance criteria can be observed independently;
- integration assumptions can be stated up front;
- the lead can inspect and reject the returned patch.

Keep work in the lead session when it determines architecture, spans inseparable paths, needs rapid back-and-forth with the user, or would require a worker to discover its own scope.

## Concurrency

- Run read-only packages concurrently when they use a stable base commit.
- Run non-overlapping edit packages concurrently when their interfaces are already fixed.
- Run overlapping or ambiguous edit scopes sequentially.
- Cancel superseded packages instead of letting them finish against stale assumptions.

The broker conservatively queues literal prefix overlaps. The lead still owns semantic overlap that path prefixes cannot express, such as two packages changing opposite sides of one API contract.

## Prompt shape

Send lean assignment context rather than the parent transcript. Include exact symbols and stable module paths, known constraints, acceptance criteria, and commands. State that the worker is delegated execution, not the project lead.
