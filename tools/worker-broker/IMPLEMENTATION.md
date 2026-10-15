# Opt-in Codex worker implementation

Authority: the user approved the five-section implementation plan in this task,
including the named tests, canonical installs, and one bounded smoke per provider.
No commits, pushes, or forced restarts of active tasks are authorized.

## Phases

- [x] Durable run contracts, local target discovery, power and scheduling guards.
- [x] Antigravity adapter and fail-closed read-only readiness.
- [x] Canonical Codex and agent installation, orchestration instructions, doctor.
- [x] Final repository gate and deployed-build verification.

## Verification ledger

- Broker typecheck and 99 tests passed, including the real daemon socket lifecycle,
  budget persistence, failed admission accounting, and power changes at launch.
- Final `make check PYTHON=.venv/bin/python` passed: 195 Python tests
  (one existing skip), 99 broker tests, skill/generated-output validation,
  formatting/lint, and both npm audits (zero vulnerabilities).
- Canonical Codex MCP sync applied and a second dry-run was a no-op. Existing
  main-model settings and provider environment values were retained. The global
  AGY agent and updated orchestrate/working-conventions sources were synced.
- The previous daemon was idle and stopped gracefully. No historical jobs were in
  its active store; its archive was retained. No active Codex tasks were restarted.
- The first local smoke attempt exposed a missing daemon method registration and
  started no run or inference. The allowlist now has exhaustive TypeScript keys,
  and a real socket lifecycle regression covers discovery/create/status/close.
- The single actual local smoke passed on AC: requested and observed model both
  `qwen3.8:27b-mlx`, fixture unchanged, one accepted assignment, run closed.
- Installed Coral cancellation was checked against a simulated Ollama stream:
  the owned HTTP stream closed after cancellation, the server remained responsive,
  and no real inference or model download occurred during that transport check.
- Antigravity 1.2.0 failed the native release gate. Its initialization event exposed
  write, command, MCP, browser, and nested-agent tools despite the selected
  read-only agent. The adapter aborted at initialization; the terminal event
  reported zero turns and zero tokens. Google execution remains disabled.

- Deployed protocol 4 daemon matches the final built content hash, has no active
  or queued workers, discovers all three installed local models, and reports
  Antigravity unavailable with the observed release-gate failure. The completed
  smoke run retained spent=1, remaining=0, and closed status after daemon restart.

## Limits and handoff

The broker enforces declared run limits and local power policy. Conversational
permission is instruction-enforced; neither it nor native read-tool profiles is
an OS sandbox. A successful local protocol smoke is not a filesystem-wide
containment attestation. The Antigravity gate must remain closed until a native
mechanism actually restricts tools and ambient hooks/plugins.

The two obsolete approval-card prose tests were removed in accordance with the
approved instruction to skip prose snapshots; actual broker behavior is tested.
No cloud Ollama fallback, weights downloads, model catalog changes, commits, or
pushes were performed in this implementation.
