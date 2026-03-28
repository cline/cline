# Domain Entities - runtime-contract-foundation

## RuntimeDefinition
- **Description**: Canonical description of a runtime known to the system.
- **Key Fields**:
  - `runtimeId`
  - `displayName`
  - `aliases`
  - `capabilities`
  - `adapterRef`
  - `lifecycleState`

## RuntimeCapabilities
- **Description**: Explicit declaration of what a runtime can support.
- **Key Fields**:
  - `supportsNonInteractiveInvocation`
  - `supportsPromptInjection`
  - `supportsStructuredOutput`
  - `supportsToolObservability`
  - `supportsCapabilityProbe`
  - `supportsDeterministicTesting`

## RuntimeAdapterDefinition
- **Description**: Shared adapter contract metadata for a runtime.
- **Key Fields**:
  - `runtimeId`
  - `invokeContract`
  - `probeContract`
  - `translatorContract`
  - `shimContract`

## RuntimeSelectionRequest
- **Description**: Request from the control plane or config layer to select a runtime.
- **Key Fields**:
  - `requestedRuntimeId`
  - `legacyProviderId`
  - `mode`
  - `requestedCapabilities`

## RuntimeSelectionResult
- **Description**: Result of runtime selection and validation.
- **Key Fields**:
  - `runtimeId`
  - `resolutionSource`
  - `validationStatus`
  - `blockingReason`

## LegacyRuntimeMapping
- **Description**: Mapping entity from current provider-centric configuration to runtime-centric identity.
- **Key Fields**:
  - `legacyProviderId`
  - `targetRuntimeId`
  - `mappingVersion`
  - `migrationNotes`

## Entity Relationships
- One `RuntimeDefinition` has one `RuntimeAdapterDefinition`.
- One `RuntimeDefinition` has one `RuntimeCapabilities`.
- One `RuntimeSelectionRequest` resolves to zero or one `RuntimeSelectionResult`.
- One `LegacyRuntimeMapping` maps one legacy provider ID to one runtime ID.
