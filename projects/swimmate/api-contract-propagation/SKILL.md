---
name: api-contract-propagation
description: "Propagate a SwimMate API contract change across the Django backend, OpenAPI schema, backend-owned generated fixtures, Swift request and response DTOs, decoding and mapping consumers, Xcode test-resource membership, and the root repository's iOS submodule pointer. Use when adding, renaming, retyping, changing the optionality or enum of, or removing an API field; changing a serializer request or response envelope; or diagnosing backend/iOS contract drift. Not for backend-only internal models, provider payloads that never cross the API, or UI-only Swift state."
---

# API Contract Propagation (SwimMate)

Treat the backend serializer and the iOS DTO as two implementations of one
current contract. Read `AGENTS.md`, `docs/architecture.mdx`, and
`docs/bruno/README.md`; then use
[references/contract-surfaces.md](references/contract-surfaces.md) to map the
specific endpoint.

## Define the contract delta

State the endpoint, HTTP direction, request or response shape, and exact
change. Decide whether the field is persisted, computed, nullable, omitted,
enum-valued, nested, paginated, or consumed by iOS/watchOS. Confirm whether a
manual Bruno flow is useful; Bruno is not the deterministic contract gate.

Plan the change across the applicable layers before editing either repository.
Preserve unrelated dirty state in both the root and `apps/ios` submodule.

## Propagate backend authority

1. Update a Django model only when persistence changes. Do not generate or
   edit migrations unless the user explicitly asks for migrations.
2. Update the request or response serializer, validation, view annotation,
   and service projection that own the public shape. Keep server-side computed
   fields out of write serializers.
3. Update enum authorities and camel/snake-case mappings at their existing
   owner; do not duplicate values in views or fixtures.
4. Regenerate and inspect the OpenAPI schema. Fix the producer or schema
   annotation when it is wrong rather than patching generated schema output.

## Refresh the backend-owned contract artifacts

Run `make api-contract-fixtures` after the backend shape is coherent. The
generator owns JSON files under
`apps/ios/SwimMateTests/Fixtures/APIContracts/`; do not hand-edit those files.
Inspect the generated delta for semantic correctness, especially omission
versus explicit `null`, enum spelling, nested arrays, and response envelopes.

The generator must also confirm that every owned fixture is present in the
`SwimMateTests` Xcode Resources phase. Filesystem presence alone does not prove
that XCTest can load a fixture.

## Propagate the Swift consumer

1. Update the matching request/response DTO and `CodingKeys` only when custom
   wire naming requires it.
2. Trace the DTO through networking services, domain conversion, stores,
   persistence snapshots, view models, and watch handoff. Update only
   consumers that depend on the changed field.
3. Preserve API decoding semantics: optional means absent or null only when
   the backend contract allows both; defaults belong at the domain boundary,
   not silently in the transport DTO.
4. Keep the iOS change committed in the submodule before updating the root
   gitlink when the user authorizes commits. Do not mix unrelated submodule
   work into the pointer update.

Treat generated contract fixtures as contract outputs that must follow the
requested shape. Do not add or modify hand-written tests unless the request or
an approved test plan includes them.

## Rename or remove

Stop emitting the old field, update generated fixtures and Swift consumers,
then remove the old backend and DTO symbols. Sweep both repositories for the
wire key, Python name, Swift name, and enum case. SwimMate is pre-1.0: prefer a
clean breaking contract over aliases, compatibility DTOs, or migration paths
unless explicitly requested.

## Verify

Run the smallest relevant backend check first, then:

```bash
make api-schema-check
make api-contract-fixtures-check
make check
make ios-style-check
```

Run `make ios-test` when full Xcode is available and the changed DTO is an iOS
consumer. If the host has only Command Line Tools, report XCTest as an
external gap instead of claiming it passed. Finish with root and submodule
`git diff --check`, status inspection, and a direct review of the generated
fixture and gitlink changes.
