# Full-profile security lens

This reference belongs only to the full mega-review package. It is not part of core review and must never be packaged into or loaded by that workflow.

Review the authorized local codebase; do not probe production or third-party systems. Use the neutral evidence/approval protocol, keep findings tied to concrete data flow and caller/runtime constraints, and distinguish confirmed exposures from hardening suggestions. Never claim the whole application is secure.

Run five panels, using the installed `security-remediation` skill as optional specialization when available:

1. Threat model and attack surface: identify trust boundaries, entrypoints, valuable data, actors, and privilege transitions. Ground exposure in actual deployment and route/config evidence.
2. Authentication, authorization, and tenancy: follow identity from entrypoint to protected action/data, check every permission boundary, role transition, ownership lookup, and cross-tenant identifier. Client UI restrictions do not prove server authorization.
3. Input to sink: trace untrusted input through validation, canonicalization, queries, templates, filesystem paths, redirects, shell execution, and deserialization. Establish a reachable trigger and missing guard before alleging injection or traversal.
4. Secrets, crypto, configuration, and logs: inspect credential handling, secret storage/transport, cryptographic library use, cookie/session policy, error behavior, and redaction. Do not print real secrets in findings or invent cryptography.
5. Dependencies, build, and tests: inspect lockfile/runtime reachability and existing audit results, CI permissions and artifact trust, and coverage of major security boundaries. Report unavailable dependency evidence. No external exploit execution or unapproved test authoring.

For each survivor, record severity, confidence, affected files, concrete trigger and consequence, counter-evidence considered, and the smallest scoped patch plan. Proposed local regressions must be named in the test-approval dimension before authoring. Recheck fixed paths and any affected boundary within the approved scope.
