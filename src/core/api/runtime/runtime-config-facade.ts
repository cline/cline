import type { ApiConfiguration, ApiProvider, RuntimeId } from "@shared/api"
import { getRuntimeIdForProvider } from "@shared/api"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import type { RuntimeConfigMutation, RuntimeConfigView, RuntimeCredentialRef } from "./persistence-types"
import { getRuntimePersistenceBoundary, type RuntimePersistenceStateSource } from "./persistence-boundary"
import { applyRuntimeMutationToApiConfiguration, getRuntimeMigrationBinding } from "./runtime-migration-bindings"

export interface RuntimeConfigWriter extends RuntimePersistenceStateSource {
	setApiConfiguration(apiConfiguration: ApiConfiguration): void
	setGlobalState<K extends keyof Settings>(key: K, value: Settings[K]): void
}

export class RuntimeConfigFacade {
	constructor(private readonly persistenceBoundary = getRuntimePersistenceBoundary()) {}

	readConfigForMode(stateSource: RuntimePersistenceStateSource, mode: Mode, runtimeId?: RuntimeId): RuntimeConfigView {
		const resolvedRuntimeId = runtimeId ?? getRuntimeIdForProvider(stateSource.getGlobalSettingsKey(mode === "act" ? "actModeApiProvider" : "planModeApiProvider"))
		return this.persistenceBoundary.loadRuntimeConfig(stateSource, resolvedRuntimeId, mode)
	}

	readCredentials(stateSource: RuntimePersistenceStateSource, runtimeId: RuntimeId): RuntimeCredentialRef {
		return this.persistenceBoundary.loadRuntimeCredentials(stateSource, runtimeId)
	}

	readLegacyModelSelection(
		stateSource: RuntimePersistenceStateSource,
		mode: Mode,
	): { runtimeId: RuntimeId; provider?: ApiProvider; modelId?: string; fullModelId: string } {
		const config = this.readConfigForMode(stateSource, mode)
		const fullModelId =
			config.legacyProvider && config.resolvedModelId ? `${config.legacyProvider}/${config.resolvedModelId}` : config.legacyProvider || ""

		return {
			runtimeId: config.runtimeId,
			provider: config.legacyProvider,
			modelId: config.resolvedModelId,
			fullModelId,
		}
	}

	writeLegacyProviderConfig(
		stateWriter: RuntimeConfigWriter,
		input: {
			providerId: ApiProvider
			apiKey?: string
			modelId?: string
			baseUrl?: string
			additionalSettings?: Partial<ApiConfiguration>
			source?: RuntimeConfigMutation["source"]
		},
	): RuntimeConfigMutation {
		const runtimeId = getRuntimeIdForProvider(input.providerId)
		const binding = getRuntimeMigrationBinding(runtimeId)
		const apiConfiguration = applyRuntimeMutationToApiConfiguration(
			{
				actModeApiProvider: input.providerId,
				planModeApiProvider: input.providerId,
				...input.additionalSettings,
			},
			runtimeId,
		)

		if (input.modelId) {
			;(apiConfiguration as Record<string, unknown>)[getProviderModelIdKey(input.providerId, "act")] = input.modelId
			;(apiConfiguration as Record<string, unknown>)[getProviderModelIdKey(input.providerId, "plan")] = input.modelId
		}

		if (input.baseUrl) {
			apiConfiguration.openAiBaseUrl = input.baseUrl
		}

		if (input.apiKey) {
			const keyField = ProviderToApiKeyMap[input.providerId]
			if (keyField) {
				const fields = Array.isArray(keyField) ? keyField : [keyField]
				apiConfiguration[fields[0]] = input.apiKey
			}
		}

		stateWriter.setApiConfiguration(apiConfiguration)
		this.persistenceBoundary.invalidateCapabilityProbe(runtimeId)

		return {
			runtimeId,
			source: input.source ?? "cli",
			scope: "global",
			requestedChanges: apiConfiguration,
			legacyWriteTargets: [...binding.settingKeys, ...binding.secretKeys],
		}
	}

	writeLegacyModelSelection(stateWriter: RuntimeConfigWriter, provider: ApiProvider, modelId: string): void {
		stateWriter.setGlobalState("actModeApiProvider", provider)
		stateWriter.setGlobalState("planModeApiProvider", provider)
		stateWriter.setGlobalState(getProviderModelIdKey(provider, "act"), modelId)
		stateWriter.setGlobalState(getProviderModelIdKey(provider, "plan"), modelId)
	}
}

let runtimeConfigFacade: RuntimeConfigFacade | undefined

export const getRuntimeConfigFacade = () => {
	if (!runtimeConfigFacade) {
		runtimeConfigFacade = new RuntimeConfigFacade()
	}

	return runtimeConfigFacade
}
