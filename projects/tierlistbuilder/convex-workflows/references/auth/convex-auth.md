# Convex Auth

Read the [auth guide](guide.md) and [project scope gates](../../SKILL.md) first.
TierListBuilder already uses Convex Auth; maintain that integration unless the
user explicitly requests a provider change. Do not reinitialize working auth.

Primary references: [overview](https://docs.convex.dev/auth/convex-auth),
[setup](https://labs.convex.dev/auth/setup),
[manual setup](https://labs.convex.dev/auth/setup/manual), and
[authorization](https://labs.convex.dev/auth/authz).

## Existing integration

Read the actual provider configuration, auth HTTP mounts, schema assembly,
frontend transport and app guard layer. In this project, preserve the Password
provider, server-side signup allowlist, `afterUserCreatedOrUpdated` repair path,
managed auth tables/indexes, session revocation and account/legal policies.
Signing in must not silently lose those protections.

Do not add a parallel `users` table or generic external-provider `storeUser`
flow. Convex Auth supplies managed tables; TierListBuilder's app fields extend
that existing ownership. Direct identity access is useful for diagnosis, but
production paths use the project's central guards.

## If new setup is explicitly requested

1. Determine the requested methods: passwords/reset, OAuth, magic links or OTP.
   Do not add methods the user did not request. Check current provider support
   for the actual framework rather than assuming every SSR framework is covered.
2. Inspect the package/lockfile and installed peer requirements. At maintenance,
   this project had `@convex-dev/auth` 0.0.95 and `@auth/core` 0.41.3; the auth
   package required `@auth/core ^0.41.1`. The old reference's 0.37.0 pin is not a
   valid default here. Use current compatible versions only when dependency
   changes are in scope.
3. Establish the explicit deployment target before initializer or CLI setup.
   The documented initializer can change files and key/config state; the
   documented manual path is also available. Neither is a mandatory rerun for
   every auth change. Preserve existing config and key material.
4. Verify `convex/auth.config.ts`, `auth.ts`, HTTP routes, required auth tables,
   selected sign-in methods and frontend `ConvexAuthProvider` integration. Merge
   into existing files; do not replace the project's HTTP router or schema.
5. Only deploy/configure the target the user authorized. Production issuer,
   redirect and key values are a separate environment decision, not implied by
   successful local setup.

## Secrets and human setup

Keep private keys and secrets out of chat, command arguments, generated examples,
logs and screenshots. Have the user enter them through the approved local or
provider secret channel, then verify presence/configuration without printing
values. Do not dump `env list` output as a diagnostic shortcut.

If provider login or deployment selection requires human interaction, state the
exact step and why it blocks the authorized work. Do not select an anonymous or
different deployment to bypass that boundary.

## Validation

Verify initial sign-in, backend authenticated identity, loading state, signout,
refresh and the relevant revoked/forbidden paths using existing tests first.
An empty `providers: []` can coexist with a successful build; codegen or a push
does not prove login works. Browser verification uses a controlled account and
the authorized target; otherwise give a short manual checklist and mark the
runtime boundary unverified. Do not broaden a local fix to production setup.
