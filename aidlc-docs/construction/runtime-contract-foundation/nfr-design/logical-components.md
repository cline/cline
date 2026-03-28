# Logical Components - runtime-contract-foundation

## Runtime Definition Catalog
- **Purpose**: Hold canonical runtime definitions and aliases.
- **Pattern Support**:
  - registry pattern
  - deterministic resolution pattern
- **Responsibilities**:
  - maintain canonical runtime records
  - expose alias lookup map

## Runtime Registration Validator
- **Purpose**: Enforce schema-valid registration at onboarding time.
- **Pattern Support**:
  - schema validation pattern
  - fail-closed selection pattern
- **Responsibilities**:
  - validate adapter shape
  - validate capability schema
  - reject invalid or incomplete registrations

## Legacy Mapping Resolver
- **Purpose**: Translate old provider-centric state into runtime-centric identity.
- **Pattern Support**:
  - compatibility mediation pattern
  - deterministic resolution pattern
- **Responsibilities**:
  - map current Claude Code configuration deterministically
  - expose mapping provenance and migration notes

## Runtime Selection Engine
- **Purpose**: Resolve the requested runtime for orchestration.
- **Pattern Support**:
  - registry pattern
  - fail-closed selection pattern
  - deterministic resolution pattern
- **Responsibilities**:
  - normalize runtime ID
  - resolve runtime definition
  - return ready or blocked selection result

## Capability Gate
- **Purpose**: Confirm that requested runtime features are explicitly supported.
- **Pattern Support**:
  - schema validation pattern
  - fail-closed selection pattern
- **Responsibilities**:
  - compare requested capabilities with declared capabilities
  - generate blocked reasons for unsupported requests

## Persistence Boundary Facade
- **Purpose**: Reference externalized state without coupling the contract layer to storage details.
- **Pattern Support**:
  - boundary isolation pattern
- **Responsibilities**:
  - provide config and credential references
  - avoid direct state-store knowledge in runtime contract logic

## Runtime Decision Logger
- **Purpose**: Record structured runtime-selection outcomes.
- **Pattern Support**:
  - structured observability pattern
- **Responsibilities**:
  - emit structured events for selection path, blocked reasons, and resolution source
  - exclude sensitive values

## Contract Test Fixture Surface
- **Purpose**: Expose predictable seams for TDD-first implementation.
- **Pattern Support**:
  - TDD-ready contract pattern
- **Responsibilities**:
  - make registration, collision, alias, capability, and migration outcomes fixture-testable

## Logical Flow
1. `Runtime Selection Engine` receives a selection request.
2. `Legacy Mapping Resolver` translates legacy provider IDs if needed.
3. `Runtime Definition Catalog` resolves the canonical runtime definition.
4. `Runtime Registration Validator` verifies structural validity.
5. `Capability Gate` checks the requested capability set.
6. `Persistence Boundary Facade` supplies config references where needed.
7. `Runtime Decision Logger` emits the final outcome.
