# Security Remediation - Usage

Ready-made prompts for the `security-remediation` skill. The first-turn variants start a single-PR security task with a concrete scope (better than "audit the whole repo"). The follow-up prompts steer the work after the first findings report. Fill in the `[BRACKETED]` parts.

## First-turn scope variants

### A. Endpoint or feature hardening

```
Review the authentication and authorization behavior for [FEATURE / ENDPOINTS].
Focus on whether a user can access or mutate another user's or tenant's resources
through direct IDs, alternate routes, background jobs, or helper methods. Start with
an approval-gated security report and patch plan; do not edit files until I approve
specific findings.
```

### B. Injection / data-flow review

```
Review [MODULE / FLOW] for unsafe handling of attacker-controlled input. Trace request
params, body fields, headers, uploaded content, stored user content, and config-derived
values into database queries, shell commands, filesystem paths, template/rendering code,
redirects, outbound requests, and logs. Start with an evidence-based findings report and
minimal patch plan; do not edit files yet.
```

### C. File upload / download safety

```
Review the file upload, storage, and download path for [FEATURE]. Focus on path
traversal, dangerous file types, content-type trust, size limits, archive extraction,
storage key generation, authorization on downloads, and accidental public exposure.
Start with a security findings report and patch plan; wait for approval before editing.
```

### D. Webhook / API integration safety

```
Review the [WEBHOOK / THIRD-PARTY API INTEGRATION] implementation for signature
verification, replay protection, timestamp tolerance, idempotency, secret handling,
logging, SSRF risks, and unsafe trust of provider-controlled payload fields. Produce an
approval-gated findings report and minimal patch plan before making changes.
```

### E. Dependency / supply-chain remediation

```
Review the direct dependencies used by [SCOPE] for reachable security risk. Do not
propose broad upgrades. Identify only vulnerabilities that are reachable or plausibly
reachable from this code path, explain impact, and propose the smallest safe remediation,
including lockfile/test changes if needed. Wait for approval before editing.
```

## Follow-up prompts after the first report

These match the approval-gated reviewer style better than generic steering.

### Approve one finding

```
Implement Finding [N] only. Keep the fix at the existing trust boundary if possible, use
the codebase's existing validation/auth utilities, and add regression tests for both the
malicious case and a legitimate allowed case. Do not include unrelated cleanup or broader
hardening.
```

### Push back on overbroad remediation

```
The proposed fix is too broad for this PR. Rework the plan so it closes the specific
source-to-sink path you identified without changing unrelated APIs, dependency versions,
or shared abstractions. Keep any optional hardening as a separate follow-up.
```

### Demand stronger evidence

```
Before editing, tighten the evidence for Finding [N]. Show the exact attacker-controlled
input, the path it takes through the code, the sink or missing enforcement point, and why
the existing guard does not stop it. If you cannot prove exploitability, downgrade it to
hardening or a non-finding.
```

### Add missing negative tests

```
The code change looks reasonable, but the tests do not prove the security invariant. Add a
regression test that would have failed before the fix and now passes, plus a legitimate
request that still succeeds. Keep the tests consistent with the repo's existing fixtures
and style.
```

### Tenant / authz-specific follow-up

```
Please verify this fix at the object-authorization level, not just the route level. Add
coverage showing that a user with valid authentication but the wrong tenant/resource
relationship is denied, while the rightful owner or authorized role still succeeds.
```

### Secrets / logging-specific follow-up

```
The remediation should also cover accidental leakage. Make sure the sensitive value is not
returned in API responses, not written to logs, and not exposed through error messages.
Add or update tests around redaction if the repo has an existing logging/test pattern.
```
