# Logical Components - persistence-boundary-and-config-mediation

## 1. RuntimeConfigResolver
- **Purpose**: Materialize runtime-facing config projections from brownfield state sources.
- **Responsibilities**:
  - apply deterministic precedence across global, task, session, and remote config layers
  - map legacy provider-centric keys into runtime-aware config output
  - return normalized `RuntimeConfigView`
- **Patterns Realized**:
  - Boundary Projection Pattern
  - Deterministic Scope Resolution Pattern

## 2. RuntimeCredentialMediator
- **Purpose**: Resolve runtime-scoped credential references without leaking secret-store internals.
- **Responsibilities**:
  - validate runtime-to-secret bindings
  - return least-privilege credential references
  - emit normalized missing-credential or invalid-binding failures
- **Patterns Realized**:
  - Least-Privilege Credential Mediation Pattern
  - Fail-Closed Mapping Pattern

## 3. RuntimeCapabilityCacheStore
- **Purpose**: Own capability-probe cache partitioning and freshness rules.
- **Responsibilities**:
  - store runtime-partitioned probe state
  - apply freshness windows and invalidation triggers
  - distinguish cached-success, cached-failure, and refresh-needed states
- **Patterns Realized**:
  - Runtime-Partitioned Cache Pattern

## 4. RuntimeExecutionRecordStore
- **Purpose**: Persist execution and probe metadata as separate logical record streams.
- **Responsibilities**:
  - append execution records
  - append probe records
  - expose failure-safe write results for observability consumers
- **Patterns Realized**:
  - Append-Separated Metadata Pattern
  - Structured Boundary Telemetry Pattern

## 5. RuntimeMigrationBindingCatalog
- **Purpose**: Centralize explicit runtime-to-legacy state, secret, and proto mapping definitions.
- **Responsibilities**:
  - define approved migration bindings
  - validate that bindings are complete and non-ambiguous
  - provide auditable mapping lookup for config and credential mediation
- **Patterns Realized**:
  - Compatibility Facade Pattern
  - Fail-Closed Mapping Pattern

## 6. RuntimeConfigCompatibilityFacade
- **Purpose**: Preserve existing UI, CLI, and proto entry points while delegating boundary-aware translation internally.
- **Responsibilities**:
  - receive provider-centric read/write requests
  - invoke binding catalog and config resolver
  - return compatibility-safe outputs for legacy callers
- **Patterns Realized**:
  - Compatibility Facade Pattern
  - Deterministic Scope Resolution Pattern

## 7. RuntimeBoundaryTelemetryEmitter
- **Purpose**: Emit structured non-secret operational signals from the persistence boundary.
- **Responsibilities**:
  - classify config resolution, credential resolution, cache events, and metadata writes
  - attach runtime ID, scope, and failure type context
  - enforce sensitive-field exclusion
- **Patterns Realized**:
  - Structured Boundary Telemetry Pattern

## 8. RuntimeBoundaryTestFixtureSurface
- **Purpose**: Provide stable seams for ownership, mapping, cache, and metadata tests.
- **Responsibilities**:
  - expose deterministic fixture entry points
  - support TDD-first skeleton tests
  - isolate boundary assertions from later shim and runtime execution complexity
- **Patterns Realized**:
  - TDD-Ready Ownership Pattern

## Interaction Model
- `RuntimeConfigCompatibilityFacade` receives provider-centric or runtime-aware requests.
- `RuntimeMigrationBindingCatalog` determines valid mapping rules.
- `RuntimeConfigResolver` and `RuntimeCredentialMediator` produce bounded runtime-facing outputs.
- `RuntimeCapabilityCacheStore` and `RuntimeExecutionRecordStore` manage boundary-owned persisted or cached state.
- `RuntimeBoundaryTelemetryEmitter` records structured boundary events.
- `RuntimeBoundaryTestFixtureSurface` provides the seam for later ownership and regression tests.
