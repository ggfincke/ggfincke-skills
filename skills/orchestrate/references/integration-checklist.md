# Integration checklist

Complete this checklist for every terminal implementation result.

## Result acceptance

- Confirm status is `completed`.
- Confirm `base_sha` is the intended assignment base.
- Compare the result's requested model and effort with the approved plan binding; inspect `effective_model` when reported.
- Confirm `scope_violations` is empty.
- Inspect every changed path and the complete patch through `get_worker_artifact`.
- Confirm all required verification commands ran with exit code 0 and did not time out.
- Read provider stderr, events, model result, and verification artifacts through `get_worker_artifact` when the summary or timing looks unusual.

## Salvage gate

The blanket rule “reject failed, rejected, or unverified results” is superseded for terminal jobs by this evidence gate. Before canceling, relaunching, or discarding any non-completed job, call `get_worker_result` and inspect `status`, `error`, `failure_class`, setup and verification exit codes, `changed_files`, `patch_path`, and the `patch` artifact when needed.

- If `failure_class` is `environment` and the captured patch is intact, salvage the patch. Fix or account for the environment, verify the patch centrally, and never re-run the model merely to recover verification.
- A setup-attribution `scope` rejection proves that a later Git-visible delta overlapped a setup-attributed path. Its full base-to-final patch is salvage-only and may include setup effects; isolate and review the applicable changes centrally instead of treating that artifact as an ordinary worker patch.
- Relaunch only when no usable patch exists or the failure invalidates the patch. A `model`, `broker_fault`, `scope`, or genuine `verification` failure needs lead judgment against the captured evidence; do not infer discard or relaunch from the status alone. An attribution-unavailable `broker_fault` likewise preserves only a full salvage patch.
- Integrate a salvaged patch only after lead review and central validation. Record it as salvaged work; never relabel it `completed`.

On the first terminal failure in a wave, pause new launches, record the `failure_class`, evidence, and chosen action, then continue after triage. Unrelated read-only jobs may proceed.

## Patch review

- Verify the change satisfies the objective rather than only its local tests.
- Reconcile assumptions against the current integration checkout.
- Check interfaces shared with other work packages.
- Reject drive-by cleanup, generated debris, secrets, and unexplained dependency changes.
- Treat model-reported risks and follow-ups as review leads, not automatic deferrals.

## Integration

- Apply or merge accepted work in dependency order; use `depends_on` to encode worker sequencing.
- Resolve conflicts in the lead session; do not send workers into the same files to compete.
- Reinspect the integrated diff after conflict resolution.
- Run final repository-wide validation from the integrated checkout.
- Report any worker check that could not be reproduced after integration.

Worker-local success is necessary evidence, not release or merge readiness.

For a daemon restart, inventory with `list_workers` before relaunching anything. The daemon verifies the recorded PID and supervisor token, then terminates and durably clears that exact process identity before snapshotting: interrupted worktrees with Git-visible changes fail with a preserved salvage patch, while only a proven-clean snapshot may requeue once. If ownership or group exit cannot be confirmed, or the cleared identity cannot be persisted, daemon initialization fail-stops without snapshotting. Never launch a replacement while the original is queued or being requeued. Use `worker-broker daemon status` and `worker-broker daemon stop --when-idle` when coordinating a build upgrade.

## Attribution

When the user asks for commits, credit the harnesses that produced the work.

- One `Co-Authored-By` trailer per distinct harness whose accepted patch touched files in that commit; intersect each job's `changed_files` with the commit's paths rather than crediting the whole run everywhere. The lead session's own harness is credited too.
- Credit the harness, not the model: harness identity is always recorded, while a job that ran on a provider default may not report which model served it.
  - `Co-Authored-By: Codex <codex@openai.com>`
  - `Co-Authored-By: Claude <noreply@anthropic.com>`
  - Confirm the published identity for other harnesses before first use; never invent an address.
- Name the models in the commit body or PR description, where approximation is honest — for example `models: gpt-5.6-luna (review), claude-opus-5 (UI)`. Read them from each job's requested model and `effective_model`.
- Credit surviving work only. A rejected, failed, or fully discarded patch earns nothing; a patch the lead reworked still counts when its substance survived.
- Keep the trailer block last, one trailer per line, no blank lines inside it, or forges will not parse it.
