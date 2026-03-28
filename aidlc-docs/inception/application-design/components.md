# Components

## 1. RuntimeRegistry
- **Purpose**: Resolve runtime adapters by runtime identity and expose the canonical registration point for supported runtimes.
- **Responsibilities**:
  - register supported runtimes
  - resolve runtime adapter by runtime ID
  - expose runtime capability metadata
  - serve as the composition root between control plane and runtime-specific adapters
- **Interfaces**:
  - `register(adapterDefinition)`
  - `resolve(runtimeId)`
  - `listCapabilities()`

## 2. RuntimeAdapter
- **Purpose**: Define the stable contract between the control plane and any runtime implementation.
- **Responsibilities**:
  - declare runtime identity
  - declare capabilities
  - prepare invocation inputs
  - expose health or probe checks
  - integrate with shim wrapper and translation layer
- **Interfaces**:
  - `getRuntimeId()`
  - `getCapabilities()`
  - `invoke(request)`
  - `probe()`

## 3. RuntimeShimWrapper
- **Purpose**: Encapsulate runtime-specific process execution and protocol normalization.
- **Responsibilities**:
  - resolve CLI path or process endpoint
  - construct command and environment
  - stream stdout and stderr
  - normalize process errors, timeouts, retries
  - hand raw output to the translation layer
- **Interfaces**:
  - `prepareInvocation(request)`
  - `spawn(invocation)`
  - `normalizeFailure(error)`

## 4. RuntimeStreamTranslator
- **Purpose**: Convert runtime-native output into internal `ApiStream` or equivalent control-plane stream events.
- **Responsibilities**:
  - map text events
  - map reasoning events
  - map tool call lifecycle
  - map usage and terminal state
  - preserve golden-testable deterministic parsing
- **Interfaces**:
  - `translateChunk(rawChunk)`
  - `finalizeStream()`

## 5. RuntimePersistenceBoundary
- **Purpose**: Isolate ownership of runtime configuration, credentials, history metadata, and runtime execution records.
- **Responsibilities**:
  - distinguish session-scoped, process-scoped, workspace-scoped, and persistent state
  - mediate credential access
  - store runtime capability cache and execution metadata
  - prevent runtime-specific state leakage across adapters
- **Interfaces**:
  - `loadRuntimeConfig(runtimeId)`
  - `loadRuntimeCredentials(runtimeId)`
  - `recordExecution(event)`
  - `recordCapabilityProbe(result)`

## 6. RuntimeCapabilityValidator
- **Purpose**: Evaluate whether a runtime is fit for integration and later rollout.
- **Responsibilities**:
  - capability matrix validation
  - spike checklist execution planning
  - compatibility and unknown-risk classification
- **Interfaces**:
  - `validateCapabilities(runtimeDefinition)`
  - `buildSpikeChecklist(runtimeDefinition)`

## 7. RuntimeOrchestrationService
- **Purpose**: Coordinate control-plane interactions with runtime adapters.
- **Responsibilities**:
  - select runtime
  - invoke adapter
  - enforce persistence boundary
  - apply retries and observability
  - return translated output to the control plane
- **Interfaces**:
  - `executeRuntime(request)`
  - `probeRuntime(runtimeId)`
  - `getRuntimeStatus(runtimeId)`

## 8. RuntimeConfigFacade
- **Purpose**: Maintain user-facing configuration stability while internal runtime architecture evolves.
- **Responsibilities**:
  - map existing provider settings to runtime-aware model
  - preserve backward-compatible UX for Claude Code
  - support future Kiro, gh, and LangGraph config onboarding
- **Interfaces**:
  - `readConfigForUI()`
  - `writeConfigFromUI(update)`
  - `migrateLegacyConfig()`

## 9. ReferenceRuntimeAdapters

### ClaudeCodeRuntimeAdapter
- **Purpose**: First reference runtime implementation.
- **Responsibilities**:
  - preserve current Claude Code integration behavior
  - demonstrate shim wrapper and stream translation patterns

### KiroCliRuntimeAdapter
- **Purpose**: MVP 2 target runtime adapter.
- **Responsibilities**:
  - apply the same runtime contract with Kiro-specific capability probes

### GithubGhRuntimeAdapter
- **Purpose**: MVP 3 target runtime adapter.
- **Responsibilities**:
  - adapt `gh` workflow and command oriented behaviors into the runtime contract where meaningful
  - document divergence from agent-like runtime semantics

### LangGraphRuntimeAdapter
- **Purpose**: MVP 4 target runtime adapter.
- **Responsibilities**:
  - model out-of-process LangGraph invocation and translation boundaries
