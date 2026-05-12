import type { ApiConfiguration, ApiProvider, ModelInfo } from "@shared/api"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import { isSecretKey, isSettingsKey, type SecretKey, type SettingsKey } from "@shared/storage/state-keys"
import { StateManager } from "@/core/storage/StateManager"
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

type ProviderSettingsRecord = Record<string, unknown>
type ProviderSettingsPatchKey = "apiKey" | "baseUrl" | "apiLine" | "headers" | "region" | "auth" | "extras"

type ModelInfoKeys = {
	readonly plan: keyof ApiConfiguration & SettingsKey
	readonly act: keyof ApiConfiguration & SettingsKey
}

const providerConfigStateKeys: Record<ProviderSettingsPatchKey, Partial<Record<string, SecretKey | SettingsKey>>> = {
	apiKey: {
		anthropic: "apiKey",
		openrouter: "openRouterApiKey",
		openai: "openAiApiKey",
		"openai-native": "openAiNativeApiKey",
		"openai-codex": "openAiNativeApiKey",
		bedrock: "awsBedrockApiKey",
		gemini: "geminiApiKey",
		deepseek: "deepSeekApiKey",
		ollama: "ollamaApiKey",
		requesty: "requestyApiKey",
		together: "togetherApiKey",
		fireworks: "fireworksApiKey",
		qwen: "qwenApiKey",
		"qwen-code": "qwenApiKey",
		doubao: "doubaoApiKey",
		mistral: "mistralApiKey",
		litellm: "liteLlmApiKey",
		asksage: "asksageApiKey",
		xai: "xaiApiKey",
		moonshot: "moonshotApiKey",
		zai: "zaiApiKey",
		huggingface: "huggingFaceApiKey",
		nebius: "nebiusApiKey",
		sambanova: "sambanovaApiKey",
		cerebras: "cerebrasApiKey",
		groq: "groqApiKey",
		baseten: "basetenApiKey",
		"huawei-cloud-maas": "huaweiCloudMaasApiKey",
		dify: "difyApiKey",
		minimax: "minimaxApiKey",
		hicap: "hicapApiKey",
		aihubmix: "aihubmixApiKey",
		nousresearch: "nousResearchApiKey",
		"vercel-ai-gateway": "vercelAiGatewayApiKey",
		wandb: "wandbApiKey",
		oca: "ocaApiKey",
		cline: "clineApiKey",
	},
	baseUrl: {
		anthropic: "anthropicBaseUrl",
		openai: "openAiBaseUrl",
		ollama: "ollamaBaseUrl",
		lmstudio: "lmStudioBaseUrl",
		gemini: "geminiBaseUrl",
		requesty: "requestyBaseUrl",
		asksage: "asksageApiUrl",
		litellm: "liteLlmBaseUrl",
		sapaicore: "sapAiCoreBaseUrl",
		dify: "difyBaseUrl",
		oca: "ocaBaseUrl",
		aihubmix: "aihubmixBaseUrl",
	},
	apiLine: { qwen: "qwenApiLine", moonshot: "moonshotApiLine", zai: "zaiApiLine", minimax: "minimaxApiLine" },
	headers: { openai: "openAiHeaders" },
	region: { bedrock: "awsRegion", vertex: "vertexRegion" },
	auth: {},
	extras: {},
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

const selectionInfoMemory = new Map<string, ModelInfo>()

function providerKey(providerId: ProviderId): string {
	return providerId.toString()
}

function providerForStorage(providerId: ProviderId): ApiProvider | undefined {
	const key = providerKey(providerId)
	if (key === "nousresearch") {
		return "nousResearch"
	}
	return key as ApiProvider
}

function memoryKey(providerId: ProviderId, mode: Mode): string {
	return `${providerId}:${mode}`
}

function modePair<T>(mode: Mode, plan: T, act: T): T {
	return mode === "plan" ? plan : act
}

function patchValue<T>(value: T | null | undefined): T | undefined {
	return value === null ? undefined : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isModelInfo(value: unknown): value is ModelInfo {
	return isRecord(value) && typeof value.supportsPromptCache === "boolean"
}

function writeStateKey(key: SecretKey | SettingsKey, value: unknown): void {
	const stateManager = StateManager.get()
	if (isSecretKey(key)) {
		stateManager.setSecret(key, typeof value === "string" ? value : undefined)
		return
	}
	if (isSettingsKey(key)) {
		stateManager.setGlobalState(key, value as never)
	}
}

function writeStateFields(providerId: ProviderId, patch: ProviderConfigPatch): void {
	const provider = providerKey(providerId)
	for (const key of ["apiKey", "baseUrl", "apiLine", "headers", "region"] as const) {
		if (!(key in patch)) {
			continue
		}
		const stateKey = providerConfigStateKeys[key][provider]
		if (stateKey) {
			writeStateKey(stateKey, patchValue(patch[key]))
		}
	}

	if (provider === "cline" && "auth" in patch) {
		writeStateKey("clineApiKey", patch.auth?.accessToken)
		writeStateKey("clineAccountId", patch.auth?.accountId)
	}
}

function getProviderSettings(providerId: ProviderId): ProviderSettingsRecord {
	const settings = getProviderSettingsManager().getProviderSettings(providerId)
	return isRecord(settings) ? settings : {}
}

function saveProviderSettings(providerId: ProviderId, next: ProviderSettingsRecord): void {
	getProviderSettingsManager().saveProviderSettings({ provider: providerId, ...next }, { setLastUsed: false })
}

function writeProviderSettingsFields(providerId: ProviderId, patch: ProviderConfigPatch): void {
	const existing = getProviderSettings(providerId)
	const next: ProviderSettingsRecord = { ...existing }

	for (const key of ["apiKey", "baseUrl", "apiLine", "headers", "region", "auth", "extras"] as const) {
		if (key in patch) {
			const value = patchValue(patch[key])
			if (value === undefined) {
				delete next[key]
			} else {
				next[key] = value
			}
		}
	}

	saveProviderSettings(providerId, next)
}

function getModelIdKey(providerId: ProviderId, mode: Mode): keyof ApiConfiguration & SettingsKey {
	return getProviderModelIdKey(providerForStorage(providerId) ?? "anthropic", mode) as keyof ApiConfiguration & SettingsKey
}

function getModelInfoKey(providerId: ProviderId, mode: Mode): (keyof ApiConfiguration & SettingsKey) | undefined {
	const keys = modelInfoKeysByProvider[providerKey(providerId)]
	return keys ? modePair(mode, keys.plan, keys.act) : undefined
}

function syncedModes(mode: Mode): Mode[] {
	return StateManager.get().getGlobalSettingsKey("planActSeparateModelsSetting") ? [mode] : ["plan", "act"]
}

function writeSelectionToState(providerId: ProviderId, mode: Mode, selection: ModelSelection): void {
	const updates: Partial<Record<SettingsKey, unknown>> = {}
	for (const targetMode of syncedModes(mode)) {
		updates[getModelIdKey(providerId, targetMode)] = selection.modelId
		const modelInfoKey = getModelInfoKey(providerId, targetMode)
		if (modelInfoKey) {
			updates[modelInfoKey] = selection.modelInfo
		}
		selectionInfoMemory.set(memoryKey(providerId, targetMode), selection.modelInfo)
	}
	StateManager.get().setGlobalStateBatch(updates as never)
}

function writeSelectionToProviderSettings(providerId: ProviderId, selection: ModelSelection): void {
	if (StateManager.get().getGlobalSettingsKey("planActSeparateModelsSetting")) {
		return
	}
	saveProviderSettings(providerId, { ...getProviderSettings(providerId), model: selection.modelId })
}

function readSelectionFromState(providerId: ProviderId, mode: Mode): ModelSelection | undefined {
	const apiConfiguration = StateManager.get().getApiConfiguration()
	const modelId = apiConfiguration[getModelIdKey(providerId, mode)]
	const modelInfoKey = getModelInfoKey(providerId, mode)
	const modelInfo = modelInfoKey ? apiConfiguration[modelInfoKey] : selectionInfoMemory.get(memoryKey(providerId, mode))

	if (typeof modelId !== "string" || modelId.length === 0 || !isModelInfo(modelInfo)) {
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
			writeStateFields(providerId, patch)
			writeProviderSettingsFields(providerId, patch)
			const config = this.read(providerId)
			emit({ kind: "fields", providerId, config })
			return config
		},

		commitSelection(providerId: ProviderId, mode: Mode, selection: ModelSelection): void {
			writeSelectionToState(providerId, mode, selection)
			writeSelectionToProviderSettings(providerId, selection)
			emit({ kind: "selection", providerId, mode, selection })
		},
	}
}
