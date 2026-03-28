# Component Methods

## RuntimeRegistry
- `register(adapterDefinition): void`
  - Register a runtime adapter and its metadata.
- `resolve(runtimeId): RuntimeAdapter`
  - Return the adapter for a given runtime ID.
- `listCapabilities(): RuntimeCapabilitySummary[]`
  - Return all registered runtime capabilities.

## RuntimeAdapter
- `getRuntimeId(): string`
  - Return canonical runtime identity.
- `getCapabilities(): RuntimeCapabilities`
  - Return declared runtime behaviors and supported features.
- `invoke(request: RuntimeInvocationRequest): AsyncIterable<RuntimeEvent>`
  - Execute the runtime and emit runtime-native events.
- `probe(): Promise<RuntimeProbeResult>`
  - Validate runtime availability and readiness.

## RuntimeShimWrapper
- `prepareInvocation(request: RuntimeInvocationRequest): PreparedInvocation`
  - Convert internal request into process-level invocation data.
- `spawn(invocation: PreparedInvocation): RuntimeProcessHandle`
  - Start the runtime process or endpoint connection.
- `normalizeFailure(error: unknown): RuntimeInvocationError`
  - Convert raw process errors into normalized failure types.

## RuntimeStreamTranslator
- `translateChunk(rawChunk: unknown): ApiStreamChunk[]`
  - Parse and translate one raw runtime chunk.
- `flushPendingState(): ApiStreamChunk[]`
  - Emit any pending buffered translated events.
- `finalizeStream(): ApiStreamChunk[]`
  - Emit terminal chunks such as usage or completion states.

## RuntimePersistenceBoundary
- `loadRuntimeConfig(runtimeId: string): RuntimeConfig`
  - Load runtime-specific configuration.
- `loadRuntimeCredentials(runtimeId: string): RuntimeCredentialsRef`
  - Resolve credentials without leaking storage semantics outward.
- `recordExecution(event: RuntimeExecutionRecord): void`
  - Persist execution metadata and traceable events.
- `recordCapabilityProbe(result: RuntimeProbeResult): void`
  - Persist or cache probe results.

## RuntimeCapabilityValidator
- `validateCapabilities(runtimeDefinition: RuntimeDefinition): RuntimeCapabilityAssessment`
  - Evaluate runtime support against capability matrix.
- `buildSpikeChecklist(runtimeDefinition: RuntimeDefinition): RuntimeSpikeChecklist`
  - Generate validation checklist for a future runtime.

## RuntimeOrchestrationService
- `executeRuntime(request: RuntimeExecutionRequest): AsyncIterable<ApiStreamChunk>`
  - Orchestrate adapter resolution, invocation, translation, and persistence.
- `probeRuntime(runtimeId: string): Promise<RuntimeProbeResult>`
  - Run health and compatibility checks for a runtime.
- `getRuntimeStatus(runtimeId: string): RuntimeStatus`
  - Return summarized availability and compatibility state.

## RuntimeConfigFacade
- `readConfigForUI(): RuntimeConfigViewModel`
  - Produce UI-facing runtime configuration data.
- `writeConfigFromUI(update: RuntimeConfigUpdate): void`
  - Validate and persist runtime configuration changes.
- `migrateLegacyConfig(): RuntimeMigrationReport`
  - Translate current provider-centric config into runtime-aware config model.
