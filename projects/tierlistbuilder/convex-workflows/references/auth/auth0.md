# Auth0

Read the [auth guide](guide.md) and [project scope gates](../../SKILL.md) first.
Use this only for an explicitly requested Auth0 integration or an existing Auth0
app. TierListBuilder's current provider remains Convex Auth unless changed by the
user's approved plan.

Primary references: [Convex integration](https://docs.convex.dev/auth/auth0),
[Auth0 CLI](https://auth0.github.io/auth0-cli/), and
[application creation](https://auth0.github.io/auth0-cli/auth0_apps_create.html).

## Approved workflow

1. Identify the actual frontend framework, tenant, application type, deployment
   and identity cutover. Preserve existing callback, logout and allowed-origin
   settings unless the task requires changing them.
2. Use an existing authenticated CLI or the dashboard when the user authorized
   application changes. Installing a CLI or creating an application is a separate
   scoped action; do not promise it is faster or already validated end to end.
3. Complete the provider's framework setup and use its supported
   `Auth0Provider` / `ConvexProviderWithAuth0` integration. Configure backend JWT
   verification with the correct Auth0 issuer and audience/client identifier.
4. Reconcile frontend public configuration and backend server values with the
   project's env inventory. Typical names in examples include `AUTH0_DOMAIN`,
   `AUTH0_CLIENT_ID` and their Vite-prefixed public counterparts; choose one
   coherent existing contract rather than copying all aliases.
5. Verify the authorized backend config is deployed before testing token
   transport. Local and production tenants, callback URLs, logout URLs and web
   origins must match the actual host/port; do not infer production readiness.

## Token and secret handling

Follow the current SDK's refresh-token guidance and the application's storage
security policy. A docs example using localStorage is not an instruction to
change TierListBuilder's token storage unconditionally. Never log access/refresh
tokens, ask the user to paste them in chat, or move a server secret to a public
frontend env variable.

The old local pack contained a historical, incomplete refresh-token validation
report. It is not evidence that the current SDK or this project is broken.
Reproduce the actual selected configuration and distinguish failed initial
login, failed Convex validation and failed refresh. Do not invent repeated fixes
or claim the integration works while refresh remains unverified.

## Validation and human handoff

Use existing relevant tests before any live flow. For an authorized controlled
account, check signin, Convex-authenticated readiness, protected requests, refresh,
signout and the existing app authorization policy. A successful Auth0 redirect
alone does not prove backend identity.

If tenant authentication or dashboard configuration requires the user, state the
exact missing step. If a token error remains unexplained, preserve the failing
state, record safe error details and return to current official docs; do not
claim a platform-wide defect from a historical example. Report local and hosted
verification separately.
