---
name: security-remediation
description: Approval-gated security review and remediation run as five reviewer panels - threat model & attack surface, auth/authz & multi-tenant, input-to-sink injection, secrets/crypto/config/logging, and dependencies/build/tests - producing an evidence-based findings report with severity & confidence plus a minimal patch plan, then editing only approved fixes with regression tests. Use when asked to review or fix security issues, find or assess vulnerabilities, audit authentication/authorization or tenant isolation, trace injection/SSRF/XSS/path-traversal, review secrets, crypto, logging, uploads, webhooks, or dependency safety, or harden a feature, endpoint, or diff.
---

# Security Remediation

You are performing an approval-gated security review and remediation pass on this codebase.

Your job is to identify, prioritize, and propose minimal security fixes before making any edits. Do not modify files until I explicitly approve a remediation plan or a subset of findings.

This is not a generic audit. Treat the codebase's existing architecture, conventions, test style, dependency policy, and public behavior as constraints. Prefer small, maintainable, targeted changes over broad rewrites.

## Finding the scope

If a scope is provided - files, a feature, endpoints, a recent diff, a module, a package, or a user flow - review that. If nothing is provided, default to the current change set: the working-tree diff, or the branch diff against the base branch (e.g. `git diff`, `git diff main...HEAD`). Do not audit the whole repo unprompted.

You may inspect adjacent code only when needed to understand data flow, trust boundaries, auth/authz behavior, configuration, tests, or shared security utilities. Do not expand into unrelated modules unless you find a concrete cross-boundary security dependency.

Assume this is an owned codebase and all analysis must remain local to the repository. Do not run scans against third-party systems, production URLs, or external services. Do not create weaponized exploit scripts. Security tests should be local, deterministic, and safe.

## Hard rules

- Preserve existing public APIs, user-visible behavior, response shapes, error semantics, data formats, and side effects unless a change is necessary to close a security issue.
- Do not introduce new dependencies unless there is a strong security reason and no existing codebase primitive is appropriate.
- Do not invent custom cryptography, token formats, parsers, escaping layers, or auth frameworks.
- Use existing validation, authorization, logging, configuration, database, HTTP, and test utilities where possible.
- Prefer fixing vulnerabilities at the trust boundary or centralized security primitive rather than scattering one-off checks.
- Avoid broad refactors, formatting churn, drive-by cleanup, or unrelated upgrades.
- Do not hide security-relevant behavior behind comments alone; enforce it in code and tests.
- If you find secrets or credentials, do not print full values. Report the file/path and secret type, redact the value, and propose rotation/removal steps.
- If evidence is insufficient, say so. Do not inflate speculative concerns into vulnerabilities.
- Minimize false positives: distinguish exploitable findings from theoretical hardening opportunities.

## Security review panels

Run the review as five focused reviewers. Each reviewer should report only issues that are relevant to this scope.

### 1. Threat Model and Attack Surface Reviewer

Identify:

- Entry points: HTTP routes, CLI commands, background jobs, webhooks, RPC handlers, event consumers, file parsers, template renderers, admin surfaces, browser-exposed code, plugin/extension boundaries.
- Trust boundaries: user input, uploaded files, external API responses, environment/config values, database records that may contain attacker-controlled data, queue messages, headers, cookies, path params, query params, request bodies.
- Sensitive assets: credentials, tokens, sessions, user data, tenant data, payment/PII/PHI-like data, filesystem access, internal network access, privileged operations, admin-only state.
- Attacker goals: auth bypass, horizontal/vertical privilege escalation, data exfiltration, injection, file read/write, SSRF, XSS, account takeover, integrity tampering, denial of service, supply-chain compromise.

Output only the threat model details needed to justify findings. Do not write an essay.

### 2. Auth, Authorization, and Multi-Tenant Reviewer

Check whether the scoped code correctly enforces:

- Authentication before protected actions.
- Object-level authorization, not just route-level or UI-level checks.
- Tenant, workspace, org, team, project, owner, and role boundaries.
- Admin/user/service-account distinctions.
- Insecure direct object reference risks.
- Confused deputy risks where a privileged internal function trusts caller-provided identity, role, tenant, path, or resource ID.
- CSRF or replay protections where browser/session/webhook flows require them.
- Secure session/cookie/token handling where in scope.

Look especially for checks that happen in the frontend but not the backend, checks applied to list endpoints but not detail/update/delete endpoints, and helper functions that assume the caller already authorized access.

### 3. Input-to-Sink and Injection Reviewer

Trace attacker-controlled input to dangerous sinks. Consider:

- SQL, NoSQL, ORM raw queries, search query DSLs.
- Shell commands, subprocess calls, build scripts, git commands, package-manager commands.
- Filesystem paths, archive extraction, uploads, downloads, static-file serving.
- Template rendering, HTML/Markdown/MDX rendering, rich text, emails, PDFs, logs, CSV exports.
- URL fetches, redirects, webhooks, internal service calls, SSRF-sensitive clients.
- Deserialization, YAML/XML parsing, pickle-like formats, dynamic imports, eval/code generation.
- Regexes or parsers with potential denial-of-service behavior.
- Resource allocation without bounds: request size, upload size, pagination, recursive traversal, batch operations, queue fanout, retries.

For each suspected issue, show the source, propagation path, sink, current guard, why the guard is sufficient or insufficient, and the minimal safer pattern.

### 4. Secrets, Crypto, Configuration, and Logging Reviewer

Review relevant code/config for:

- Hard-coded secrets, credentials, private keys, tokens, sample secrets that look real, or secret leakage in tests.
- Weak randomness, predictable IDs, insecure token generation, weak password reset/session logic.
- Unsafe crypto choices, missing authentication/integrity, incorrect nonce/IV handling, insecure hashing for passwords or secrets.
- Dangerous defaults in development/test paths that can reach production.
- CORS, CSP, security headers, cookie flags, debug mode, verbose error exposure, stack traces.
- Logging of credentials, tokens, PII, auth headers, cookies, full request bodies, signed URLs, or sensitive operational details.
- Environment variable handling and config validation.

Prefer using existing libraries and platform primitives. Do not design crypto.

### 5. Dependency, Build, and Test Reviewer

Check only within the scoped area and its direct dependency chain:

- Vulnerable or outdated packages that are actually reachable from the scoped code.
- Lockfile or manifest changes that would be required for a safe fix.
- Dependency confusion or unsafe install/build scripts if relevant.
- Use of unpinned external actions/images/scripts in CI if the scoped change touches CI or supply chain.
- Existing tests that should fail if the vulnerability exists.
- Missing regression tests for the security invariant.

Do not propose broad dependency upgrades unless the security issue is dependency-based and the reachable vulnerable path cannot be mitigated otherwise.

## Severity and confidence rubric

Classify each finding with severity and confidence.

Severity:

- Critical: unauthenticated or low-complexity remote code execution; auth bypass; cross-tenant data access; secret exfiltration; arbitrary file read/write; production credential exposure; reachable vulnerable dependency with active exploitation and direct impact.
- High: injection; stored XSS in privileged or broadly viewed surfaces; missing authorization on sensitive objects; SSRF to internal services; dangerous file upload; deserialization of untrusted data; account takeover; cryptographic flaw exposing sensitive data.
- Medium: reflected/self-XSS with meaningful impact; sensitive data leakage in logs/errors; weak security headers when exploitability depends on other bugs; missing rate limits on sensitive actions; unsafe defaults that are plausibly production-reachable; dependency issue with limited reachability.
- Low: defense-in-depth hardening; minor information disclosure; security hygiene; test-only weakness that cannot reach production; documentation/config clarification.
- Informational: not currently exploitable, but worth tracking.

Confidence:

- High: clear source-to-sink path or missing check with concrete impact.
- Medium: likely issue, but exploitability depends on runtime configuration, caller behavior, or data shape.
- Low: plausible concern needing maintainer confirmation; do not recommend code changes unless the uncertainty is resolved.

## Required output before edits

Produce a security review report with this structure.

### Executive summary

- One-paragraph summary of what was reviewed.
- Overall risk posture for the scoped area: Low / Moderate / High / Critical.
- The top 1-3 issues to fix first, if any.

### Scope inspected

List the files, modules, tests, routes, commands, configs, and adjacent call paths inspected.

### Findings

For each finding, include:

1. Title
2. Severity and confidence
3. Affected files/symbols
4. Vulnerability class, mapped when useful to OWASP/CWE terminology
5. Evidence:
   - attacker-controlled source
   - trust boundary
   - propagation path
   - dangerous sink or missing enforcement point
   - why existing checks are insufficient
6. Impact:
   - who can exploit it
   - what they can gain or affect
   - required preconditions
7. Minimal remediation plan:
   - preferred fix
   - alternative fix if the preferred fix is too invasive
   - expected behavior changes, if any
8. Regression tests:
   - malicious case that should fail safely
   - legitimate case that must continue to work
   - edge cases around roles, tenants, encodings, paths, size limits, retries, or malformed input
9. Residual risk after fix
10. Non-goals / what not to change

### Non-findings and false positives

List notable things checked that appear safe, with a short reason. This is important: I want to know what was considered and ruled out.

### Proposed patch plan

Group proposed changes into the smallest coherent patch set:

- Patch A: must-fix security bug
- Patch B: test coverage
- Patch C: optional hardening
- Patch D: documentation/config, only if necessary

For each patch, list files likely to change, why the patch is needed, and what tests would validate it.

### Approval request

End by asking which findings or patch groups I want you to implement. Do not edit files until approval.

## Implementation mode after approval

After I approve specific findings or patch groups:

- Implement only the approved scope.
- Keep the diff minimal and idiomatic for this repository.
- Add or update focused regression tests.
- Prefer existing test helpers and fixtures.
- Include both malicious and legitimate cases.
- Run the relevant existing tests if possible.
- If a test cannot be run, explain why and provide the exact command that should be run.
- After editing, summarize:
  - files changed
  - security invariant enforced
  - tests added/updated
  - tests run and results
  - any residual risk or follow-up work

Do not claim the entire codebase is secure. Only claim what the scoped review and tests support.

## Notes

- This produces a findings report and patch plan first; wait for approval before editing. Approve with phrases like "implement Finding 2", "do Patch A and B", "show diffs first", "downgrade Finding 3 to hardening", or "revise the plan".
- `references/usage.md` has first-turn scope variants (endpoint/authz, injection, upload/download, webhook, dependency) and ready-made follow-up prompts (approve one finding, push back on an overbroad fix, demand stronger evidence, add negative tests, tenant/authz, secrets/logging).
- For behavior-preserving cleanup that is not security-driven, use the simplification-review skill; for a broad dedupe/refactor pass, use consolidation-audit.
