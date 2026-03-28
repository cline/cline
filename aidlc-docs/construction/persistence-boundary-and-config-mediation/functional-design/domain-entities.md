# Domain Entities

## 1. RuntimeConfigView
- **Purpose**: Runtime-facing configuration projection built from existing state stores.
- **Fields**:
  - `runtimeId`
  - `mode`
  - `resolvedModelId`
  - `resolvedModelInfoRef`
  - `runtimePath`
  - `baseUrl`
  - `reasoningSettings`
  - `runtimeSpecificFields`
- **Notes**:
  - This is not a raw storage object.
  - It is the normalized config surface consumed by runtime execution paths.

## 2. RuntimeCredentialRef
- **Purpose**: Narrow credential access contract for a runtime.
- **Fields**:
  - `runtimeId`
  - `credentialSetId`
  - `requiredSecretKeys`
  - `availabilityStatus`
  - `resolutionSource`
- **Notes**:
  - May represent one secret or multiple grouped secrets.
  - Keeps secret lookup policy centralized.

## 3. RuntimeCapabilityProbeRecord
- **Purpose**: Cacheable record of runtime readiness or capability checks.
- **Fields**:
  - `runtimeId`
  - `probeType`
  - `status`
  - `capabilitySnapshot`
  - `recordedAt`
  - `expiresAt`
  - `failureReason`
- **Relationships**:
  - belongs to one runtime identity
  - may be invalidated by config changes

## 4. RuntimeExecutionRecord
- **Purpose**: Appendable execution metadata entity for runtime invocations.
- **Fields**:
  - `runtimeId`
  - `sessionId`
  - `taskId`
  - `executionKind`
  - `startedAt`
  - `completedAt`
  - `status`
  - `normalizedFailureType`
  - `probeLink`
- **Notes**:
  - excludes raw credentials
  - can be used later for observability and rollout governance

## 5. RuntimeConfigMutation
- **Purpose**: Boundary-owned write request for runtime-aware config changes.
- **Fields**:
  - `runtimeId`
  - `source`
  - `scope`
  - `requestedChanges`
  - `legacyWriteTargets`
  - `requiresMigrationReport`
- **Notes**:
  - captures the difference between UI-originated changes and internal writes

## 6. RuntimeMigrationBinding
- **Purpose**: Explicit mapping between old provider-centric fields and runtime-aware fields.
- **Fields**:
  - `runtimeId`
  - `legacyProvider`
  - `legacyStateKeys`
  - `legacySecretKeys`
  - `protoCompatibilityMode`
  - `uiCompatibilityMode`
- **Notes**:
  - key entity for incremental migration
  - prevents mapping logic from being scattered

## 7. RuntimeBoundaryError
- **Purpose**: Normalized business error entity emitted by the persistence boundary.
- **Fields**:
  - `runtimeId`
  - `errorType`
  - `sourceBoundary`
  - `isRetryable`
  - `safeMessage`
- **Error Types**:
  - `missing_config`
  - `missing_credentials`
  - `stale_capability_cache`
  - `invalid_runtime_mapping`
  - `metadata_write_failed`

## Entity Relationships
- `RuntimeConfigView` is derived through `RuntimeMigrationBinding`.
- `RuntimeCredentialRef` is resolved through `RuntimeMigrationBinding`.
- `RuntimeCapabilityProbeRecord` and `RuntimeExecutionRecord` are owned by the persistence boundary and keyed by `runtimeId`.
- `RuntimeBoundaryError` may arise from any of the above entities when the boundary cannot satisfy a request.
