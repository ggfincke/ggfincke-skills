# Clerk

Read the [auth guide](guide.md) and [project scope gates](../../SKILL.md) first.
This is a conditional provider reference. TierListBuilder currently uses Convex
Auth; opening this file does not authorize switching to Clerk.

Primary references: [Convex integration](https://docs.convex.dev/auth/clerk) and
[Clerk integration](https://clerk.com/docs/guides/development/integrations/databases/convex).

## Approved setup or provider switch

1. Confirm the requested Clerk application, framework, local/hosted target and
   identity/data cutover. Reuse an existing account/application when appropriate;
   do not create accounts or change plans without the corresponding request.
2. Follow the framework-specific current integration. Clerk's provider must
   surround `ConvexProviderWithClerk`; its `useAuth` adapter supplies token
   transport. A raw hook passed to `convex.setAuth` is not the provider pattern.
3. Verify the issuer and audience accepted by `convex/auth.config.ts` and the
   Clerk Convex integration. Distinguish frontend publishable keys from server
   secrets; do not invent new env names outside `config/runtime-env.json`.
4. Keep Next.js client/server wrapper requirements separate from this project's
   Vite setup. Preserve the app's model/data boundary and existing authorization
   policy while adapting transport.
5. Deploy only through the approved target workflow and verify both Clerk login
   and Convex's authenticated state before calling the integration complete.

## Values and dashboard steps

The Clerk dashboard owns account/application creation, integration activation,
API keys and issuer configuration. Use its current integration guide rather
than assuming an old dashboard URL or key-page layout still exists.

Common guide names include `CLERK_JWT_ISSUER_DOMAIN`, a Clerk Frontend API URL,
`VITE_CLERK_PUBLISHABLE_KEY` and framework-specific server secret names. Inspect
the chosen SDK/version and environment contract; do not duplicate issuer values
under competing names or expose server keys in Vite/public variables.

Have the user enter secrets into the approved local/provider store. Inspect only
safe presence, issuer/audience and public redirect metadata needed for the task;
do not request a secret key in a chat question.

## Diagnosis and validation

Use Convex-authenticated state, not merely a Clerk session, to decide whether
Convex-backed requests are ready. In TierListBuilder, preserve the auth model
facade rather than making each UI component manage provider tokens.

If login works but Convex rejects a token, inspect issuer/audience, integration
activation, backend config deployment and token freshness. After integration
changes, a controlled signout/new signin can distinguish an old token from
current configuration; do not force signout of unrelated user sessions.

Check authenticated queries and the app's owner/role/revocation behavior, not just
the hosted login page. Dev and production issuers, publishable keys and redirect
URLs may differ. Production configuration is only in scope when requested.
Record refresh/signout and any remaining human verification boundary.
