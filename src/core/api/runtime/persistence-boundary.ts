import type { ApiConfiguration, RuntimeId } from "@shared/api"
import { getLegacyProviderForRuntimeId } from "@shared/api"
import { getProviderModelIdKey } from "@shared/storage"
import type { SecretKey, Secrets, Settings, SettingsKey } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import { Logger } from "@/shared/services/Logger"
import type {
	RuntimeBoundaryErrorType,
	RuntimeCapabilityProbeRecord,
	RuntimeConfigView,
	RuntimeCredentialRef,
	RuntimeExecutionRecord,
} from "./persistence-types"
import { RuntimeBoundaryError } from "./persistence-types"
import { getRuntimeMigrationBinding } from "./runtime-migration-bindings"

export interface RuntimePersistenceStateSource {
	getApiConfiguration(): ApiConfiguration
	getGlobalSettingsKey<K extends keyof Settings>(key: K): Settings[K]
	getSecretKey<K extends keyof Secrets>(key: K): Secrets[K]
}

const getModelKeyForRuntime = (runtimeId: RuntimeId, mode: Mode): SettingsKey | undefined => {
	const legacyProvider = getLegacyProviderForRuntimeId(runtimeId)
	return legacyProvider ? getProviderModelIdKey(legacyProvider, mode) : `${mode}ModeApiModelId`
}

const toBoundaryError = (runtimeId: RuntimeId, errorType: RuntimeBoundaryErrorType, message: string) =>
	new RuntimeBoundaryError({ runtimeId, errorType, message })

export class RuntimePersistenceBoundary {
	private capabilityProbeCache = new Map<string, RuntimeCapabilityProbeRecord>()
	private executionRecords = new Map<RuntimeId, RuntimeExecutionRecord[]>()

	loadRuntimeConfig(stateSource: RuntimePersistenceStateSource, runtimeId: RuntimeId, mode: Mode): RuntimeConfigView {
		const binding = getRuntimeMigrationBinding(runtimeId)
		const apiConfiguration = stateSource.getApiConfiguration()
		const apiConfigurationMap = apiConfiguration as Record<string, unknown>
		const modelKey = getModelKeyForRuntime(runtimeId, mode)
		const resolvedModelId = modelKey ? stateSource.getGlobalSettingsKey(modelKey) : undefined

		const runtimeSpecificFields = binding.settingKeys.reduce<Partial<ApiConfiguration>>((acc, key) => {
			const value = apiConfigurationMap[key]
			if (value !== undefined) {
				;(acc as Record<string, unknown>)[key] = value
			}
			return acc
		}, {})

		return {
			runtimeId,
			mode,
			legacyProvider: binding.legacyProvider,
			resolvedModelId: typeof resolvedModelId === "string" ? resolvedModelId : undefined,
			modelKey,
			runtimeSpecificFields,
			binding,
		}
	}

	loadRuntimeCredentials(stateSource: RuntimePersistenceStateSource, runtimeId: RuntimeId): RuntimeCredentialRef {
		const binding = getRuntimeMigrationBinding(runtimeId)
		if (binding.secretKeys.length === 0) {
			return {
				runtimeId,
				credentialSetId: `${runtimeId}:none`,
				requiredSecretKeys: [],
				availabilityStatus: "not-required",
				resolvedSecrets: {},
			}
		}

		const resolvedSecrets = binding.secretKeys.reduce<Partial<Record<SecretKey, string | undefined>>>((acc, key) => {
			acc[key] = stateSource.getSecretKey(key)
			return acc
		}, {})

		const availabilityStatus = binding.secretKeys.every((key) => Boolean(resolvedSecrets[key])) ? "available" : "missing"

		return {
			runtimeId,
			credentialSetId: `${runtimeId}:${binding.secretKeys.join(",")}`,
			requiredSecretKeys: binding.secretKeys,
			availabilityStatus,
			resolvedSecrets,
		}
	}

	assertCredentialsAvailable(credentialRef: RuntimeCredentialRef): RuntimeCredentialRef {
		if (credentialRef.availabilityStatus === "missing") {
			throw toBoundaryError(credentialRef.runtimeId, "missing_credentials", `Runtime ${credentialRef.runtimeId} is missing credentials`)
		}

		return credentialRef
	}

	getCapabilityProbe(runtimeId: RuntimeId): RuntimeCapabilityProbeRecord | undefined {
		const record = this.capabilityProbeCache.get(runtimeId)
		if (!record) {
			return undefined
		}

		if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
			return {
				...record,
				status: "refresh-needed",
			}
		}

		return record
	}

	recordCapabilityProbe(result: RuntimeCapabilityProbeRecord): void {
		this.capabilityProbeCache.set(result.runtimeId, result)
	}

	recordExecution(event: RuntimeExecutionRecord): void {
		const records = this.executionRecords.get(event.runtimeId) ?? []
		records.push(event)
		this.executionRecords.set(event.runtimeId, records)
	}

	getExecutionRecords(runtimeId: RuntimeId): RuntimeExecutionRecord[] {
		return this.executionRecords.get(runtimeId) ?? []
	}

	invalidateCapabilityProbe(runtimeId: RuntimeId): void {
		this.capabilityProbeCache.delete(runtimeId)
	}

	logBoundaryEvent(eventName: string, runtimeId: RuntimeId, details: Record<string, unknown>): void {
		Logger.debug("[RuntimePersistenceBoundary]", JSON.stringify({ eventName, runtimeId, ...details }))
	}
}

let runtimePersistenceBoundary: RuntimePersistenceBoundary | undefined

export const getRuntimePersistenceBoundary = () => {
	if (!runtimePersistenceBoundary) {
		runtimePersistenceBoundary = new RuntimePersistenceBoundary()
	}

	return runtimePersistenceBoundary
}
