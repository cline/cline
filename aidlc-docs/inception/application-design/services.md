# Services

## Runtime Orchestration Service
- **Purpose**: Core service that executes runtime requests through adapters.
- **Responsibilities**:
  - resolve runtime through registry
  - read config and credentials through persistence boundary
  - invoke shim wrapper and stream translator
  - publish translated events back to controller/control plane

## Runtime Configuration Service
- **Purpose**: Manage runtime settings, compatibility mapping, and UI persistence.
- **Responsibilities**:
  - preserve existing Claude Code UX
  - support future runtime-specific fields
  - enforce validation and migration rules

## Runtime Validation Service
- **Purpose**: Evaluate runtime readiness and future integration feasibility.
- **Responsibilities**:
  - execute capability validation
  - generate spike checklist artifacts
  - classify blocking vs non-blocking unknowns for MVP stages

## Runtime Test Harness Service
- **Purpose**: Support TDD-first and skeleton-stage tests.
- **Responsibilities**:
  - provide adapter contract fixtures
  - provide golden parser fixtures
  - provide smoke test scenarios for supported runtimes

## Service Interaction Pattern
- The control plane asks `RuntimeOrchestrationService` to execute a runtime.
- `RuntimeOrchestrationService` resolves the adapter from `RuntimeRegistry`.
- `RuntimePersistenceBoundary` loads config and credentials.
- The adapter delegates process launching to `RuntimeShimWrapper`.
- The raw runtime stream flows into `RuntimeStreamTranslator`.
- Translated events are emitted back to the control plane.
- `RuntimeValidationService` and `RuntimeTestHarnessService` support rollout readiness and regression protection.
