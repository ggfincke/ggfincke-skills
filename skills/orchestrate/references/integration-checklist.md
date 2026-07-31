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
