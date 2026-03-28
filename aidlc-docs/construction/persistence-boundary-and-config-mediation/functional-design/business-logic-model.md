# Business Logic Model

## Purpose
Unit 2 defines who owns runtime-related state and how the rest of the control plane is allowed to access it.

## Core Business Flow
1. A control-plane caller identifies a target runtime through the Unit 1 runtime contract.
2. `RuntimeConfigFacade` asks `RuntimePersistenceBoundary` for runtime-facing configuration.
3. `RuntimePersistenceBoundary` resolves data from existing brownfield stores without exposing storage internals.
4. The boundary returns:
   - runtime configuration values
   - credential references or handles
   - capability-probe cache data
   - execution metadata recording interfaces
5. Downstream execution services consume the returned data but do not mutate raw storage directly.

## Functional Subflows

### 1. Runtime Config Resolution
- Input:
  - runtime ID
  - mode context such as `act` or `plan`
  - optional session or workspace scope
- Processing:
  - map runtime ID to backward-compatible provider-centric keys where necessary
  - merge global state, task state, session overrides, and remote config in the existing precedence order
  - materialize a runtime-scoped config view rather than returning raw state-manager structures
- Output:
  - normalized runtime config object

### 2. Credential Resolution
- Input:
  - runtime ID
  - required credential categories
- Processing:
  - determine which secret keys or credential groups belong to the runtime
  - resolve credentials from the existing secrets store
  - return reference-level access or narrowly scoped payloads
- Output:
  - runtime credential reference, not arbitrary storage access

### 3. Capability Cache Ownership
- Input:
  - runtime probe request or probe result
- Processing:
  - classify cached data as process-memory cache, session cache, or persistent cache candidate
  - record source, freshness, and validity window
  - keep future runtime probes from contaminating other runtimes' cached capability state
- Output:
  - runtime-specific capability probe state

### 4. Execution Metadata Recording
- Input:
  - execution start, completion, failure, or probe result
- Processing:
  - record metadata that later units can use for observability and rollout control
  - separate execution metadata from credentials and primary config values
  - ensure metadata is append-only or overwrite-safe depending on event type
- Output:
  - runtime execution record stream

### 5. Legacy Migration Mediation
- Input:
  - existing UI updates
  - provider-centric config writes
  - proto configuration conversion requests
- Processing:
  - keep old entry points stable
  - centralize runtime-aware translation instead of duplicating mapping logic in CLI, controller, and proto layers
- Output:
  - migration-safe compatibility behavior

## Ownership Model

### RuntimePersistenceBoundary Owns
- runtime-scoped config view construction
- runtime credential lookup policy
- capability cache scoping rules
- execution metadata record ownership
- runtime-facing migration mediation rules

### StateManager Continues To Own
- raw persistent storage interaction
- in-memory caching implementation
- flush and debounce behavior
- global/task/workspace state caches
- secrets store integration

### Runtime Execution Services Must Not Own
- direct secret-key selection
- raw state-key merging policy
- persistent capability cache storage semantics
- direct writes into storage for runtime metadata without boundary mediation

## Brownfield Anchors
- `src/core/storage/StateManager.ts`
  - current raw state and secret ownership
- `cli/src/utils/provider-config.ts`
  - current UI-driven provider write path
- `cli/src/agent/ClineAgent.ts`
  - current session-level provider/model mutation path
- `src/shared/storage/provider-keys.ts`
  - current provider-to-key lookup policy
- `src/shared/proto-conversions/models/api-configuration-conversion.ts`
  - current proto compatibility seam

## Resulting Functional Outcome
- Later units can ask for runtime config and credentials as bounded runtime concepts.
- Storage semantics remain centralized instead of leaking into runtime adapters or shim logic.
- Future Kiro CLI and LangGraph work can add runtime-specific fields without rewriting ownership rules from scratch.
