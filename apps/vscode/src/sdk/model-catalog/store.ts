import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { type ApiConfiguration, type ApiProvider, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
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
import { applyHostModelInfoOverrides } from "./host-overrides"
import { toSdkProviderId } from "./sdk-provider-id"
import { adaptSdkModelInfo } from "./shape-adapter"

type ProviderSettingsRecord = Record<string, unknown>
type ProviderSettingsPatchKey = "apiKey" | "baseUrl" | "apiLine" | "headers" | "region" | "auth" | "extras" | "aws" | "gcp"

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
	aws: {},
	gcp: {},
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

// In-memory selection envelope for providers that have a mode-specific model
// id key but no durable `*ModelInfo` key in the StateManager schema (for
// example DeepSeek/Gemini/generic SDK-backed providers). Keyed by
// provider+mode so that switching between providers that share the same
// `*ModeApiModelId` key does not combine one provider's model id with
// another provider's model info.
const selectionMemory = new Map<string, ModelSelection>()

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

// Legacy VS Code selection persistence can copy catalog model maxTokens into
// providers.json. Only keep that value for providers with a user-editable max
// output token setting; otherwise it becomes an accidental request cap in SDK.
function shouldPersistMaxTokens(providerId: ProviderId): boolean {
	const key = providerKey(providerId)
	return key === "openai" || key === "ollama"
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

function isKnownModelIdForProvider(providerId: ProviderId, modelId: string): boolean {
	const sdkProviderId = toSdkProviderId(providerId)
	return Boolean(
		getGeneratedModelsForProvider(sdkProviderId)[modelId] || MODEL_COLLECTIONS_BY_PROVIDER_ID[sdkProviderId]?.models[modelId],
	)
}

function readProviderSettingsModelId(providerId: ProviderId): string | undefined {
	const model = getProviderSettings(providerId).model
	return typeof model === "string" && model.trim().length > 0 ? model.trim() : undefined
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
		modelInfo: readKnownModelInfoForProvider(providerId, modelId) ?? fallbackModelInfo(modelId),
	}
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
			const value = typeof patch[key] === "string" ? patchStringValue(patch[key]) : patchValue(patch[key])
			writeStateKey(stateKey, value)
		}
	}

	if (provider === "vertex" && "gcp" in patch) {
		const gcp = patch.gcp
		if (gcp === null || gcp === undefined) {
			writeStateKey("vertexProjectId", undefined)
			writeStateKey("vertexRegion", undefined)
		} else {
			if ("projectId" in gcp) writeStateKey("vertexProjectId", patchStringValue(gcp.projectId))
			if ("region" in gcp) writeStateKey("vertexRegion", patchStringValue(gcp.region))
		}
	}

	if (provider === "bedrock" && "aws" in patch) {
		const aws = patch.aws
		if (aws === null || aws === undefined) {
			writeStateKey("awsAccessKey", undefined)
			writeStateKey("awsSecretKey", undefined)
			writeStateKey("awsSessionToken", undefined)
			writeStateKey("awsAuthentication", undefined)
			writeStateKey("awsProfile", undefined)
			writeStateKey("awsBedrockUsePromptCache", undefined)
			writeStateKey("awsBedrockEndpoint", undefined)
		} else {
			if ("accessKey" in aws) writeStateKey("awsAccessKey", patchStringValue(aws.accessKey))
			if ("secretKey" in aws) writeStateKey("awsSecretKey", patchStringValue(aws.secretKey))
			if ("sessionToken" in aws) writeStateKey("awsSessionToken", patchStringValue(aws.sessionToken))
			if ("authentication" in aws) writeStateKey("awsAuthentication", patchStringValue(aws.authentication))
			if ("profile" in aws) writeStateKey("awsProfile", patchStringValue(aws.profile))
			if ("usePromptCache" in aws) writeStateKey("awsBedrockUsePromptCache", aws.usePromptCache)
			if ("endpoint" in aws) writeStateKey("awsBedrockEndpoint", patchStringValue(aws.endpoint))
			if ("customModelBaseId" in aws) {
				const customModelBaseId = patchStringValue(aws.customModelBaseId)
				writeStateKey("planModeAwsBedrockCustomModelBaseId", customModelBaseId)
				writeStateKey("actModeAwsBedrockCustomModelBaseId", customModelBaseId)
			}
			if ("useCrossRegionInference" in aws) writeStateKey("awsUseCrossRegionInference", aws.useCrossRegionInference)
			if ("useGlobalInference" in aws) writeStateKey("awsUseGlobalInference", aws.useGlobalInference)
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
			const value = typeof patch[key] === "string" ? patchStringValue(patch[key]) : patchValue(patch[key])
			if (value === undefined) {
				delete next[key]
			} else {
				next[key] = value
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
			next.aws = nextAws
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
		selectionMemory.set(memoryKey(providerId, targetMode), { ...selection, providerId })
	}
	StateManager.get().setGlobalStateBatch(updates as never)
}

function writeSelectionToProviderSettings(providerId: ProviderId, selection: ModelSelection): void {
	const next: ProviderSettingsRecord = { ...getProviderSettings(providerId), model: selection.modelId }

	if (selection.modelInfo.contextWindow !== undefined && selection.modelInfo.contextWindow > 0) {
		next.contextWindow = selection.modelInfo.contextWindow
	}

	if (shouldPersistMaxTokens(providerId)) {
		if (selection.modelInfo.maxTokens !== undefined && selection.modelInfo.maxTokens > 0) {
			next.maxTokens = selection.modelInfo.maxTokens
		}
	} else {
		delete next.maxTokens
	}

	saveProviderSettings(providerId, next)
}

function readSelectionFromState(providerId: ProviderId, mode: Mode): ModelSelection | undefined {
	const apiConfiguration = StateManager.get().getApiConfiguration()
	const modelId = apiConfiguration[getModelIdKey(providerId, mode)]
	const modelInfoKey = getModelInfoKey(providerId, mode)
	const rememberedSelection = selectionMemory.get(memoryKey(providerId, mode))
	const providerSettingsSelection = readSelectionFromProviderSettings(providerId)

	if (modelInfoKey) {
		const modelInfo = apiConfiguration[modelInfoKey]
		if (typeof modelId !== "string" || modelId.length === 0 || !isModelInfo(modelInfo)) {
			return providerSettingsSelection
		}
		return { providerId, modelId, modelInfo }
	}

	const activeProvider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
	const provider = providerForStorage(providerId)
	if (activeProvider !== provider) {
		return rememberedSelection ?? providerSettingsSelection
	}

	if (typeof modelId !== "string" || modelId.length === 0) {
		return rememberedSelection ?? providerSettingsSelection
	}

	if (!isKnownModelIdForProvider(providerId, modelId)) {
		return rememberedSelection ?? providerSettingsSelection
	}

	if (!rememberedSelection || rememberedSelection.modelId !== modelId) {
		return providerSettingsSelection
	}
	return rememberedSelection
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
