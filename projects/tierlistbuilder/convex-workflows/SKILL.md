---
name: convex-workflows
description: Route TierListBuilder Convex work through the current project contracts and official Convex guidance. Use in this project for backend auth, component boundaries, schema or data changes, query performance, subscriptions, OCC conflicts, function budgets, or operational diagnosis. Reviews and audits remain read-only; implementation, tests, dependencies, deployment, and data operations follow the user's approved scope.
---

# TierListBuilder Convex workflows

This project-only route replaces overlapping generated capability wrappers. It
keeps the four substantive specialist guides and their fourteen references under
one maintained entrypoint. It is not a replacement for current API documentation
or permission to run a deployment.

## Start from current authority

1. Read the target checkout's `AGENTS.md`, current diff, `package.json` and lockfile.
   Preserve unrelated staged, unstaged, untracked and ignored work.
2. Before inspecting or changing `convex/**` code, read
   `convex/_generated/ai/guidelines.md` and `convex/README.md`. Read the affected
   schema, validators, callers and existing tests; generated guidance can lag the
   installed SDK or conflict with project policy.
3. If the current host exposes a Convex expert skill, load that skill for API
   guidance. Do not assume a historical wrapper name or unavailable tool exists.
   Otherwise use [official Convex documentation](https://docs.convex.dev/) and
   installed source/generated types directly. Resolve version-sensitive conflicts
   from those sources; user authorization and project policy still control actions.
4. Classify the task as inspection, approved source change, or an explicitly
   authorized operation. State the source/deployment target and verification
   boundary before commands that can write or transmit data.

## Task routing

| Task | Read next | Owner and boundary |
|---|---|---|
| Login, identities, roles, protected functions | [Auth guide](references/auth/guide.md) | Existing Convex Auth and central project guards; provider changes need their own scope |
| Local, packaged or hybrid backend components | [Component guide](references/components/guide.md) | Isolated persistent state only when justified; preserve app auth and env ownership |
| Required fields, type changes, backfills, data reshaping | [Data-change guide](references/migrations/guide.md) | Current data posture first; no automatic compatibility or migration work |
| Slow reads, subscription cost, OCC, transaction limits | [Performance guide](references/performance/guide.md) | Diagnose one concrete flow; measure and propose before expanding implementation |
| Seed or cross-runtime contract changes | Current `seed-management` or `contract-propagation` project skill when available | Read their source authorities even if a host has not discovered the skill |

For basic queries, mutations, actions, storage or scheduling, use current official
docs and the affected project modules. Do not reinstall a large wrapper catalog
to recover a missing command name.

## Current TierListBuilder boundaries

- Auth is already configured. Preserve the caller/session checks in
  `convex/lib/security/auth.ts`, role/ownership/public-read/legal-hold guards,
  signup allowlist and account lifecycle. UI uses
  `src/features/platform/auth/model/useAuthSession.ts`; do not bypass the
  `ui -> model -> data` direction with direct Convex calls in UI components.
- Domain tables live under `convex/schema/*`; `convex/schema.ts` assembles them
  with managed auth tables. `convex/lib` is helper-only. Keep public function
  exposure intentional and validate arguments and results.
- Application env keys belong to `config/runtime-env.json` and
  `convex/convex.config.ts`, with generated `env` consumption where the project
  uses it. Preserve existing declarations and mounted components when editing
  config. Do not print populated env files, tokens, private keys or session data.
- Read `convex/README.md` and `docs/deployment.md#current-data-posture` before
  every persistence break. At the 2026-08-27 maintenance check, friends-alpha
  data was disposable: local/dev reset remained guarded; a breaking hosted
  cutover used a fresh production deployment and the release controller.
  `db:reset` must never target `prod:*`. After durability promotion, the policy
  changes to `widen -> migrate -> narrow`. Recheck; this paragraph is not a
  permanent migration policy or authorization for either path.

## Permission and scope gates

An audit, review, explanation or diagnosis reads source and reports evidence.
It does not apply suggested fixes, install helpers, add tests, create accounts,
rotate keys, publish a package, invoke mutations or change deployments.

An approved implementation changes the agreed files and behavior only. Trace
sibling paths for correctness, but propose scope expansion before changing
unrelated siblings. Add or modify tests only when requested or covered by an
approved test plan. Reuse existing dependencies; a reference mentioning a package
is not permission to install it or fetch `@latest` tooling.

Before any deployment-affecting command, verify local/cloud-dev/preview/production
identity without exposing secrets. `convex dev`, `dev --once`, many project dev
wrappers, codegen, auth initialization and component setup may write files or
contact a deployment; inspect the installed command's behavior first. A command
named `run`, `dryRun`, `codegen` or `test` is not automatically read-only.

Production release, env changes, hosted seed operations, data export/import,
reset, migration, destructive cutover, key rotation, external feedback/transcript
upload and package publication require explicit user scope and the verified
target. Use the maintained release/seed controllers; never bypass their guards
or use `git checkout -- .` as rollback. Restore only owned changes with a recovery
plan that preserves unrelated work.

## Verification and handoff

1. For documentation changes, validate links and inspect the actual diff. For
   source changes, run the current project gates for that surface, starting with
   existing focused tests. Do not run deployment commands as generic verification.
2. If an authorized operation needs codegen, inspect generated diffs and bind the
   result to the verified target. A typecheck or successful push does not prove
   login, data correctness, production health or improved performance.
3. Report the concrete changed behavior, checks and outcomes, target where
   applicable, observed metrics versus estimates, and any unverified boundary.
   Inspection ends with findings and a proposed next action, not silent repairs.

## Maintenance and provenance

The [provenance manifest](references/provenance.json) maps all eighteen adapted
Markdown bodies to their original local paths and hashes. It also records the
eight UI/icon files retained in the recovery snapshot without creating extra
discovery entries. The source is `get-convex/agent-skills`; the manifest records a
verified byte-equivalent revision, not a known historical install revision. No
general license for the skill prose was found. Keep this adapted package local
and unpublished until an applicable license or maintainer permission is established.
These references are locally maintained adaptations, checked against project
state and primary docs on 2026-08-27. Refresh only affected claims
and examples, preserve useful specialist material, and validate the complete
package after edits. Never keep nested `SKILL.md` files under `references/`.
