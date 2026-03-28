import type { ApiConfiguration, ApiProvider, RuntimeId } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import type { SecretKey, SettingsKey } from "@shared/storage/state-keys"

export type RuntimeBoundaryErrorType =
	| "missing_config"
	| "missing_credentials"
	| "stale_capability_cache"
	| "invalid_runtime_mapping"
	| "metadata_write_failed"

export class RuntimeBoundaryError extends Error {
	readonly runtimeId: RuntimeId
	readonly errorType: RuntimeBoundaryErrorType
	readonly isRetryable: boolean

	constructor(options: { runtimeId: RuntimeId; errorType: RuntimeBoundaryErrorType; message: string; isRetryable?: boolean }) {
		super(options.message)
		this.name = "RuntimeBoundaryError"
		this.runtimeId = options.runtimeId
		this.errorType = options.errorType
		this.isRetryable = options.isRetryable ?? false
	}
}

export interface RuntimeMigrationBinding {
	runtimeId: RuntimeId
	legacyProvider?: ApiProvider
	settingKeys: SettingsKey[]
	secretKeys: SecretKey[]
	protoCompatibilityMode: "legacy-provider" | "runtime-aware"
	uiCompatibilityMode: "legacy-provider" | "runtime-aware"
}

export interface RuntimeConfigView {
	runtimeId: RuntimeId
	mode: Mode
	legacyProvider?: ApiProvider
	resolvedModelId?: string
	modelKey?: SettingsKey
	runtimeSpecificFields: Partial<ApiConfiguration>
	binding: RuntimeMigrationBinding
}

export interface RuntimeCredentialRef {
	runtimeId: RuntimeId
	credentialSetId: string
	requiredSecretKeys: SecretKey[]
	availabilityStatus: "available" | "missing" | "not-required"
	resolvedSecrets: Partial<Record<SecretKey, string | undefined>>
}

export interface RuntimeCapabilityProbeRecord {
	runtimeId: RuntimeId
	probeType: "readiness" | "capability"
	status: "ready" | "failed" | "refresh-needed"
	capabilitySnapshot?: Record<string, unknown>
	recordedAt: number
	expiresAt?: number
	failureReason?: string
}

export interface RuntimeExecutionRecord {
	runtimeId: RuntimeId
	sessionId?: string
	taskId?: string
	executionKind: "probe" | "runtime"
	startedAt: number
	completedAt?: number
	status: "started" | "completed" | "failed"
	normalizedFailureType?: string
}

export interface RuntimeConfigMutation {
	runtimeId: RuntimeId
	source: "cli" | "ui" | "acp" | "internal"
	scope: "global"
	requestedChanges: Partial<ApiConfiguration>
	legacyWriteTargets: Array<SettingsKey | SecretKey>
}
