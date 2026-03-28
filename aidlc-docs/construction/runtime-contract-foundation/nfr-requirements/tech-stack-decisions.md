# Tech Stack Decisions - runtime-contract-foundation

## Decision Context
This unit is technology-aware but should remain implementation-neutral where possible. The goal is to constrain later implementation choices so they fit the approved architecture.

## Chosen Constraints

### 1. Preserve TypeScript-centered implementation
- **Decision**: Keep the runtime contract foundation in the existing TypeScript architecture.
- **Rationale**:
  - the current codebase is TypeScript-centric
  - shared typing is critical for runtime identity, capabilities, and validation contracts
  - introducing a second language here would increase migration complexity

### 2. Prefer schema-validated contract objects
- **Decision**: Runtime definitions, capability declarations, and migration mappings should use schema-validated structures.
- **Rationale**:
  - this reduces ambiguity in future runtime onboarding
  - it supports explicit blocking validation for malformed definitions

### 3. Preserve current storage stack behind a boundary
- **Decision**: Continue using the current storage model, but hide it behind the runtime persistence boundary.
- **Rationale**:
  - this minimizes migration cost
  - it allows user-facing config stability while internal ownership is refactored

### 4. Keep runtime selection deterministic and in-process
- **Decision**: Runtime registry and resolution logic should remain in-process and lightweight.
- **Rationale**:
  - the contract foundation is part of the control plane
  - this logic should not require process spawning or remote calls

### 5. Treat `gh` as a later candidate, not a baseline design driver
- **Decision**: `gh` must not shape the core contract in ways that weaken the baseline runtime model.
- **Rationale**:
  - it is explicitly a todo-grade later candidate
  - Kiro CLI and custom LangGraph CLI are more meaningful runtime expansion targets for immediate architecture planning

### 6. Make Claude Code the compatibility reference
- **Decision**: Claude Code remains the mandatory compatibility benchmark for this unit.
- **Rationale**:
  - it is the active external runtime already in the system
  - regression risk is highest here

### 7. Design for TDD-first skeleton implementation
- **Decision**: Contracts must be shaped so later code generation can start from test fixtures and skeleton interfaces.
- **Rationale**:
  - the approved requirements explicitly require TDD-oriented design and skeleton-stage test application

## Rejected or Deferred Choices
- **Do not** introduce runtime-specific assumptions into the shared contract foundation.
- **Do not** use `gh` as a primary capability driver.
- **Do not** bind the contract foundation directly to process execution concerns; those belong in later shim-wrapper units.
