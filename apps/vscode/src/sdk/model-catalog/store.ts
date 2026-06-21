import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { type ApiConfiguration, type ApiProvider, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import type { SettingsKey } from "@shared/storage/state-keys"
import { StateManager } from "@/core/storage/StateManager"
import { toLegacyApiProvider } from "@/shared/model-catalog/provider-helpers"
import { getProviderSettingsManager } from "../provider-migration"
import type {
	Disposable,
	EffectiveProviderConfig,
	Mode,
	ModelSelection,
	ProviderConfigChange,
	ProviderConfigChangeListener,
	ProviderConfigPatch,
	ProviderConfigStore,
	ProviderId,
} from "./contracts"
import { buildEffectiveProviderConfig } from "./effective-config"
import { applyHostModelInfoOverrides } from "./host-overrides"
import { toSdkProviderId } from "./sdk-provider-id"
import { adaptSdkModelInfo } from "./shape-adapter"

type ProviderSettingsRecord = Record<string, unknown>
type ModelInfoKeys = {
	readonly plan: keyof ApiConfiguration & SettingsKey
	readonly act: keyof ApiConfiguration & SettingsKey
}

const modelInfoKeysByProvider: Partial<Record<string, ModelInfoKeys>> = {
	openrouter: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
	cline: { plan: "planModeClineModelInfo", act: "actModeClineModelInfo" },
	openai: { plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
	litellm: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
	requesty: { plan: "planModeRequestyModelInfo", act: "actModeRequestyModelInfo" },
	groq: { plan: "planModeGroqModelInfo", act: "actModeGroqModelInfo" },
	baseten: { plan: "planModeBasetenModelInfo", act: "actModeBasetenModelInfo" },
	huggingface: { plan: "planModeHuggingFaceModelInfo", act: "actModeHuggingFaceModelInfo" },
	"huawei-cloud-maas": { plan: "planModeHuaweiCloudMaasModelInfo", act: "actModeHuaweiCloudMaasModelInfo" },
	oca: { plan: "planModeOcaModelInfo", act: "actModeOcaModelInfo" },
	aihubmix: { plan: "planModeAihubmixModelInfo", act: "actModeAihubmixModelInfo" },
	hicap: { plan: "planModeHicapModelInfo", act: "actModeHicapModelInfo" },
	"vercel-ai-gateway": { plan: "planModeVercelAiGatewayModelInfo", act: "actModeVercelAiGatewayModelInfo" },
}

function providerKey(providerId: ProviderId): string {
	return providerId.toString()
}

function providerForStorage(providerId: ProviderId): ApiProvider | undefined {
	const key = providerKey(providerId)
	return toLegacyApiProvider(key)
}

function modePair<T>(mode: Mode, plan: T, act: T): T {
	return mode === "plan" ? plan : act
}

function patchValue<T>(value: T | null | undefined): T | undefined {
	return value === null ? undefined : value
}

function patchStringValue(value: string | null | undefined): string | undefined {
	const patched = patchValue(value)
	return patched === "" ? undefined : patched
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isModelInfo(value: unknown): value is ModelInfo {
	return isRecord(value) && typeof value.supportsPromptCache === "boolean"
}

function readProviderSettingsModelId(providerId: ProviderId): string | undefined {
	const model = getProviderSettings(providerId).model
	return typeof model === "string" && model.trim().length > 0 ? model.trim() : undefined
}

function readProviderSettingsModelInfo(providerId: ProviderId): ModelInfo | undefined {
	const modelInfo = getProviderSettings(providerId).modelInfo
	return isModelInfo(modelInfo) ? modelInfo : undefined
}

function fallbackModelInfo(modelId: string): ModelInfo {
	return { ...openAiModelInfoSafeDefaults, name: modelId }
}

function readKnownModelInfoForProvider(providerId: ProviderId, modelId: string): ModelInfo | undefined {
	const sdkProviderId = toSdkProviderId(providerId)
	const generatedModelInfo = getGeneratedModelsForProvider(sdkProviderId)[modelId]
	if (isModelInfo(generatedModelInfo)) {
		return generatedModelInfo
	}
	if (generatedModelInfo) {
		try {
			return applyHostModelInfoOverrides(providerId, modelId, adaptSdkModelInfo(generatedModelInfo))
		} catch {
			return undefined
		}
	}

	const collectionModelInfo = MODEL_COLLECTIONS_BY_PROVIDER_ID[sdkProviderId]?.models[modelId]
	if (isModelInfo(collectionModelInfo)) {
		return collectionModelInfo
	}
	if (collectionModelInfo) {
		try {
			return applyHostModelInfoOverrides(providerId, modelId, adaptSdkModelInfo(collectionModelInfo))
		} catch {
			return undefined
		}
	}

	return undefined
}

function readSelectionFromProviderSettings(providerId: ProviderId): ModelSelection | undefined {
	const modelId = readProviderSettingsModelId(providerId)
	if (!modelId) {
		return undefined
	}

	return {
		providerId,
		modelId,
		modelInfo:
			readProviderSettingsModelInfo(providerId) ??
			readKnownModelInfoForProvider(providerId, modelId) ??
			fallbackModelInfo(modelId),
	}
}

function getProviderSettings(providerId: ProviderId): ProviderSettingsRecord {
	const manager = getProviderSettingsManager()
	const sdkProviderId = toSdkProviderId(providerId)
	const settings = manager.getProviderSettings(sdkProviderId) ?? manager.getProviderSettings(providerId)
	return isRecord(settings) ? settings : {}
}

function saveProviderSettings(providerId: ProviderId, next: ProviderSettingsRecord): void {
	const sdkProviderId = toSdkProviderId(providerId)
	getProviderSettingsManager().saveProviderSettings({ provider: sdkProviderId, ...next }, { setLastUsed: false })
}

function mergeProviderSettingsRecord(
	base: ProviderSettingsRecord,
	patch: Readonly<Record<string, unknown>> | undefined,
): ProviderSettingsRecord {
	if (!patch) {
		return base
	}
	const next: ProviderSettingsRecord = { ...base }
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) {
			continue
		}
		if (value === null) {
			delete next[key]
			continue
		}
		const existingValue = next[key]
		if (isRecord(existingValue) && isRecord(value)) {
			next[key] = mergeProviderSettingsRecord(existingValue, value)
		} else {
			next[key] = value
		}
	}
	return next
}

function writeProviderSettingsFields(providerId: ProviderId, patch: ProviderConfigPatch): void {
	const next: ProviderSettingsRecord = mergeProviderSettingsRecord(getProviderSettings(providerId), patch.settings)

	for (const key of ["apiKey", "baseUrl", "apiLine", "headers", "region", "auth", "extras"] as const) {
		if (key in patch) {
			const value = typeof patch[key] === "string" ? patchStringValue(patch[key]) : patchValue(patch[key])
			if (value === undefined) {
				delete next[key]
			} else {
				next[key] = value
			}
		}
	}

	if ("sap" in patch) {
		const sapPatch = patch.sap
		if (sapPatch === null || sapPatch === undefined) {
			delete next.sap
		} else {
			const existingSap = isRecord(next.sap) ? next.sap : {}
			const nextSap: ProviderSettingsRecord = { ...existingSap }
			for (const [key, value] of Object.entries(sapPatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextSap[key]
				} else {
					nextSap[key] = value
				}
			}
			if (Object.keys(nextSap).length === 0) {
				delete next.sap
			} else {
				next.sap = nextSap
			}
		}
	}

	if ("oca" in patch) {
		const ocaPatch = patch.oca
		if (ocaPatch === null || ocaPatch === undefined) {
			delete next.oca
		} else {
			const existingOca = isRecord(next.oca) ? next.oca : {}
			const nextOca: ProviderSettingsRecord = { ...existingOca }
			for (const [key, value] of Object.entries(ocaPatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextOca[key]
				} else {
					nextOca[key] = value
				}
			}
			if (Object.keys(nextOca).length === 0) {
				delete next.oca
			} else {
				next.oca = nextOca
			}
		}
	}

	if ("gcp" in patch) {
		const gcpPatch = patch.gcp
		if (gcpPatch === null || gcpPatch === undefined) {
			delete next.gcp
		} else {
			const existingGcp = isRecord(next.gcp) ? next.gcp : {}
			const nextGcp: ProviderSettingsRecord = { ...existingGcp }
			for (const [key, value] of Object.entries(gcpPatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextGcp[key]
				} else {
					nextGcp[key] = value
				}
			}
			if (Object.keys(nextGcp).length === 0) {
				delete next.gcp
			} else {
				next.gcp = nextGcp
			}
		}
	}

	if ("azure" in patch) {
		const azurePatch = patch.azure
		if (azurePatch === null || azurePatch === undefined) {
			delete next.azure
		} else {
			const existingAzure = isRecord(next.azure) ? next.azure : {}
			const nextAzure: ProviderSettingsRecord = { ...existingAzure }
			for (const [key, value] of Object.entries(azurePatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextAzure[key]
				} else {
					nextAzure[key] = value
				}
			}
			if (Object.keys(nextAzure).length === 0) {
				delete next.azure
			} else {
				next.azure = nextAzure
			}
		}
	}

	if ("aws" in patch) {
		const awsPatch = patch.aws
		if (awsPatch === null || awsPatch === undefined) {
			delete next.aws
		} else {
			const existingAws = isRecord(next.aws) ? next.aws : {}
			const nextAws: ProviderSettingsRecord = { ...existingAws }
			for (const [key, value] of Object.entries(awsPatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextAws[key]
				} else {
					nextAws[key] = value
				}
			}
			if (Object.keys(nextAws).length === 0) {
				delete next.aws
			} else {
				next.aws = nextAws
			}
		}
	}

	// Handle reasoning patch separately — maps to ProviderSettings.reasoning
	if ("reasoning" in patch) {
		const reasoningPatch = patch.reasoning
		if (reasoningPatch === null || reasoningPatch === undefined) {
			delete next.reasoning
		} else {
			const existingReasoning = (next as Record<string, unknown>).reasoning as Record<string, unknown> | undefined
			const merged: Record<string, unknown> = { ...(existingReasoning ?? {}) }
			if (reasoningPatch.enabled !== undefined) {
				merged.enabled = reasoningPatch.enabled
			}
			if (reasoningPatch.effort !== undefined) {
				merged.effort = reasoningPatch.effort === "none" ? undefined : reasoningPatch.effort
				// When effort is "none", disable reasoning
				if (reasoningPatch.effort === "none") {
					merged.enabled = false
				}
			}
			if (reasoningPatch.budgetTokens !== undefined) {
				merged.budgetTokens = reasoningPatch.budgetTokens
			}
			;(next as Record<string, unknown>).reasoning = merged
		}
	}

	saveProviderSettings(providerId, next)
}

function getModelIdKey(providerId: ProviderId, mode: Mode): keyof ApiConfiguration & SettingsKey {
	return getProviderModelIdKey(providerForStorage(providerId) ?? "anthropic", mode) as keyof ApiConfiguration & SettingsKey
}

function getModelInfoKey(providerId: ProviderId, mode: Mode): (keyof ApiConfiguration & SettingsKey) | undefined {
	const keys = modelInfoKeysByProvider[toLegacyApiProvider(providerKey(providerId))]
	return keys ? modePair(mode, keys.plan, keys.act) : undefined
}

function writeSelectionToProviderSettings(providerId: ProviderId, selection: ModelSelection): void {
	const next: ProviderSettingsRecord = {
		...getProviderSettings(providerId),
		model: selection.modelId,
		modelInfo: selection.modelInfo,
	}

	if (selection.modelInfo.contextWindow !== undefined && selection.modelInfo.contextWindow > 0) {
		next.contextWindow = selection.modelInfo.contextWindow
	}

	if (selection.modelInfo.maxTokens !== undefined && selection.modelInfo.maxTokens > 0) {
		next.maxTokens = selection.modelInfo.maxTokens
	}

	saveProviderSettings(providerId, next)
}

function readSelectionFromState(providerId: ProviderId, mode: Mode): ModelSelection | undefined {
	const providerSettingsSelection = readSelectionFromProviderSettings(providerId)
	if (providerSettingsSelection) {
		return providerSettingsSelection
	}

	const apiConfiguration = StateManager.get().getApiConfiguration()
	const modelId = apiConfiguration[getModelIdKey(providerId, mode)]
	const modelInfoKey = getModelInfoKey(providerId, mode)

	if (modelInfoKey) {
		const modelInfo = apiConfiguration[modelInfoKey]
		if (typeof modelId !== "string" || modelId.length === 0 || !isModelInfo(modelInfo)) {
			return undefined
		}
		return { providerId, modelId, modelInfo }
	}

	const activeProvider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
	const provider = providerForStorage(providerId)
	if (activeProvider !== provider) {
		return undefined
	}

	if (typeof modelId !== "string" || modelId.length === 0) {
		return undefined
	}

	const modelInfo = readKnownModelInfoForProvider(providerId, modelId)
	if (!modelInfo) {
		return undefined
	}
	return { providerId, modelId, modelInfo }
}

/**
 * Create a {@link ProviderConfigStore} backed by StateManager and the SDK
 * ProviderSettingsManager singleton. Writes update in-memory state before
 * returning; disk persistence follows the backing stores' existing policies.
 */
export function createProviderConfigStore(): ProviderConfigStore {
	const listeners = new Set<ProviderConfigChangeListener>()
	const emit = (event: ProviderConfigChange): void => {
		for (const listener of listeners) {
			listener(event)
		}
	}

	return {
		read(providerId: ProviderId): EffectiveProviderConfig {
			return { ...buildEffectiveProviderConfig(providerId) }
		},

		readSelection(providerId: ProviderId, mode: Mode): ModelSelection | undefined {
			return readSelectionFromState(providerId, mode)
		},

		subscribe(listener: ProviderConfigChangeListener): Disposable {
			listeners.add(listener)
			return { dispose: () => listeners.delete(listener) }
		},

		write(providerId: ProviderId, patch: ProviderConfigPatch): EffectiveProviderConfig {
			writeProviderSettingsFields(providerId, patch)
			const config = this.read(providerId)
			emit({ kind: "fields", providerId, config })
			return config
		},

		commitSelection(providerId: ProviderId, mode: Mode, selection: ModelSelection): void {
			writeSelectionToProviderSettings(providerId, selection)
			emit({ kind: "selection", providerId, mode, selection })
		},
	}
}
