import { ensureCustomProvidersLoaded, listLocalProviders, saveLocalProviderSettings } from "@clinebot/core"
import type { ProviderListItem } from "@clinebot/shared"
import type { ApiConfiguration, ApiProvider } from "@shared/api"
import type { ExtensionState } from "@shared/ExtensionMessage"
import { getProviderModelIdKey, ProviderToApiKeyMap } from "@shared/storage/provider-keys"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { Logger } from "@/shared/services/Logger"
import { getProviderSettingsManager } from "./provider-migration"

export interface ResolvedProviderConfig {
	providerId: string
	modelId?: string
	apiKey?: string
	baseUrl?: string
}

export interface SaveSdkProviderSettingsInput {
	providerId: string
	mode: Mode
	modelId?: string
	apiKey?: string
	baseUrl?: string
	enabled?: boolean
}

function getLastUsedProviderEntry() {
	const manager = getProviderSettingsManager()
	const state = manager.read()
	const providerId = state.lastUsedProvider?.trim()
	if (!providerId) {
		return undefined
	}
	const settings = state.providers[providerId]?.settings
	return settings ? { providerId, settings } : undefined
}

function optionalTrim(value: string | undefined): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}

function resolveLegacyApiKey(providerId: string, config: ApiConfiguration): string | undefined {
	const keySpec = ProviderToApiKeyMap[providerId as ApiProvider]
	if (!keySpec) {
		return undefined
	}
	const keys = Array.isArray(keySpec) ? keySpec : [keySpec]
	for (const key of keys) {
		const value = config[key]
		if (typeof value === "string" && value.trim()) {
			return value
		}
	}
	return undefined
}

function resolveLegacyModelId(providerId: string, mode: Mode, config: ApiConfiguration): string | undefined {
	const key = getProviderModelIdKey(providerId as ApiProvider, mode)
	const value = config[key as keyof ApiConfiguration]
	if (typeof value === "string" && value.trim()) {
		return value
	}
	const genericKey = mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
	const genericValue = config[genericKey]
	return typeof genericValue === "string" && genericValue.trim() ? genericValue : undefined
}

function resolveLegacyBaseUrl(providerId: string, config: ApiConfiguration): string | undefined {
	const baseUrlMap: Record<string, keyof ApiConfiguration> = {
		anthropic: "anthropicBaseUrl",
		openai: "openAiBaseUrl",
		ollama: "ollamaBaseUrl",
		lmstudio: "lmStudioBaseUrl",
		gemini: "geminiBaseUrl",
		requesty: "requestyBaseUrl",
		litellm: "liteLlmBaseUrl",
		oca: "ocaBaseUrl",
		aihubmix: "aihubmixBaseUrl",
		dify: "difyBaseUrl",
	}
	const key = baseUrlMap[providerId]
	const value = key ? config[key] : undefined
	return typeof value === "string" && value.trim() ? value : undefined
}

function getModeProvider(config: ApiConfiguration, mode: Mode): string | undefined {
	return mode === "plan" ? config.planModeApiProvider : config.actModeApiProvider
}

export async function listSdkProviderCatalog(): Promise<{ providers: ProviderListItem[]; settingsPath: string }> {
	const manager = getProviderSettingsManager()
	await ensureCustomProvidersLoaded(manager)
	const ps = listLocalProviders(manager)
	return ps
}

export function resolveSessionProviderConfig(stateManager: StateManager, mode: Mode): ResolvedProviderConfig {
	const apiConfig = stateManager.getApiConfiguration()
	const lastUsed = getLastUsedProviderEntry()
	const providerId = lastUsed?.providerId || getModeProvider(apiConfig, mode) || "cline"
	const settings = lastUsed?.providerId === providerId ? lastUsed.settings : undefined

	return {
		providerId,
		modelId: settings?.model || resolveLegacyModelId(providerId, mode, apiConfig),
		apiKey:
			settings?.auth?.accessToken ||
			settings?.apiKey ||
			settings?.auth?.apiKey ||
			resolveLegacyApiKey(providerId, apiConfig),
		baseUrl: settings?.baseUrl || resolveLegacyBaseUrl(providerId, apiConfig),
	}
}

export function syncStateManagerToLastUsedSdkProvider(stateManager: StateManager): Partial<ApiConfiguration> {
	const lastUsed = getLastUsedProviderEntry()
	if (!lastUsed) {
		return {}
	}

	const updates: Partial<ApiConfiguration> = {
		planModeApiProvider: lastUsed.providerId as ApiProvider,
		actModeApiProvider: lastUsed.providerId as ApiProvider,
	}
	if (lastUsed.settings.model) {
		updates.planModeApiModelId = lastUsed.settings.model
		updates.actModeApiModelId = lastUsed.settings.model
	}
	stateManager.setGlobalStateBatch(updates as any)
	Logger.log(`[SdkProviderSettings] Synced startup provider from lastUsedProvider: ${lastUsed.providerId}`)
	return updates
}

export function setSelectedSdkProvider(
	stateManager: StateManager,
	input: { providerId: string; mode: Mode; modelId?: string },
): Partial<ApiConfiguration> {
	const providerId = input.providerId.trim()
	if (!providerId) {
		throw new Error("providerId is required")
	}
	const modelId = optionalTrim(input.modelId)
	const manager = getProviderSettingsManager()
	const existing = manager.getProviderSettings(providerId)
	manager.saveProviderSettings(
		{
			...(existing ?? {}),
			provider: providerId,
			...(modelId ? { model: modelId } : {}),
		},
		{ setLastUsed: true },
	)

	const separate = stateManager.getGlobalSettingsKey("planActSeparateModelsSetting")
	const updates: Partial<ApiConfiguration> = {}
	if (separate) {
		updates[input.mode === "plan" ? "planModeApiProvider" : "actModeApiProvider"] = providerId as ApiProvider
		if (modelId) {
			updates[input.mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"] = modelId
		}
	} else {
		updates.planModeApiProvider = providerId as ApiProvider
		updates.actModeApiProvider = providerId as ApiProvider
		if (modelId) {
			updates.planModeApiModelId = modelId
			updates.actModeApiModelId = modelId
		}
	}
	stateManager.setGlobalStateBatch(updates as any)
	return updates
}

export function saveSdkProviderSettings(
	stateManager: StateManager,
	input: SaveSdkProviderSettingsInput,
): Partial<ApiConfiguration> {
	const providerId = input.providerId.trim()
	if (!providerId) {
		throw new Error("providerId is required")
	}
	const manager = getProviderSettingsManager()
	const existing = manager.getProviderSettings(providerId)
	const apiKey = optionalTrim(input.apiKey)
	const baseUrl = optionalTrim(input.baseUrl)
	const modelId = optionalTrim(input.modelId)

	saveLocalProviderSettings(manager, {
		providerId,
		enabled: input.enabled ?? true,
		apiKey: apiKey ?? existing?.apiKey ?? existing?.auth?.apiKey,
		baseUrl: baseUrl ?? existing?.baseUrl,
		model: modelId ?? existing?.model,
		protocol: existing?.protocol,
		client: existing?.client,
		routingProviderId: existing?.routingProviderId,
		maxTokens: existing?.maxTokens,
		contextWindow: existing?.contextWindow,
		headers: existing?.headers,
		timeout: existing?.timeout,
		reasoning: existing?.reasoning,
		auth: existing?.auth,
	})
	const saved = manager.getProviderSettings(providerId)
	if (saved) {
		manager.saveProviderSettings(saved, { setLastUsed: true })
	}
	return setSelectedSdkProvider(stateManager, { providerId, mode: input.mode, modelId })
}

export function overlaySdkApiConfiguration(state: ExtensionState): ExtensionState {
	try {
		const lastUsed = getLastUsedProviderEntry()
		if (!lastUsed) {
			return state
		}
		const { providerId, settings } = lastUsed
		const apiKey = settings.auth?.accessToken ?? settings.apiKey ?? settings.auth?.apiKey
		const modelId = settings.model
		return {
			...state,
			apiConfiguration: {
				...state.apiConfiguration,
				planModeApiProvider: providerId as ApiProvider,
				actModeApiProvider: providerId as ApiProvider,
				...(modelId ? { planModeApiModelId: modelId, actModeApiModelId: modelId } : {}),
				...(apiKey ? { apiKey } : {}),
				...(settings.baseUrl ? { openAiBaseUrl: settings.baseUrl } : {}),
			},
		}
	} catch (error) {
		Logger.warn("[SdkProviderSettings] Failed to overlay SDK API configuration:", error)
		return state
	}
}
