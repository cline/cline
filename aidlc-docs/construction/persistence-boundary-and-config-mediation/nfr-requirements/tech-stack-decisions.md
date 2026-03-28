# Tech Stack Decisions - persistence-boundary-and-config-mediation

## Decision 1: Reuse Existing StateManager As Raw Storage Authority
- **Decision**: Keep `StateManager` as the raw persistence mechanism and build the runtime persistence boundary above it.
- **Rationale**:
  - avoids unnecessary storage rewrites in brownfield code
  - preserves current debounce, cache, and file-backed persistence behavior
  - limits migration risk while introducing runtime-aware ownership semantics

## Decision 2: Use TypeScript Runtime Projection Objects Rather Than Raw State Shapes
- **Decision**: Represent runtime-facing config and credential access through normalized projection entities such as `RuntimeConfigView` and `RuntimeCredentialRef`.
- **Rationale**:
  - decouples runtime services from raw storage key naming
  - improves testability and migration safety
  - supports later future-runtime onboarding without exposing storage internals

## Decision 3: Keep Secret Storage In Existing Secret Facilities
- **Decision**: Do not introduce a new secret backend in Unit 2.
- **Rationale**:
  - current repository already has secret handling semantics through existing state/storage infrastructure
  - Unit 2 is about boundary ownership, not replacing the underlying secret store
  - minimizes migration scope while satisfying security-baseline requirements

## Decision 4: Centralize Legacy Mapping Logic
- **Decision**: Runtime-to-legacy state and secret mappings should be centralized in dedicated boundary-layer mapping constructs.
- **Rationale**:
  - prevents drift between CLI, controller, and proto conversion behaviors
  - supports fail-closed validation and auditable migration rules
  - reduces the chance of future runtimes accidentally inheriting wrong storage bindings

## Decision 5: Treat Capability Probe Cache As Boundary-Owned Runtime Data
- **Decision**: Capability-probe cache policy belongs to the persistence boundary, not to runtime adapters or the shim layer.
- **Rationale**:
  - runtime adapters should describe execution behavior, not own persistence policy
  - cache invalidation and scope rules are part of storage correctness
  - later units need a stable ownership model for readiness checks

## Decision 6: Record Execution Metadata Separately From Config Writes
- **Decision**: Execution and probe metadata should be modeled as separate boundary-owned record streams.
- **Rationale**:
  - preserves separation of concerns
  - improves observability and failure classification
  - prevents execution-time writes from mutating user configuration state

## Decision 7: Preserve Brownfield Compatibility At The Edge
- **Decision**: Existing CLI/UI/provider-centric flows should remain valid entry points while the boundary internally shifts toward runtime-aware structures.
- **Rationale**:
  - aligns with backward UX stability requirements
  - supports incremental migration through Unit 4 and Unit 5
  - avoids a breaking cutover before the reference runtime migration is complete
