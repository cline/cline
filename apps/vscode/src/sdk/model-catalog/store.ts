import {
	readModelsFileSync,
	resolveModelsRegistryPath,
	type StoredModelEntry,
	syncStoredProviderRegistration,
	writeModelsFileSync,
} from "@cline/core"
import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { ModelCapabilitySchema } from "@cline/shared"
import { type ApiConfiguration, type ApiProvider, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { ApiFormat } from "@shared/proto/cline/models"
import { Logger } from "@shared/services/Logger"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import { isSecretKey, isSettingsKey, type SecretKey, type SettingsKey } from "@shared/storage/state-keys"
import { StateManager } from "@/core/storage/StateManager"
import { getProviderSettingsManager } from "../provider-migration"
import type {
	Disposable,
	EffectiveProviderConfig,
	Mode,
	ModelSelection,
	ModelSelectionOverrides,
	ProviderConfigChange,
	ProviderConfigChangeListener,
	ProviderConfigPatch,
	ProviderConfigStore,
	ProviderId,
	ResolvedModelSelection,
} from "./contracts"
import { buildEffectiveProviderConfig } from "./effective-config"
import { applyHostModelInfoOverrides } from "./host-overrides"
import { fromSdkApiFormat, nonNegativeFiniteNumber, positiveFiniteNumber, toSdkApiFormat } from "./model-values"
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
		"kimi-for-coding": "kimiForCodingApiKey",
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
const selectionMemory = new Map<string, ResolvedModelSelection>()

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

function providerSettingsProviderId(providerId: ProviderId): string {
	return toSdkProviderId(providerId)
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

function sanitizeResolvedModelInfo(modelInfo: ModelInfo): ModelInfo {
	const next = { ...modelInfo }
	if (positiveFiniteNumber(next.maxTokens) === undefined) delete next.maxTokens
	if (nonNegativeFiniteNumber(next.temperature) === undefined) delete next.temperature
	return next
}

function fallbackModelInfo(modelId: string): ModelInfo {
	return sanitizeResolvedModelInfo({ ...openAiModelInfoSafeDefaults, name: modelId })
}

function toStoredCapabilities(capabilities: readonly string[] | undefined): StoredModelEntry["capabilities"] | undefined {
	if (!capabilities) {
		return undefined
	}
	// Validate against the SDK schema rather than a hardcoded list so new
	// capabilities added to ModelCapabilitySchema are never silently stripped.
	const next = new Set<NonNullable<StoredModelEntry["capabilities"]>[number]>()
	for (const capability of capabilities) {
		const parsed = ModelCapabilitySchema.safeParse(capability)
		if (parsed.success) {
			next.add(parsed.data)
		}
	}
	return next.size > 0 ? [...next] : undefined
}

function toStoredApiFormat(apiFormat: ModelInfo["apiFormat"]): StoredModelEntry["apiFormat"] | undefined {
	return toSdkApiFormat(apiFormat)
}

function fromStoredApiFormat(apiFormat: StoredModelEntry["apiFormat"]): ModelInfo["apiFormat"] | undefined {
	return fromSdkApiFormat(apiFormat)
}

function readModelsState() {
	return readModelsFileSync(resolveModelsRegistryPath(getProviderSettingsManager()))
}

/**
 * Normalizes user-authored model metadata at the host/storage boundary.
 * Token limits must be positive, prices and temperatures non-negative, and
 * unsupported capabilities/formats are omitted. UI sentinels never cross
 * this boundary; an object with no meaningful fields becomes undefined.
 */
function normalizeModelSelectionOverrides(overrides: ModelSelectionOverrides | undefined): ModelSelectionOverrides | undefined {
	if (!overrides) {
		return undefined
	}
	const maxTokens = positiveFiniteNumber(overrides.maxTokens)
	const contextWindow = positiveFiniteNumber(overrides.contextWindow)
	const maxInputTokens = positiveFiniteNumber(overrides.maxInputTokens)
	const capabilities = toStoredCapabilities(overrides.capabilities)
	const inputPrice = nonNegativeFiniteNumber(overrides.inputPrice)
	const outputPrice = nonNegativeFiniteNumber(overrides.outputPrice)
	const cacheReadsPrice = nonNegativeFiniteNumber(overrides.cacheReadsPrice)
	const cacheWritesPrice = nonNegativeFiniteNumber(overrides.cacheWritesPrice)
	const temperature = nonNegativeFiniteNumber(overrides.temperature)
	const apiFormat = toStoredApiFormat(overrides.apiFormat) !== undefined ? overrides.apiFormat : undefined
	const next: ModelSelectionOverrides = {
		...(overrides.name !== undefined ? { name: overrides.name } : {}),
		...(maxTokens !== undefined ? { maxTokens } : {}),
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
		...(capabilities !== undefined ? { capabilities } : {}),
		...(overrides.supportsVision !== undefined ? { supportsVision: overrides.supportsVision } : {}),
		...(overrides.supportsAttachments !== undefined ? { supportsAttachments: overrides.supportsAttachments } : {}),
		...(overrides.supportsReasoning !== undefined ? { supportsReasoning: overrides.supportsReasoning } : {}),
		...(inputPrice !== undefined ? { inputPrice } : {}),
		...(outputPrice !== undefined ? { outputPrice } : {}),
		...(cacheReadsPrice !== undefined ? { cacheReadsPrice } : {}),
		...(cacheWritesPrice !== undefined ? { cacheWritesPrice } : {}),
		...(temperature !== undefined ? { temperature } : {}),
		...(apiFormat !== undefined ? { apiFormat } : {}),
		...(overrides.isR1FormatRequired !== undefined ? { isR1FormatRequired: overrides.isR1FormatRequired } : {}),
	}
	return Object.keys(next).length > 0 ? next : undefined
}

function toStoredModelEntry(overrides: ModelSelectionOverrides): StoredModelEntry {
	const capabilities = toStoredCapabilities(overrides.capabilities)
	const apiFormat = toStoredApiFormat(overrides.apiFormat)
	return {
		...(overrides.name !== undefined ? { name: overrides.name } : {}),
		...(overrides.maxTokens !== undefined ? { maxTokens: overrides.maxTokens } : {}),
		...(overrides.contextWindow !== undefined ? { contextWindow: overrides.contextWindow } : {}),
		...(overrides.maxInputTokens !== undefined ? { maxInputTokens: overrides.maxInputTokens } : {}),
		...(capabilities !== undefined ? { capabilities } : {}),
		...(overrides.supportsVision !== undefined ? { supportsVision: overrides.supportsVision } : {}),
		...(overrides.supportsAttachments !== undefined ? { supportsAttachments: overrides.supportsAttachments } : {}),
		...(overrides.supportsReasoning !== undefined ? { supportsReasoning: overrides.supportsReasoning } : {}),
		...(overrides.inputPrice !== undefined ? { inputPrice: overrides.inputPrice } : {}),
		...(overrides.outputPrice !== undefined ? { outputPrice: overrides.outputPrice } : {}),
		...(overrides.cacheReadsPrice !== undefined ? { cacheReadsPrice: overrides.cacheReadsPrice } : {}),
		...(overrides.cacheWritesPrice !== undefined ? { cacheWritesPrice: overrides.cacheWritesPrice } : {}),
		...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
		...(apiFormat !== undefined ? { apiFormat } : {}),
		...(overrides.isR1FormatRequired !== undefined ? { isR1FormatRequired: overrides.isR1FormatRequired } : {}),
	}
}

function toSelectionOverrides(entry: StoredModelEntry | undefined): ModelSelectionOverrides | undefined {
	if (!entry) {
		return undefined
	}
	const apiFormat = fromStoredApiFormat(entry.apiFormat)
	return normalizeModelSelectionOverrides({
		...(entry.name !== undefined ? { name: entry.name } : {}),
		...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
		...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
		...(entry.maxInputTokens !== undefined ? { maxInputTokens: entry.maxInputTokens } : {}),
		...(entry.capabilities !== undefined ? { capabilities: [...entry.capabilities] } : {}),
		...(entry.supportsVision !== undefined ? { supportsVision: entry.supportsVision } : {}),
		...(entry.supportsAttachments !== undefined ? { supportsAttachments: entry.supportsAttachments } : {}),
		...(entry.supportsReasoning !== undefined ? { supportsReasoning: entry.supportsReasoning } : {}),
		...(entry.inputPrice !== undefined ? { inputPrice: entry.inputPrice } : {}),
		...(entry.outputPrice !== undefined ? { outputPrice: entry.outputPrice } : {}),
		...(entry.cacheReadsPrice !== undefined ? { cacheReadsPrice: entry.cacheReadsPrice } : {}),
		...(entry.cacheWritesPrice !== undefined ? { cacheWritesPrice: entry.cacheWritesPrice } : {}),
		...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
		...(apiFormat !== undefined ? { apiFormat } : {}),
		...(entry.isR1FormatRequired !== undefined ? { isR1FormatRequired: entry.isR1FormatRequired } : {}),
	})
}

function readStoredModelEntry(providerId: ProviderId, modelId: string): { exists: boolean; entry: StoredModelEntry | undefined } {
	const models = readModelsState().providers[providerSettingsProviderId(providerId)]?.models
	return {
		exists: models ? Object.hasOwn(models, modelId) : false,
		entry: models?.[modelId],
	}
}

function readModelOverrides(providerId: ProviderId, modelId: string): ModelSelectionOverrides | undefined {
	return toSelectionOverrides(readStoredModelEntry(providerId, modelId).entry)
}

function writeModelOverrides(providerId: ProviderId, modelId: string, overrides: ModelSelectionOverrides | undefined): void {
	const modelsPath = resolveModelsRegistryPath(getProviderSettingsManager())
	const state = readModelsFileSync(modelsPath)
	const provider = providerSettingsProviderId(providerId)
	const providerEntry = state.providers[provider] ?? {}
	const nextModels = { ...(providerEntry.models ?? {}) }
	const normalizedOverrides = normalizeModelSelectionOverrides(overrides)
	const storedEntry = normalizedOverrides ? toStoredModelEntry(normalizedOverrides) : undefined
	if (storedEntry && Object.keys(storedEntry).length > 0) {
		nextModels[modelId] = storedEntry
	} else {
		delete nextModels[modelId]
	}
	const nextProviderEntry = {
		...providerEntry,
		models: nextModels,
	}
	writeModelsFileSync(modelsPath, {
		...state,
		providers: {
			...state.providers,
			[provider]: nextProviderEntry,
		},
	})
	// ensureCustomProvidersLoadedSync is load-once per path and would no-op
	// here; sync the live registry explicitly so this write is visible to new
	// sessions without a restart.
	syncStoredProviderRegistration(provider, state.providers[provider], nextProviderEntry)
}

function applyModelOverrides(modelInfo: ModelInfo, overrides: ModelSelectionOverrides | undefined): ModelInfo {
	if (!overrides) {
		return modelInfo
	}
	const next: ModelInfo = { ...modelInfo }
	if (overrides.name !== undefined) next.name = overrides.name
	if (overrides.maxTokens !== undefined) next.maxTokens = overrides.maxTokens
	if (overrides.contextWindow !== undefined) next.contextWindow = overrides.contextWindow
	if (overrides.maxInputTokens !== undefined)
		(next as ModelInfo & { maxInputTokens?: number }).maxInputTokens = overrides.maxInputTokens
	if (overrides.inputPrice !== undefined) next.inputPrice = overrides.inputPrice
	if (overrides.outputPrice !== undefined) next.outputPrice = overrides.outputPrice
	if (overrides.cacheReadsPrice !== undefined) next.cacheReadsPrice = overrides.cacheReadsPrice
	if (overrides.cacheWritesPrice !== undefined) next.cacheWritesPrice = overrides.cacheWritesPrice
	if (overrides.temperature !== undefined) next.temperature = overrides.temperature
	if (overrides.apiFormat !== undefined) next.apiFormat = overrides.apiFormat

	// Capability arrays are additive fallback flags: they can only enable
	// capabilities the base metadata lacks, never disable base capabilities
	// (an array authored for one purpose, e.g. prompt-cache, must not strip
	// unrelated base flags like vision). Explicit booleans win when both
	// representations are present.
	if (overrides.capabilities !== undefined) {
		if (overrides.capabilities.includes("images")) next.supportsImages = true
		if (overrides.capabilities.includes("prompt-cache")) next.supportsPromptCache = true
		if (overrides.capabilities.includes("reasoning")) next.supportsReasoning = true
	}
	if (overrides.supportsVision !== undefined) next.supportsImages = overrides.supportsVision
	if (overrides.supportsReasoning !== undefined) next.supportsReasoning = overrides.supportsReasoning

	// apiFormat is canonical. The legacy R1 flag remains a compatibility alias
	// that forces R1 only when explicitly true.
	if (overrides.isR1FormatRequired) next.apiFormat = ApiFormat.R1_CHAT
	return next
}

function readBaseModelInfoForProvider(providerId: ProviderId, modelId: string): ModelInfo | undefined {
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

function resolveSelection(selection: ModelSelection, stateModelInfoHint?: ModelInfo): ResolvedModelSelection {
	const overrides = normalizeModelSelectionOverrides(
		selection.overrides ?? readModelOverrides(selection.providerId, selection.modelId),
	)
	// Base resolution order: SDK catalog, then the picker's persisted state
	// snapshot (the only accurate data for dynamic-list models the static
	// catalog does not know), then provider-safe fallback defaults.
	const catalogModelInfo = readBaseModelInfoForProvider(selection.providerId, selection.modelId)
	const baseModelInfo = catalogModelInfo ?? stateModelInfoHint ?? fallbackModelInfo(selection.modelId)
	const modelInfoSource = catalogModelInfo ? "catalog" : stateModelInfoHint ? "state" : "fallback"
	return {
		...selection,
		overrides,
		modelInfoSource,
		baseModelInfo,
		modelInfo: sanitizeResolvedModelInfo(applyModelOverrides(baseModelInfo, overrides)),
	}
}

export function resolveRuntimeModelSelection(providerId: ProviderId, modelId: string): ResolvedModelSelection {
	return resolveSelection({ providerId, modelId })
}

function readSelectionFromProviderSettings(providerId: ProviderId): ResolvedModelSelection | undefined {
	const modelId = readProviderSettingsModelId(providerId)
	if (!modelId) {
		return undefined
	}

	return resolveSelection({ providerId, modelId })
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

	// Mirror the Ollama context window to the legacy state key so older
	// readers (proto ApiConfiguration, webview display fallback) stay in sync
	// with providers.json.
	if (provider === "ollama" && "contextWindow" in patch) {
		const contextWindow = patch.contextWindow
		writeStateKey(
			"ollamaApiOptionsCtxNum",
			typeof contextWindow === "number" && contextWindow > 0 ? String(contextWindow) : undefined,
		)
	}
}

function getProviderSettings(providerId: ProviderId): ProviderSettingsRecord {
	const settings = getProviderSettingsManager().getProviderSettings(providerSettingsProviderId(providerId))
	return isRecord(settings) ? settings : {}
}

function saveProviderSettings(providerId: ProviderId, next: ProviderSettingsRecord): void {
	const provider = providerSettingsProviderId(providerId)
	getProviderSettingsManager().saveProviderSettings({ ...next, provider }, { setLastUsed: false })
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

	if ("contextWindow" in patch) {
		const contextWindow = patch.contextWindow
		if (typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0) {
			next.contextWindow = Math.floor(contextWindow)
		} else {
			delete next.contextWindow
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

function writeSelectionToState(providerId: ProviderId, mode: Mode, selection: ResolvedModelSelection): void {
	const updates: Partial<Record<SettingsKey, unknown>> = {}
	for (const targetMode of syncedModes(mode)) {
		updates[getModelIdKey(providerId, targetMode)] = selection.modelId
		const modelInfoKey = getModelInfoKey(providerId, targetMode)
		if (modelInfoKey) {
			// For hint-eligible providers the snapshot must stay genuine base
			// metadata: never persist fabricated fallback data (later reads
			// would treat it as authoritative "state" data and shadow live
			// catalog lookups), and persist the pre-override base rather than
			// the resolved value (a deleted override must not be resurrected
			// from a snapshot it was baked into). openai-compatible keeps the
			// legacy resolved write — its snapshot is never used as a
			// resolution base, and old extension versions still read it after
			// a rollback.
			if (usesStateModelInfoHint(providerId)) {
				updates[modelInfoKey] =
					selection.modelInfoSource === "fallback" ? undefined : (selection.baseModelInfo ?? selection.modelInfo)
			} else {
				updates[modelInfoKey] = selection.modelInfo
			}
		}
		selectionMemory.set(memoryKey(providerId, targetMode), { ...selection, providerId })
	}
	StateManager.get().setGlobalStateBatch(updates as never)
}

function writeSelectionToProviderSettings(providerId: ProviderId, selection: ModelSelection): void {
	const next: ProviderSettingsRecord = { ...getProviderSettings(providerId), model: selection.modelId }
	// Prune model metadata that earlier builds may have written to
	// providers.json — except for Ollama, whose contextWindow is a real
	// user setting (maps to num_ctx) written by the settings UI.
	if (providerKey(providerId) !== "ollama") {
		delete next.contextWindow
	}
	delete next.maxTokens

	saveProviderSettings(providerId, next)
}

type LegacyModelInfo = ModelInfo & { maxInputTokens?: number; isR1FormatRequired?: boolean }
type MutableModelSelectionOverrides = { -readonly [Key in keyof ModelSelectionOverrides]: ModelSelectionOverrides[Key] }

function legacyModelInfoToOverrides(modelInfo: LegacyModelInfo, fallback: ModelInfo): ModelSelectionOverrides | undefined {
	const fallbackInfo = fallback as LegacyModelInfo
	const overrides: MutableModelSelectionOverrides = {}
	if (modelInfo.name !== undefined && modelInfo.name !== fallback.name) overrides.name = modelInfo.name
	if (modelInfo.maxTokens !== undefined && modelInfo.maxTokens !== fallback.maxTokens) overrides.maxTokens = modelInfo.maxTokens
	if (modelInfo.contextWindow !== undefined && modelInfo.contextWindow !== fallback.contextWindow)
		overrides.contextWindow = modelInfo.contextWindow
	if (modelInfo.maxInputTokens !== undefined && modelInfo.maxInputTokens !== fallbackInfo.maxInputTokens)
		overrides.maxInputTokens = modelInfo.maxInputTokens

	const supportsVision = modelInfo.supportsImages ?? fallback.supportsImages
	if (Boolean(supportsVision) !== Boolean(fallback.supportsImages)) overrides.supportsVision = Boolean(supportsVision)
	if (Boolean(modelInfo.supportsReasoning) !== Boolean(fallback.supportsReasoning))
		overrides.supportsReasoning = Boolean(modelInfo.supportsReasoning)
	if (modelInfo.supportsPromptCache !== fallback.supportsPromptCache) {
		const capabilities: string[] = []
		if (supportsVision) capabilities.push("images")
		if (modelInfo.supportsPromptCache) capabilities.push("prompt-cache")
		overrides.capabilities = capabilities
	}

	if (modelInfo.inputPrice !== undefined && modelInfo.inputPrice !== fallback.inputPrice)
		overrides.inputPrice = modelInfo.inputPrice
	if (modelInfo.outputPrice !== undefined && modelInfo.outputPrice !== fallback.outputPrice)
		overrides.outputPrice = modelInfo.outputPrice
	if (modelInfo.cacheReadsPrice !== undefined && modelInfo.cacheReadsPrice !== fallback.cacheReadsPrice)
		overrides.cacheReadsPrice = modelInfo.cacheReadsPrice
	if (modelInfo.cacheWritesPrice !== undefined && modelInfo.cacheWritesPrice !== fallback.cacheWritesPrice)
		overrides.cacheWritesPrice = modelInfo.cacheWritesPrice
	if (modelInfo.temperature !== undefined && modelInfo.temperature !== fallback.temperature)
		overrides.temperature = modelInfo.temperature
	if (modelInfo.apiFormat !== undefined && modelInfo.apiFormat !== fallback.apiFormat) overrides.apiFormat = modelInfo.apiFormat
	if (modelInfo.isR1FormatRequired === true && fallbackInfo.isR1FormatRequired !== true) overrides.isR1FormatRequired = true
	return normalizeModelSelectionOverrides(overrides)
}

// Providers/models whose legacy-state migration has already been attempted in
// this process. The migration runs from the read path, so it must be cheap on
// repeat reads and must never run more than once per selection — including
// when the legacy snapshot diffs to an empty override set and nothing is
// written.
const attemptedLegacyMigrations = new Set<string>()

function migrateLegacyModelOverridesIfNeeded(providerId: ProviderId, modelId: string, modelInfo: ModelInfo): void {
	if (providerSettingsProviderId(providerId) !== "openai-compatible") {
		return
	}
	const migrationKey = `${providerId}:${modelId}`
	if (attemptedLegacyMigrations.has(migrationKey)) {
		return
	}
	attemptedLegacyMigrations.add(migrationKey)
	if (readStoredModelEntry(providerId, modelId).exists) {
		return
	}
	if (readBaseModelInfoForProvider(providerId, modelId) !== undefined) {
		return
	}
	const overrides = legacyModelInfoToOverrides(modelInfo as LegacyModelInfo, fallbackModelInfo(modelId))
	if (overrides) {
		try {
			writeModelOverrides(providerId, modelId, overrides)
		} catch (error) {
			// The migration is best-effort and runs inside read paths; a
			// failed write (read-only fs, disk full) must not fail read RPCs.
			Logger.warn(
				`[ModelCatalog] Failed to migrate legacy overrides for provider=${providerId} model=${modelId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}
}

/**
 * The picker writes the live model metadata to the mode-specific
 * `*ModeModelInfo` state key before committing. When the state still refers to
 * the model being resolved, that snapshot is the best available base for
 * dynamic-list models the static catalog does not know.
 *
 * openai-compatible is excluded: its legacy state snapshot is user-authored
 * metadata that {@link migrateLegacyModelOverridesIfNeeded} converts into
 * models.json overrides, which are the source of truth there. Feeding the
 * snapshot back as a base would resurrect overrides the user deleted.
 */
function usesStateModelInfoHint(providerId: ProviderId): boolean {
	return providerSettingsProviderId(providerId) !== "openai-compatible"
}

/**
 * Pickers write `{ ...openAiModelInfoSafeDefaults, name: modelId }` to the
 * state key when the user selects an id the live model list does not (yet)
 * contain. Such a snapshot carries no real information and must not be
 * treated as authoritative "state" metadata.
 */
function isSafeDefaultsSnapshot(modelInfo: ModelInfo, modelId: string): boolean {
	const fabricated: Record<string, unknown> = { ...openAiModelInfoSafeDefaults, name: modelId }
	const snapshot = modelInfo as unknown as Record<string, unknown>
	for (const key of new Set([...Object.keys(fabricated), ...Object.keys(snapshot)])) {
		if (fabricated[key] !== snapshot[key]) {
			return false
		}
	}
	return true
}

function readStateModelInfoHint(providerId: ProviderId, mode: Mode, modelId: string): ModelInfo | undefined {
	if (!usesStateModelInfoHint(providerId)) {
		return undefined
	}
	const modelInfoKey = getModelInfoKey(providerId, mode)
	if (!modelInfoKey) {
		return undefined
	}
	const apiConfiguration = StateManager.get().getApiConfiguration()
	const stateModelId = apiConfiguration[getModelIdKey(providerId, mode)]
	const stateModelInfo = apiConfiguration[modelInfoKey]
	return stateModelId === modelId && isModelInfo(stateModelInfo) && !isSafeDefaultsSnapshot(stateModelInfo, modelId)
		? stateModelInfo
		: undefined
}

function readSelectionFromState(providerId: ProviderId, mode: Mode): ResolvedModelSelection | undefined {
	const apiConfiguration = StateManager.get().getApiConfiguration()
	const modelId = apiConfiguration[getModelIdKey(providerId, mode)]
	const modelInfoKey = getModelInfoKey(providerId, mode)
	const rememberedSelection = selectionMemory.get(memoryKey(providerId, mode))

	if (modelInfoKey) {
		const modelInfo = apiConfiguration[modelInfoKey]
		if (typeof modelId !== "string" || modelId.length === 0) {
			return readSelectionFromProviderSettings(providerId)
		}
		// The mode-specific model id alone identifies the selection; the state
		// modelInfo snapshot is optional input for legacy migration and, for
		// dynamic-list providers, the base-metadata hint. Fallback-tier commits
		// intentionally leave it unset.
		if (isModelInfo(modelInfo)) {
			migrateLegacyModelOverridesIfNeeded(providerId, modelId, modelInfo)
		}
		return resolveSelection({ providerId, modelId }, readStateModelInfoHint(providerId, mode, modelId))
	}

	const providerSettingsSelection = readSelectionFromProviderSettings(providerId)
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

		readSelection(providerId: ProviderId, mode: Mode): ResolvedModelSelection | undefined {
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
			writeSelectionToProviderSettings(providerId, selection)
			if (selection.overrides !== undefined) {
				writeModelOverrides(providerId, selection.modelId, selection.overrides)
			}
			// Read the picker-written state snapshot before writeSelectionToState
			// replaces it, so dynamic-list models keep their live metadata instead
			// of being re-resolved to fallback defaults.
			const stateModelInfoHint = readStateModelInfoHint(providerId, mode, selection.modelId)
			const resolvedSelection = resolveSelection({ providerId, modelId: selection.modelId }, stateModelInfoHint)
			writeSelectionToState(providerId, mode, resolvedSelection)
			emit({ kind: "selection", providerId, mode, selection: resolvedSelection })
		},
	}
}
