# WorkOS AuthKit

Read the [auth guide](guide.md) and [project scope gates](../../SKILL.md) first.
This reference preserves the WorkOS option; it does not authorize changing the
current Convex Auth integration or provisioning a WorkOS organization.

Primary references: [overview](https://docs.convex.dev/auth/authkit/),
[existing app](https://docs.convex.dev/auth/authkit/add-to-app), and
[automatic configuration](https://docs.convex.dev/auth/authkit/auto-provision).

## Choose the ownership model

Determine whether the approved task uses an existing WorkOS team or a
Convex-managed team. Team/application/environment creation and invitations have
real access and possibly billing effects. Preserve an existing tenant model and
ask only when the choice is unresolved.

For managed provisioning, `convex.json` can define AuthKit configuration for the
actual framework and target environments. Treat the selected `authKit` config,
redirect URIs, homepage and allowed origins as one contract. Do not assume all
manual/existing-team integrations require the same auto-provisioning fields.

## Approved setup sequence

1. Read the current existing-app branch and identify the framework, actual
   frontend port, tenant/team and deployment. A fallback Vite port can make an
   otherwise valid hosted callback point at the wrong local application.
2. Change `convex.json` only for the selected configuration model. Managed
   `convex dev` onboarding can provision environments and write `.env.local`;
   it is not a read-only diagnostic or a workaround for absent authorization.
3. Configure the selected SDK/provider and JWT verification in
   `convex/auth.config.ts`. Use the supported Convex AuthKit adapter for token
   transport; a provider session alone is not a Convex-authenticated session.
4. Reconcile backend secrets and frontend public IDs/redirects with the project
   env inventory. Common names include `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`,
   `WORKOS_COOKIE_PASSWORD` and framework-specific redirect variables. Do not
   expose secret API keys or cookie passwords to Vite/public variables.
5. Deploy or provision only the explicitly authorized target. Validate callback,
   signin, backend identity, refresh and signout; keep the existing application
   account/ownership policy intact.

## User storage and environment separation

Add an app-level user record or synchronization flow only if the product needs
one, and plan its identity/cutover contract. Do not add a second users model while
retaining Convex Auth's managed records without an explicit migration decision.

Dev, preview and production can require different IDs, keys and redirects. Do
not copy a working local secret or tenant to production automatically. Use the
approved secret-entry channel and verify values are configured without printing
them. If an interactive onboarding step is required, hand that exact step to the
user; do not create a different environment to bypass it.

## Verification

Confirm the real callback host/port, selected `convex.json` branch, deployed
JWT config and Convex-authenticated backend requests. A loaded WorkOS page or a
successful redirect is partial evidence. Record which environments were checked
and which require a human action; production is not included unless requested.
