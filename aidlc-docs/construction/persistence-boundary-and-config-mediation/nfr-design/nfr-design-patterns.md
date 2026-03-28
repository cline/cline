# NFR Design Patterns - persistence-boundary-and-config-mediation

## 1. Boundary Projection Pattern
- **Purpose**: Prevent runtime execution paths from coupling directly to raw storage shapes.
- **NFRs Addressed**:
  - maintainability
  - testability
  - scalability
- **Design Use**:
  - raw state and secret storage remain inside `StateManager`
  - runtime-facing callers receive normalized projection objects such as `RuntimeConfigView` and `RuntimeCredentialRef`
  - later runtimes extend projection definitions rather than reading storage keys directly

## 2. Least-Privilege Credential Mediation Pattern
- **Purpose**: Restrict credential access to runtime-scoped needs only.
- **NFRs Addressed**:
  - security
  - reliability
  - maintainability
- **Design Use**:
  - credential resolution is centralized in a dedicated boundary component
  - runtime services never receive unrestricted secret-store access
  - missing or invalid credential bindings fail closed

## 3. Deterministic Scope Resolution Pattern
- **Purpose**: Preserve brownfield precedence while making runtime-aware config reads predictable.
- **NFRs Addressed**:
  - reliability
  - usability
  - performance
- **Design Use**:
  - global state, task settings, session overrides, and remote config are merged through one deterministic resolver
  - runtime-aware reads may reshape the output but do not reorder precedence rules

## 4. Runtime-Partitioned Cache Pattern
- **Purpose**: Isolate capability-probe cache data by runtime identity and freshness.
- **NFRs Addressed**:
  - scalability
  - reliability
  - performance
- **Design Use**:
  - cache keys include runtime identity and relevant scope
  - stale probe results degrade to refresh-needed state
  - cache reuse across `claude-code`, `kiro-cli`, `gh`, and `custom-langgraph-cli` is forbidden unless explicitly modeled

## 5. Append-Separated Metadata Pattern
- **Purpose**: Keep execution and probe metadata separate from user configuration state.
- **NFRs Addressed**:
  - observability
  - reliability
  - maintainability
- **Design Use**:
  - metadata writes are modeled as separate record streams
  - failures in metadata persistence do not silently mutate config state
  - downstream observability can classify execution and probe events independently

## 6. Compatibility Facade Pattern
- **Purpose**: Preserve existing UI, CLI, and proto entry points while the architecture shifts to runtime-aware boundaries.
- **NFRs Addressed**:
  - usability
  - backward compatibility
  - maintainability
- **Design Use**:
  - provider-centric writes and reads terminate at a compatibility facade
  - the facade delegates translation to explicit migration bindings
  - future cutover can change the inside of the facade without breaking current UX

## 7. Fail-Closed Mapping Pattern
- **Purpose**: Prevent ambiguous runtime-to-legacy mapping or secret binding from silently working incorrectly.
- **NFRs Addressed**:
  - security
  - reliability
  - testability
- **Design Use**:
  - unsupported mappings raise normalized boundary errors
  - future runtimes without approved bindings do not inherit unrelated config or secrets
  - mapping validation is explicit and auditable

## 8. Structured Boundary Telemetry Pattern
- **Purpose**: Make persistence-boundary behavior observable without exposing sensitive data.
- **NFRs Addressed**:
  - observability
  - security
  - maintainability
- **Design Use**:
  - config resolution, credential resolution, cache hit/miss, invalidation, and metadata write events are emitted as structured categories
  - telemetry includes runtime ID, scope, source, and failure reason
  - secrets and secret-bearing fields are excluded from logs

## 9. TDD-Ready Ownership Pattern
- **Purpose**: Make ownership rules directly testable before full implementation.
- **NFRs Addressed**:
  - testability
  - maintainability
- **Design Use**:
  - projection, mapping, cache, and metadata boundaries are designed as fixture-friendly seams
  - later units can write ownership tests without invoking full runtime execution stacks
