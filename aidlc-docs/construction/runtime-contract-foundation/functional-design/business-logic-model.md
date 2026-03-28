# Business Logic Model - runtime-contract-foundation

## Purpose
This unit defines the logic that governs how runtimes are described, registered, resolved, and validated before any runtime-specific invocation occurs.

## Core Workflow
1. A control-plane request identifies or implies a target runtime.
2. The runtime ID is normalized to a canonical runtime identity.
3. The runtime registry resolves the matching runtime adapter definition.
4. The system validates that the runtime definition declares required capabilities and contracts.
5. The orchestration layer determines whether the runtime is:
   - ready for execution
   - requires capability probe
   - blocked due to incomplete configuration or unsupported features
6. A migration seam translates legacy provider-centric selection into the new runtime-aware model.

## Functional Subdomains

### Runtime Identity Resolution
- Converts legacy provider naming and future runtime naming into one canonical runtime ID space.
- Prevents alias collisions.
- Supports backward-compatible lookups for existing Claude Code behavior.

### Runtime Registration
- Establishes one authoritative registration path for all runtimes.
- Ensures every runtime exposes the same minimum contract shape.
- Rejects incomplete registrations.

### Capability Declaration
- Associates each runtime with explicit capability metadata rather than implicit assumptions.
- Enables future compatibility checks for Kiro CLI, custom LangGraph CLI, and later candidates such as `gh`.

### Runtime Selection Mediation
- Separates external user-facing config from internal runtime identity.
- Preserves existing UX while allowing internal refactoring.

### Migration Mediation
- Maps existing provider-centric configuration to runtime-centric abstractions.
- Prevents immediate breaking changes to current Claude Code flows.

## State Transitions
- `unregistered` -> `registered`
- `registered` -> `validated`
- `validated` -> `ready`
- `validated` -> `blocked`
- `ready` -> `selected`

## Decision Logic
- A runtime cannot be selected unless it has a valid runtime identity and adapter contract.
- A runtime cannot be considered ready unless required capabilities are declared.
- Legacy provider routes must always map deterministically to exactly one runtime identity.
