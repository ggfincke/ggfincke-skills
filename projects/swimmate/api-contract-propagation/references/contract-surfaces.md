# SwimMate API Contract Surfaces

## Backend authorities

| Concern | Path family |
|---|---|
| Persistence | `apps/backend/apps/<domain>/models.py` |
| Request/response serializers | `apps/backend/apps/<domain>/api/serializers/` |
| Views and OpenAPI annotations | `apps/backend/apps/<domain>/api/views/` |
| Shared serializer behavior | `apps/backend/common/api/serializers/` |
| Enum and domain constants | Existing domain owner under `apps/backend/` |
| OpenAPI verification | `tools/check_openapi_schema.py` and `.sh` |
| Fixture generation | `tools/generate_api_contract_fixtures.py` |

Do not infer a wire contract from a model alone. Trace the serializer and view
that actually serve the endpoint.

## iOS authorities

| Concern | Path family |
|---|---|
| Transport DTOs | `apps/ios/SwimMate/Networking/DTOs/` |
| API services | `apps/ios/SwimMate/Networking/Services/` |
| Domain models | `apps/ios/SwimMate/Model/` |
| Persistence | `apps/ios/SwimMate/Persistence/` |
| State and UI projection | `apps/ios/SwimMate/ViewModel/`, `iOSViews/` |
| Contract fixtures | `apps/ios/SwimMateTests/Fixtures/APIContracts/` |
| Fixture decoding coverage | `apps/ios/SwimMateTests/DTOTests/APIContractDTOTests.swift` |
| Xcode resource ownership | `apps/ios/SwimMate.xcodeproj/project.pbxproj` |

## High-risk semantics

- Django `required`, `allow_null`, `read_only`, and serializer defaults do not
  map automatically to the same Swift optionality.
- A computed response field may require OpenAPI typing even when it has no
  model field.
- Swift enum raw values must match the wire exactly.
- Fixture JSON must represent real serializer output, not a hand-invented
  example.
- Root and iOS statuses are independent because `apps/ios` is a Git submodule.

## Gate interpretation

- `make api-schema-check` validates the generated OpenAPI surface.
- `make api-contract-fixtures-check` verifies fixture bytes and Xcode resource
  membership.
- `make check` adds backend formatting, lint, type, schema, fixture, and Xcode
  target checks.
- `make ios-style-check` is available on more hosts than full XCTest.
- `make ios-test` is authoritative only when the host has a viable full Xcode
  environment.
