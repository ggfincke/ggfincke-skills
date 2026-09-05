# Authentication and authorization

Follow the [project workflow](../../SKILL.md) first. A review diagnoses; only an
approved implementation changes auth. Provider installation, key rotation,
account creation and deployment configuration are separate consequential steps.

## Identify the existing contract

TierListBuilder currently uses Convex Auth with the Password provider, managed
auth tables, signup allowlisting, session revocation and app user-field repair.
Read `convex/auth.ts`, `convex/auth.config.ts`, `convex/schema.ts`,
`convex/lib/security/auth.ts` and the frontend auth model before proposing setup.
Do not rerun an initializer or replace the provider to fix an isolated bug.

| Situation | Reference |
|---|---|
| Maintain the current provider | [Convex Auth](convex-auth.md) |
| User explicitly requests Clerk | [Clerk](clerk.md) |
| User explicitly requests WorkOS AuthKit | [WorkOS](workos-authkit.md) |
| User explicitly requests Auth0 | [Auth0](auth0.md) |

If the request and live repo leave the provider ambiguous, ask one provider
question before setup. Do not re-ask a choice the project or user already made.
Choose local versus hosted scope from the request, and clarify only a missing
target or consequential decision.

## Preserve identity and access control

Authentication proves who made the call; it does not prove access to a row or
operation. Derive the caller on the server and apply ownership, role, account
status, public-read, rate-limit and legal-hold policy as the operation requires.
Client-supplied user IDs may identify a requested resource, never grant access.

Reuse the project helpers rather than adding a competing auth layer:

| Operation | Existing starting point; trace its callers before use |
|---|---|
| Authenticated caller ID | `requireCurrentUserId` in `convex/lib/security/auth.ts` |
| User write subject to account and legal holds | `requireWritableUserNotHeld` |
| Admin or owner operation | `requireAdmin` / `requireOwner`, plus operation-specific policy |
| Intentionally browsable read | Existing anonymous/public-read policy; not a blanket login gate |
| UI loading/signed-out/signed-in state | `useAuthSession` in the auth model |

For example, inside an already validated app mutation, resolve the writable
caller before applying row ownership and domain policy:

```ts
const user = await requireWritableUserNotHeld(ctx)
```

This is a context fragment, not a complete endpoint. Use the actual module path,
argument/result validators and domain write owner. Direct `getAuthUserId` alone
does not replace the project's session-revocation or account-status checks.

## User records and provider boundaries

Convex Auth already manages user/auth records. Preserve `authTables` and the
existing app user-field lifecycle; do not add an external-provider-style
`storeUser` flow or parallel users table. A third-party provider may need a
separate app user record, but only when the product needs stored user data.
Use the provider's issuer-aware identity mapping; do not key globally by a
bare subject string shared across issuers.

Read [auth in functions](https://docs.convex.dev/auth/functions-auth),
[database identity mapping](https://docs.convex.dev/auth/database-auth), and
[Convex Auth authorization](https://labs.convex.dev/auth/authz) for the selected
provider. Check the installed package and generated types before copying APIs.

## Approved change workflow

1. Trace the symptom from provider session through client token transport to
   backend identity and the app guard. Keep signup, login, refresh, signout,
   revoked-session and intentionally anonymous behavior distinct.
2. Make the smallest approved source change. Preserve HTTP mounts, config env
   declarations, managed indexes and callbacks when adapting provider examples.
3. For a requested provider switch, plan account identity/linking, existing data,
   key/issuer/redirect changes, recovery and deployment cutover before writes.
   Recheck the current data posture; do not invent a compatibility migration.
4. Run existing relevant auth tests and typechecks. Add tests only when approved.
   If live sign-in verification is authorized, use a controlled account and the
   verified target; never collect credentials in chat or logs.
5. Report frontend login and backend identity separately. A build or hosted login
   page is not end-to-end auth proof; list any blocked human setup step precisely.
