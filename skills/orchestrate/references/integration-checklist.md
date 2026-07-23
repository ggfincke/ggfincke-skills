# Integration checklist

Complete this checklist for every terminal implementation result.

## Result acceptance

- Confirm status is `completed`.
- Confirm `base_sha` is the intended assignment base.
- Confirm `scope_violations` is empty.
- Inspect every changed path and the complete binary patch.
- Confirm all required verification commands ran with exit code 0 and did not time out.
- Read provider stderr and event artifacts when the summary or timing looks unusual.

## Patch review

- Verify the change satisfies the objective rather than only its local tests.
- Reconcile assumptions against the current integration checkout.
- Check interfaces shared with other work packages.
- Reject drive-by cleanup, generated debris, secrets, and unexplained dependency changes.
- Treat model-reported risks and follow-ups as review leads, not automatic deferrals.

## Integration

- Apply or merge accepted work in dependency order.
- Resolve conflicts in the lead session; do not send workers into the same files to compete.
- Reinspect the integrated diff after conflict resolution.
- Run final repository-wide validation from the integrated checkout.
- Report any worker check that could not be reproduced after integration.

Worker-local success is necessary evidence, not release or merge readiness.
