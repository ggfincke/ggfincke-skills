# Agentic Scratch Acceptance Matrix

## Workflow selection

| Goal | Primary command |
|---|---|
| Validate one `.sb3` | `npm run validate -- <absolute-input>` |
| Full read-only project check | `npm run project-check -- --input <absolute-input>` |
| Timing-fragility analysis | `npm run fragility-check -- --input <absolute-input>` |
| Codex-readable walkthrough | `npm run project-walkthrough:codex -- --input <absolute-input>` |
| Record multimodal evidence | `npm run multimodal-agent:record -- --model <model> --selected-input <absolute-input>` |
| Replay a recorded multimodal run | `npm run multimodal-agent:replay -- --run <retained-run>` |
| Bind project check to a replay | `npm run multimodal-project-check -- --input <absolute-input> --replay-run <retained-run>` |
| Deterministic semantic-edit acceptance | `npm run semantic-edit-bench` |
| Execute a live semantic edit | `npm run semantic-edit-live-workflow -- --config <workflow> --host-bootstrap <bootstrap> --contract-registry <registry> --model <model>` |
| Replay edit artifacts | `npm run semantic-edit-replay -- --run <edit-artifact-root>` |

Read the live `package.json` and CLI help before adding arguments; command
contracts can evolve.

## Evidence authority

| Claim | Minimum authority |
|---|---|
| Archive/schema validity | Validator report tied to input hash |
| Block graph or static issue | Static/project-check report |
| Deterministic state transition | VM or model scenario report |
| Timing fragility | Fragility lens with severity and trace |
| Visual layout or animation | Official-browser screenshot/video |
| Sound, costume, or media behavior | Official-browser evidence with retained media |
| Edit correctness | Applied revision plus evaluation certificate |
| Reproducibility | Exact replay from retained store root |
| Export identity | Certified export path, size, and hash |

## Retention rules

- Keep source, candidate, report, screenshots/video, and replay data under one
  owned retained root.
- Preserve the exact store root expected by replay. Do not substitute a parent
  directory.
- Keep original and edited `.sb3` artifacts distinct.
- Verify hashes again immediately before returning or publishing paths.
- Treat ignored plans and stale run summaries as navigation, not proof.

## Failure routing

| Failure | Response |
|---|---|
| Retained policy hash mismatch | Recover canonical bytes or reject the run |
| Historical replay lacks a current required limit | Record incompatibility; use a fresh compatible corpus |
| Headless renderer rejects the project | Use official browser evidence |
| Replay creates agents or writes | Fail the replay contract |
| Candidate changes source bytes | Reject and recover the immutable source |
| Browser lane unavailable | Report the acceptance gap without visual claims |
