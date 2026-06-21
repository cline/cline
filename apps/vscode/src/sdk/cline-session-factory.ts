// Replaces classic task creation from src/core/task/index.ts (see origin/main)
//
// Creates and manages SDK sessions using ClineCore. This factory handles:
// - Creating ClineCore instances with proper configuration
// - Building session config from SDK provider settings plus VS Code host state
// - Custom session persistence adapter reading ~/.cline/data/tasks/
// - Mapping HistoryItem ↔ SDK session fields
//
// The factory does NOT handle UI concerns — that's the SdkController's job.

import {
	type ClineCoreStartInput,
	type CoreSessionConfig,
	getProviderAuthHandler,
	type ProviderSettings,
	resolveProviderApiKeyFromSettings,
	type StartSessionResult,
} from "@cline/core"
import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { buildClineSystemPrompt } from "@cline/shared"
import type { ApiConfiguration } from "@shared/api"
import type { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, type LanguageDisplay } from "@shared/Languages"
import {
	isVscodeUnsupportedProvider,
	toVscodeSupportedProvider,
	VSCODE_DEFAULT_PROVIDER_ID,
} from "@shared/model-catalog/provider-helpers"
import { Logger } from "@shared/services/Logger"
import type { RemoteProviderModelSettings, Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import { stringifyVsCodeLmModelSelector } from "@shared/vsCodeSelectorUtils"
import { mirrorPlanActApiConfiguration } from "@/core/controller/models/sharedModeConfiguration"
import { StateManager } from "@/core/storage/StateManager"
import { ExtensionRegistryInfo } from "@/registry"
import { getDistinctId } from "@/services/logging/distinctId"
import { fetch } from "@/shared/net"
import { buildAgentHooks } from "./hooks-adapter"
import { readTaskHistory, resolveDataDir } from "./legacy-state-reader"
import { buildEffectiveProviderConfig, buildRemoteProviderConfig } from "./model-catalog/effective-config"
import { parseProviderId } from "./model-catalog/provider-id"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"
import { getProviderSettingsManager } from "./provider-migration"
import type { SdkSessionHost } from "./session-host"

// ---------------------------------------------------------------------------
// Plan mode instructions
// ---------------------------------------------------------------------------

/**
 * Instructions appended to the system prompt when the session is in plan mode.
 * Mirrors the CLI's plan-mode guardrails in apps/cli/src/runtime/prompt.ts so
 * plan mode in VSCode has the same explicit "explore/analyze/plan, do not
 * implement" guidance.
 */
const PLAN_MODE_INSTRUCTIONS = `# Plan Mode

You are in Plan mode. Your role is to explore, analyze, and plan -- not to execute.

- Read files, search the codebase, and gather context to understand the problem
- Ask clarifying questions when requirements are ambiguous
- Present your plan as a structured outline with clear steps
- Explain tradeoffs between different approaches when they exist
- Do NOT edit files, write code, run destructive commands, or make any changes
- Do NOT implement anything -- focus on understanding and alignment first

Once the user has reviewed your plan and explicitly approved it in a follow-up message, use the switch_to_act_mode tool to switch to act mode and begin implementation. Calling switch_to_act_mode immediately starts execution, so never call it in the same turn you present a plan and never treat the original task request as approval -- end your turn after presenting the plan and wait for the user's response.`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for creating a new session */
export interface SessionConfigInput {
	/** The user's prompt */
	prompt?: string
	/** Images attached to the message */
	images?: string[]
	/** Files attached to the message */
	files?: string[]
	/** History item to resume (for task resumption) */
	historyItem?: HistoryItem
	/** Task-specific settings overrides */
	taskSettings?: Partial<Settings>
	/** Working directory */
	cwd: string
	/** Workspace root */
	workspaceRoot?: string
	/** Current mode (act/plan) */
	mode?: Mode
}

/** Active session state tracked by the factory */
export interface ActiveSession {
	/** The session ID */
	sessionId: string
	/** The runtime host instance managing this session (VscodeSessionHost) */
	sdkHost: SdkSessionHost
	/** Unsubscribe function for session events */
	unsubscribe: () => void
	/** The start result from the session */
	startResult?: StartSessionResult
	/** Whether the session is currently running */
	isRunning: boolean
}

function createSdkLogger() {
	return {
		debug: (message: string, metadata?: Record<string, unknown>) => {
			Logger.debug(message, metadata)
		},
		log: (message: string, metadata?: Record<string, unknown>) => {
			Logger.log(message, metadata)
		},
		error: (message: string, metadata?: Record<string, unknown>) => {
			Logger.error(message, metadata)
		},
	}
}

function resolveWorkspaceName(workspacePath: string): string {
	const trimmed = workspacePath.trim()
	const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/, "")
	const name = withoutTrailingSeparators.split(/[\\/]/).filter(Boolean).pop()?.trim()
	return name || "workspace"
}

type ReasoningEffort = NonNullable<CoreSessionConfig["reasoningEffort"]>
type ProviderReasoningSettings = NonNullable<ProviderSettings["reasoning"]>
type SessionReasoningConfig = Pick<CoreSessionConfig, "thinking" | "reasoningEffort">
type RuntimeProviderConfig = NonNullable<CoreSessionConfig["providerConfig"]>

function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return value === "low" || value === "medium" || value === "high" || value === "xhigh"
}

function hasStaleDisabledReasoningFields(reasoning: ProviderReasoningSettings | undefined): boolean {
	return reasoning?.enabled === false && (reasoning.effort !== undefined || reasoning.budgetTokens !== undefined)
}

function resolvePersistedProviderConfig(
	providerId: string,
	dataDir: string = resolveDataDir(),
): RuntimeProviderConfig | undefined {
	const manager = getProviderSettingsManager(dataDir)
	const sdkProviderId = toSdkProviderId(providerId)
	return (
		manager.getProviderConfig(sdkProviderId, { includeKnownModels: false }) ??
		manager.getProviderConfig(providerId, { includeKnownModels: false })
	)
}

function resolvePersistedProviderSettings(providerId: string, dataDir: string = resolveDataDir()): ProviderSettings | undefined {
	const manager = getProviderSettingsManager(dataDir)
	const sdkProviderId = toSdkProviderId(providerId)
	return manager.getProviderSettings(sdkProviderId) ?? manager.getProviderSettings(providerId)
}

/**
 * Convert SDK provider-level reasoning settings into the SDK session fields that
 * are actually forwarded as model options. Keep `thinking` and
 * `reasoningEffort` coherent: a disabled/none state must never carry an effort.
 */
export function normalizeProviderReasoningSettings(reasoning: ProviderReasoningSettings | undefined): SessionReasoningConfig {
	if (!reasoning) {
		return {}
	}

	if (reasoning.enabled === false || reasoning.effort === "none") {
		return { thinking: false }
	}

	if (reasoning.enabled === true) {
		return {
			thinking: true,
			...(isReasoningEffort(reasoning.effort) ? { reasoningEffort: reasoning.effort } : {}),
		}
	}

	return isReasoningEffort(reasoning.effort) ? { reasoningEffort: reasoning.effort } : {}
}

function hasSessionReasoningConfig(config: SessionReasoningConfig): boolean {
	return config.thinking !== undefined || config.reasoningEffort !== undefined
}

function normalizeLegacyReasoningEffort(value: unknown): SessionReasoningConfig {
	if (value === "none") {
		return { thinking: false }
	}
	if (isReasoningEffort(value)) {
		return { thinking: true, reasoningEffort: value }
	}
	return {}
}

function resolveLegacyReasoningConfig(providerId: string, mode: Mode, apiConfig: ApiConfiguration): SessionReasoningConfig {
	const sdkProviderId = toSdkProviderId(providerId)
	if (sdkProviderId === "openai-codex") {
		return normalizeLegacyReasoningEffort(
			mode === "plan" ? apiConfig.planModeReasoningEffort : apiConfig.actModeReasoningEffort,
		)
	}
	if (sdkProviderId === "oca") {
		return normalizeLegacyReasoningEffort(
			mode === "plan" ? apiConfig.planModeOcaReasoningEffort : apiConfig.actModeOcaReasoningEffort,
		)
	}
	return {}
}

function resolveProviderReasoningConfig(providerId: string, mode: Mode, apiConfig: ApiConfiguration): SessionReasoningConfig {
	try {
		const manager = getProviderSettingsManager(resolveDataDir())
		const sdkProviderId = toSdkProviderId(providerId)
		const settings = manager.getProviderSettings(sdkProviderId) ?? manager.getProviderSettings(providerId)
		if (!settings) {
			return resolveLegacyReasoningConfig(providerId, mode, apiConfig)
		}

		if (hasStaleDisabledReasoningFields(settings.reasoning)) {
			const sanitizedSettings: ProviderSettings = {
				...settings,
				reasoning: { enabled: false },
			}
			manager.saveProviderSettings(sanitizedSettings, { setLastUsed: false })
			Logger.warn(`[SessionFactory] Cleared stale disabled reasoning fields for provider=${providerId}`)
			return normalizeProviderReasoningSettings(sanitizedSettings.reasoning)
		}

		const providerReasoningConfig = normalizeProviderReasoningSettings(settings.reasoning)
		return hasSessionReasoningConfig(providerReasoningConfig)
			? providerReasoningConfig
			: resolveLegacyReasoningConfig(providerId, mode, apiConfig)
	} catch (error) {
		Logger.warn("[SessionFactory] Provider reasoning resolution failed:", error)
		return resolveLegacyReasoningConfig(providerId, mode, apiConfig)
	}
}

// ---------------------------------------------------------------------------
// Provider → API key field mapping
// ---------------------------------------------------------------------------

/**
 * Maps a provider ID to the corresponding API key field name in ApiConfiguration.
 * This covers all 30+ providers supported by the classic extension.
 */
const PROVIDER_API_KEY_MAP: Record<string, keyof ApiConfiguration> = {
	anthropic: "apiKey",
	openrouter: "openRouterApiKey",
	openai: "openAiApiKey",
	"openai-native": "openAiNativeApiKey",
	bedrock: "awsBedrockApiKey",
	vertex: "geminiApiKey",
	gemini: "geminiApiKey",
	deepseek: "deepSeekApiKey",
	cline: "clineApiKey",
	"cline-pass": "clineApiKey",
	ollama: "ollamaApiKey",
	lmstudio: "apiKey", // LM Studio doesn't need a key but uses the generic field
	requesty: "requestyApiKey",
	together: "togetherApiKey",
	fireworks: "fireworksApiKey",
	qwen: "qwenApiKey",
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
	nousResearch: "nousResearchApiKey",
	"vercel-ai-gateway": "vercelAiGatewayApiKey",
	sapaicore: "sapAiCoreClientId", // SAP uses client ID + secret
	claude_code: "apiKey", // Claude Code uses anthropic key
	wandb: "wandbApiKey",
	"qwen-code": "qwenApiKey",
	oca: "ocaApiKey",
}

/**
 * Maps a provider ID to the mode-specific model ID field name in ApiConfiguration.
 * For providers that have dedicated model ID fields per mode.
 */
const PROVIDER_MODEL_ID_MAP: Record<string, { plan: keyof ApiConfiguration; act: keyof ApiConfiguration }> = {
	anthropic: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	openrouter: { plan: "planModeOpenRouterModelId", act: "actModeOpenRouterModelId" },
	openai: { plan: "planModeOpenAiModelId", act: "actModeOpenAiModelId" },
	"openai-native": { plan: "planModeApiModelId", act: "actModeApiModelId" },
	"openai-codex": { plan: "planModeApiModelId", act: "actModeApiModelId" },
	ollama: { plan: "planModeOllamaModelId", act: "actModeOllamaModelId" },
	lmstudio: { plan: "planModeLmStudioModelId", act: "actModeLmStudioModelId" },
	gemini: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	bedrock: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	vertex: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	deepseek: { plan: "planModeApiModelId", act: "actModeApiModelId" },
	cline: { plan: "planModeClineModelId", act: "actModeClineModelId" },
	"cline-pass": { plan: "planModeClinePassModelId", act: "actModeClinePassModelId" },
	litellm: { plan: "planModeLiteLlmModelId", act: "actModeLiteLlmModelId" },
	requesty: { plan: "planModeRequestyModelId", act: "actModeRequestyModelId" },
	together: { plan: "planModeTogetherModelId", act: "actModeTogetherModelId" },
	fireworks: { plan: "planModeFireworksModelId", act: "actModeFireworksModelId" },
	groq: { plan: "planModeGroqModelId", act: "actModeGroqModelId" },
	baseten: { plan: "planModeBasetenModelId", act: "actModeBasetenModelId" },
	huggingface: { plan: "planModeHuggingFaceModelId", act: "actModeHuggingFaceModelId" },
	"huawei-cloud-maas": { plan: "planModeHuaweiCloudMaasModelId", act: "actModeHuaweiCloudMaasModelId" },
	oca: { plan: "planModeOcaModelId", act: "actModeOcaModelId" },
	aihubmix: { plan: "planModeAihubmixModelId", act: "actModeAihubmixModelId" },
	hicap: { plan: "planModeHicapModelId", act: "actModeHicapModelId" },
	nousResearch: { plan: "planModeNousResearchModelId", act: "actModeNousResearchModelId" },
	"vercel-ai-gateway": { plan: "planModeVercelAiGatewayModelId", act: "actModeVercelAiGatewayModelId" },
	sapaicore: { plan: "planModeSapAiCoreModelId", act: "actModeSapAiCoreModelId" },
}

// ---------------------------------------------------------------------------
// Provider/model defaults
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER_ID = VSCODE_DEFAULT_PROVIDER_ID

export function getDefaultModelIdForProvider(providerId: string): string | undefined {
	const sdkProviderId = toSdkProviderId(providerId)
	const collection = MODEL_COLLECTIONS_BY_PROVIDER_ID[sdkProviderId]
	if (!collection) {
		return undefined
	}

	const generatedModels = getGeneratedModelsForProvider(sdkProviderId)
	const defaultModelId = collection.provider.defaultModelId?.trim()
	if (defaultModelId && (generatedModels[defaultModelId] || collection.models?.[defaultModelId])) {
		return defaultModelId
	}

	return Object.keys(generatedModels)[0] || Object.keys(collection.models ?? {})[0] || undefined
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the API key for a given provider from the ApiConfiguration.
 *
 * For SDK-managed OAuth providers, reads the OAuth token from providers.json
 * via ProviderSettingsManager (the single source of truth for credentials).
 */
export function resolveApiKey(providerId: string, config: ApiConfiguration): string | undefined {
	const authHandler = getProviderAuthHandler(providerId)
	if (authHandler) {
		const keyField = PROVIDER_API_KEY_MAP[providerId]
		const configuredApiKey = keyField ? (config[keyField] as string | undefined)?.trim() : undefined
		if (configuredApiKey) {
			return configuredApiKey
		}

		// Read from providers.json via the shared ProviderSettingsManager. This is
		// intentionally keyed by the requested provider so SDK auth metadata can
		// resolve shared storage (e.g. cline-pass -> cline) without VS Code
		// hardcoding provider exceptions.
		try {
			const manager = getProviderSettingsManager()
			const apiKey = resolveProviderApiKeyFromSettings(manager, providerId)?.trim()
			if (apiKey) {
				return apiKey
			}
		} catch {
			Logger.warn(`[SessionFactory] Failed to read ${providerId} credentials from providers.json`)
		}

		return undefined
	}

	// For all other providers, look up the API key field name
	const keyField = PROVIDER_API_KEY_MAP[providerId]
	if (keyField) {
		const apiKey = config[keyField] as string | undefined
		if (apiKey) {
			return apiKey
		}
	}

	return undefined
}

/**
 * Resolve the model ID for a given provider and mode from the ApiConfiguration.
 * Uses mode-specific model ID fields when available, falls back to generic fields.
 */
function resolveModelId(providerId: string, mode: Mode, config: ApiConfiguration): string | undefined {
	// VS Code LM has no plain model-id field: the selected model is stored as a
	// structured LanguageModelChatSelector ({vendor, family, ...}) in
	// plan/actModeVsCodeLmModelSelector. The SDK ProviderConfig only carries a
	// string modelId, so we stringify the selector to "vendor/family[/version/id]"
	// and the VS Code LM handler parses it back. See sdk/vscode-lm/vscode-lm-handler.ts.
	if (providerId === "vscode-lm") {
		const selector = mode === "plan" ? config.planModeVsCodeLmModelSelector : config.actModeVsCodeLmModelSelector
		return selector ? stringifyVsCodeLmModelSelector(selector) || undefined : undefined
	}

	// Check provider-specific mode model ID fields.
	// If the provider has a dedicated field, do not fall back to generic
	// *ModeApiModelId. Those generic slots may contain a stale model from a
	// previous provider (for example openai/gpt-5.4), which would make the SDK
	// session use a different model than the Cline provider UI shows.
	const modelFields = PROVIDER_MODEL_ID_MAP[providerId]
	if (modelFields) {
		const field = mode === "plan" ? modelFields.plan : modelFields.act
		return (config[field] as string | undefined)?.trim() || undefined
	}

	// Fallback to generic mode model ID fields only for providers without a
	// dedicated model field.
	const genericField = mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
	return (config[genericField] as string | undefined)?.trim() || undefined
}

/**
 * Resolve the base URL for a given provider from the ApiConfiguration.
 */
export function normalizeSdkBaseUrl(providerId: string, baseUrl: unknown): string | undefined {
	if (typeof baseUrl !== "string") {
		return undefined
	}

	const trimmed = baseUrl.trim()
	if (!trimmed) {
		return undefined
	}

	const providerDefaultBaseUrl = MODEL_COLLECTIONS_BY_PROVIDER_ID[toSdkProviderId(providerId)]?.provider.baseUrl
	if (!providerDefaultBaseUrl) {
		return trimmed
	}

	try {
		const configuredUrl = new URL(trimmed)
		const defaultUrl = new URL(providerDefaultBaseUrl)
		const configuredHasPath = configuredUrl.pathname !== "/"
		const defaultHasPath = defaultUrl.pathname !== "/"

		if (!configuredHasPath && defaultHasPath) {
			configuredUrl.pathname = defaultUrl.pathname
			return configuredUrl.toString().replace(/\/$/, "")
		}
	} catch {
		return trimmed
	}

	return trimmed
}

function resolveBaseUrl(providerId: string, config: ApiConfiguration): string | undefined {
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

	const field = baseUrlMap[providerId]
	if (field) {
		return normalizeSdkBaseUrl(providerId, config[field])
	}

	return undefined
}

function mergeRuntimeObject<T extends object>(first: T | undefined, second: T | undefined): T | undefined {
	if (!first) {
		return second
	}
	if (!second) {
		return first
	}
	const merged: Record<string, unknown> = { ...(first as Record<string, unknown>) }
	for (const [key, value] of Object.entries(second)) {
		if (value !== undefined) {
			merged[key] = value
		}
	}
	return merged as T
}

function isSdkAwsAuthentication(value: unknown): value is NonNullable<RuntimeProviderConfig["aws"]>["authentication"] {
	return value === "iam" || value === "api-key" || value === "apikey" || value === "profile"
}

function normalizeSdkAwsAuthentication(value: unknown): NonNullable<RuntimeProviderConfig["aws"]>["authentication"] | undefined {
	if (value === "credentials") {
		return "iam"
	}
	return isSdkAwsAuthentication(value) ? value : undefined
}

function toRuntimeAwsConfig(aws: ReturnType<typeof buildEffectiveProviderConfig>["aws"]): RuntimeProviderConfig["aws"] {
	if (!aws) {
		return undefined
	}
	return {
		...aws,
		authentication: normalizeSdkAwsAuthentication(aws.authentication),
	}
}

function isBedrockApiKeyAuthentication(authentication: unknown): boolean {
	return authentication === "api-key" || authentication === "apikey"
}

function isSdkSapApi(value: unknown): value is NonNullable<RuntimeProviderConfig["sap"]>["api"] {
	return value === "orchestration" || value === "foundation-models"
}

function isSdkOcaMode(value: unknown): value is NonNullable<RuntimeProviderConfig["oca"]>["mode"] {
	return value === "internal" || value === "external"
}

function toRuntimeApiLine(value: unknown): RuntimeProviderConfig["apiLine"] {
	return value === "china" || value === "international" ? value : undefined
}

function toRuntimeSapConfig(sap: ReturnType<typeof buildEffectiveProviderConfig>["sap"]): RuntimeProviderConfig["sap"] {
	if (!sap) {
		return undefined
	}
	return {
		...sap,
		api: isSdkSapApi(sap.api) ? sap.api : undefined,
		defaultSettings: sap.defaultSettings ? { ...sap.defaultSettings } : undefined,
	}
}

function toRuntimeOcaConfig(oca: ReturnType<typeof buildEffectiveProviderConfig>["oca"]): RuntimeProviderConfig["oca"] {
	if (!oca) {
		return undefined
	}
	return {
		...oca,
		mode: isSdkOcaMode(oca.mode) ? oca.mode : undefined,
	}
}

function readModeSpecificSapDeploymentId(providerId: string, mode: Mode, config: ApiConfiguration): string | undefined {
	if (providerId !== "sapaicore") {
		return undefined
	}
	const value = mode === "plan" ? config.planModeSapAiCoreDeploymentId : config.actModeSapAiCoreDeploymentId
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function readModeSpecificBedrockCustomModelBaseId(providerId: string, mode: Mode, config: ApiConfiguration): string | undefined {
	if (providerId !== "bedrock") {
		return undefined
	}
	const value = mode === "plan" ? config.planModeAwsBedrockCustomModelBaseId : config.actModeAwsBedrockCustomModelBaseId
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

function readRemoteBedrockCustomModelBaseId(modelId: string | undefined): string | undefined {
	if (!modelId) {
		return undefined
	}
	return readRemoteProviderModelSettings("bedrock")?.bedrockCustomModels?.find((model) => model.name === modelId)?.baseModelId
}

function readRemoteProviderModelSettings(providerId: string): RemoteProviderModelSettings[string] | undefined {
	try {
		const manager = StateManager.get() as { getRemoteConfigSettings?: () => unknown }
		const settings = manager.getRemoteConfigSettings?.()
		if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
			return undefined
		}
		const remoteProviderModelSettings = (settings as { remoteProviderModelSettings?: RemoteProviderModelSettings })
			.remoteProviderModelSettings
		const sdkProviderId = toSdkProviderId(providerId)
		return remoteProviderModelSettings?.[sdkProviderId] ?? remoteProviderModelSettings?.[providerId]
	} catch {
		return undefined
	}
}

function resolveRemoteAllowedModelId(providerId: string, modelId: string | undefined): string | undefined {
	const remoteModelSettings = readRemoteProviderModelSettings(providerId)
	if (!remoteModelSettings?.models?.length && !remoteModelSettings?.bedrockCustomModels?.length) {
		return modelId
	}

	const allowedModelIds = [
		...(remoteModelSettings.models ?? []).map((model) => model.id),
		...(remoteModelSettings.bedrockCustomModels ?? []).map((model) => model.name),
	].filter((value) => value.trim().length > 0)
	if (allowedModelIds.length === 0) {
		return modelId
	}
	return modelId && allowedModelIds.includes(modelId) ? modelId : allowedModelIds[0]
}

/**
 * Runtime provider config is built from the same effective SDK/legacy boundary
 * as the catalog. A partial providers.json entry is not authoritative; missing
 * fields are filled from legacy StateManager overlays so old installs keep
 * working while the SDK-owned provider shape becomes the runtime contract.
 */
export function buildRuntimeProviderConfig(providerId: string, mode: Mode, apiConfig: ApiConfiguration): RuntimeProviderConfig {
	const sharedApiConfig = mirrorPlanActApiConfiguration(apiConfig)
	const runtimeProviderId = toVscodeSupportedProvider(providerId)
	const persistedProviderConfig = resolvePersistedProviderConfig(runtimeProviderId)
	const persistedProviderSettings = resolvePersistedProviderSettings(runtimeProviderId)
	const parsedProviderId = parseProviderId(runtimeProviderId)
	const effectiveConfig = buildEffectiveProviderConfig(parsedProviderId)
	const remoteConfig = buildRemoteProviderConfig(parsedProviderId)
	const rawModelId =
		persistedProviderConfig?.modelId ??
		resolveModelId(runtimeProviderId, mode, sharedApiConfig) ??
		getDefaultModelIdForProvider(runtimeProviderId)
	const modelId = resolveRemoteAllowedModelId(runtimeProviderId, rawModelId)
	const apiKey =
		remoteConfig.apiKey ??
		persistedProviderConfig?.apiKey ??
		effectiveConfig.apiKey ??
		resolveApiKey(runtimeProviderId, apiConfig)
	const persistedExplicitBaseUrl =
		typeof persistedProviderSettings?.baseUrl === "string" && persistedProviderSettings.baseUrl.trim().length > 0
			? persistedProviderConfig?.baseUrl
			: undefined
	const baseUrl =
		remoteConfig.baseUrl ??
		(parsedProviderId === "oca"
			? (effectiveConfig.baseUrl ??
				resolveBaseUrl(runtimeProviderId, sharedApiConfig) ??
				persistedExplicitBaseUrl ??
				persistedProviderConfig?.baseUrl)
			: (persistedExplicitBaseUrl ??
				effectiveConfig.baseUrl ??
				resolveBaseUrl(runtimeProviderId, sharedApiConfig) ??
				persistedProviderConfig?.baseUrl))
	const bedrockCustomModelBaseId =
		readRemoteBedrockCustomModelBaseId(modelId) ??
		readModeSpecificBedrockCustomModelBaseId(runtimeProviderId, mode, sharedApiConfig)
	const mergedAwsBase = mergeRuntimeObject(
		mergeRuntimeObject(effectiveConfig.aws, persistedProviderConfig?.aws),
		remoteConfig.aws,
	)
	const mergedAws = bedrockCustomModelBaseId
		? { ...(mergedAwsBase ?? {}), customModelBaseId: bedrockCustomModelBaseId }
		: mergedAwsBase
	const aws = toRuntimeAwsConfig(mergedAws)
	const gcp = mergeRuntimeObject(mergeRuntimeObject(effectiveConfig.gcp, persistedProviderConfig?.gcp), remoteConfig.gcp)
	const azure = mergeRuntimeObject(
		mergeRuntimeObject(effectiveConfig.azure, persistedProviderConfig?.azure),
		remoteConfig.azure,
	)
	const apiLine = toRuntimeApiLine(remoteConfig.apiLine ?? persistedProviderConfig?.apiLine ?? effectiveConfig.apiLine)
	const modeSpecificSapDeploymentId = readModeSpecificSapDeploymentId(runtimeProviderId, mode, sharedApiConfig)
	const mergedSapBase = mergeRuntimeObject(
		mergeRuntimeObject(effectiveConfig.sap, persistedProviderConfig?.sap),
		remoteConfig.sap,
	)
	const mergedSap = modeSpecificSapDeploymentId
		? { ...(mergedSapBase ?? {}), deploymentId: modeSpecificSapDeploymentId }
		: mergedSapBase
	const sap = toRuntimeSapConfig(mergedSap)
	const oca = toRuntimeOcaConfig(
		mergeRuntimeObject(mergeRuntimeObject(persistedProviderSettings?.oca, effectiveConfig.oca), remoteConfig.oca),
	)
	const region =
		gcp?.region ?? mergedAws?.region ?? remoteConfig.region ?? effectiveConfig.region ?? persistedProviderConfig?.region
	const runtimeApiKey =
		runtimeProviderId === "bedrock" && !isBedrockApiKeyAuthentication(aws?.authentication) ? undefined : apiKey
	const {
		apiKey: _persistedApiKey,
		thinking: _persistedThinking,
		reasoningEffort: _persistedReasoningEffort,
		thinkingBudgetTokens: _persistedThinkingBudgetTokens,
		...persistedProviderConfigWithoutRuntimeOnlyFields
	} = persistedProviderConfig ?? {}

	return {
		...persistedProviderConfigWithoutRuntimeOnlyFields,
		providerId: toSdkProviderId(runtimeProviderId),
		modelId: modelId || getDefaultModelIdForProvider(runtimeProviderId) || "",
		apiLine,
		...(runtimeApiKey ? { apiKey: runtimeApiKey } : {}),
		...(baseUrl ? { baseUrl } : {}),
		...((remoteConfig.headers ?? effectiveConfig.headers)
			? { headers: { ...(remoteConfig.headers ?? effectiveConfig.headers) } }
			: {}),
		...(effectiveConfig.auth?.accessToken ? { accessToken: effectiveConfig.auth.accessToken } : {}),
		...(effectiveConfig.auth?.refreshToken ? { refreshToken: effectiveConfig.auth.refreshToken } : {}),
		...(effectiveConfig.auth?.accountId ? { accountId: effectiveConfig.auth.accountId } : {}),
		...(region ? { region } : {}),
		...(aws ? { aws } : {}),
		...(gcp ? { gcp } : {}),
		...(azure ? { azure } : {}),
		...(sap ? { sap } : {}),
		...(oca ? { oca } : {}),
		...(mergedAws?.useCrossRegionInference !== undefined
			? { useCrossRegionInference: mergedAws.useCrossRegionInference }
			: {}),
		...(mergedAws?.useGlobalInference !== undefined ? { useGlobalInference: mergedAws.useGlobalInference } : {}),
	}
}

// ---------------------------------------------------------------------------
// Session config builder
// ---------------------------------------------------------------------------

/**
 * Build a CoreSessionConfig from the current state.
 *
 * Reads provider settings from the classic StateManager's ApiConfiguration
 * (which correctly reads from globalState.json + secrets.json), mirrors legacy
 * plan/act slots to one shared selection, then resolves the provider, model,
 * and API key for the current mode's runtime behavior.
 *
 * This replaces the previous two-path approach (SDK ProviderSettingsManager +
 * StateManager.buildApiHandlerSettings) which both failed silently.
 */
export async function buildSessionConfig(input: SessionConfigInput): Promise<CoreSessionConfig> {
	const cwd = input.cwd
	if (!cwd) {
		throw new Error("buildSessionConfig requires a cwd resolved by the host controller")
	}
	const workspaceRoot = input.workspaceRoot?.trim() || cwd
	const mode: Mode = input.mode ?? "act"
	const sdkLogger = createSdkLogger()
	const distinctId = getDistinctId()

	let providerId: string | undefined
	let modelId: string | undefined
	let apiKey: string | undefined
	let baseUrl: string | undefined
	let apiConfig: ApiConfiguration | undefined
	let sdkProviderConfig: CoreSessionConfig["providerConfig"] | undefined

	try {
		const stateManager = StateManager.get()
		apiConfig = mirrorPlanActApiConfiguration(stateManager.getApiConfiguration())

		// Resolve the shared provider selection. The mode still controls tool
		// access and prompting, but not provider/model choice.
		const modeProvider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		providerId = modeProvider ? toVscodeSupportedProvider(modeProvider, DEFAULT_PROVIDER_ID) : undefined
		if (modeProvider && providerId !== modeProvider) {
			Logger.warn(`[SessionFactory] Provider ${modeProvider} is unsupported in VS Code; using ${providerId} for runtime`)
		}

		if (providerId) {
			const sdkProviderId = toSdkProviderId(providerId)
			sdkProviderConfig = buildRuntimeProviderConfig(providerId, mode, apiConfig)
			modelId = sdkProviderConfig.modelId
			apiKey = sdkProviderConfig.apiKey
			baseUrl = sdkProviderConfig.baseUrl

			Logger.log(
				`[SessionFactory] Resolved provider config: provider=${providerId}, sdkProvider=${sdkProviderId}, model=${modelId}, source=effective, hasApiKey=${!!apiKey}`,
			)
		}
	} catch (error) {
		Logger.warn("[SessionFactory] Provider config resolution failed:", error)
	}

	// Fallback: try SDK's ProviderSettingsManager only when StateManager did not
	// resolve a provider at all. If the user selected a provider but credentials
	// are missing, keep that provider/model so the UI can surface the right auth
	// state instead of silently switching to a previous provider.
	if (!providerId) {
		try {
			const dataDir = resolveDataDir()
			const manager = getProviderSettingsManager(dataDir)
			const lastUsed = manager.getLastUsedProviderSettings()

			if (lastUsed?.provider && !isVscodeUnsupportedProvider(lastUsed.provider)) {
				const lastUsedConfig = manager.getProviderConfig(lastUsed.provider, { includeKnownModels: false })
				providerId = lastUsed.provider
				sdkProviderConfig = lastUsedConfig
				modelId = lastUsedConfig?.modelId ?? lastUsed.model
				apiKey = lastUsedConfig?.apiKey ?? lastUsed.apiKey
				baseUrl = lastUsedConfig?.baseUrl ?? lastUsed.baseUrl
				Logger.log(`[SessionFactory] Using SDK provider fallback: ${providerId}/${modelId}`)
			} else if (lastUsed?.provider) {
				Logger.warn(
					`[SessionFactory] Ignoring unsupported SDK provider fallback ${lastUsed.provider}; using ${DEFAULT_PROVIDER_ID}`,
				)
			}
		} catch (error) {
			Logger.warn("[SessionFactory] SDK ProviderSettingsManager fallback failed:", error)
		}
	}

	// Final defaults. Keep this aligned with the provider catalog so the UI and
	// session factory share one source of truth for default models.
	providerId = providerId ?? DEFAULT_PROVIDER_ID
	modelId = modelId ?? getDefaultModelIdForProvider(providerId) ?? getDefaultModelIdForProvider(DEFAULT_PROVIDER_ID) ?? ""
	const shouldResolveLegacyApiKey =
		providerId !== "bedrock" || isBedrockApiKeyAuthentication(sdkProviderConfig?.aws?.authentication)
	if (!apiKey && apiConfig && shouldResolveLegacyApiKey) {
		apiKey = resolveApiKey(providerId, apiConfig)
	}
	apiKey = apiKey ?? ""
	const reasoningConfig = resolveProviderReasoningConfig(providerId, mode, apiConfig ?? {})

	// Build the system prompt using the shared prompt builder. Core still
	// expects callers to provide a concrete systemPrompt, but the prompt builder
	// can derive baseline workspace context from the root path and workspace
	// name, so we avoid duplicating core's richer workspace metadata pass here.
	let systemPrompt = ""
	try {
		const workspaceName = resolveWorkspaceName(cwd)
		systemPrompt = buildClineSystemPrompt({
			ide: "VS Code",
			workspaceRoot,
			workspaceName,
			mode: mode === "plan" ? "plan" : "act",
			providerId,
			platform: process.platform,
		})
		Logger.log(`[SessionFactory] Built system prompt: ${systemPrompt.length} chars`)
	} catch (error) {
		Logger.warn("[SessionFactory] Failed to build system prompt, using minimal fallback:", error)
		systemPrompt = "You are Cline, a highly skilled software engineer. Help the user with their request."
	}

	// Inject preferred language instructions when a non-default language is selected.
	// Mirrors classic src/core/task/index.ts preferredLanguage handling.
	try {
		const preferredLanguageRaw = StateManager.get().getGlobalSettingsKey("preferredLanguage")
		const preferredLanguage = getLanguageKey(preferredLanguageRaw as LanguageDisplay | undefined)
		if (preferredLanguage && preferredLanguage !== DEFAULT_LANGUAGE_SETTINGS) {
			systemPrompt = `${systemPrompt}\n\n# Preferred Language\n\nSpeak in ${preferredLanguage}.`
		}
	} catch (error) {
		Logger.warn("[SessionFactory] Failed to inject preferredLanguage instructions:", error)
	}

	// Append plan-mode instructions when in plan mode, matching the CLI's
	// behavior (apps/cli/src/runtime/prompt.ts). The shared prompt builder does
	// not include these guardrails, so without this the model in plan mode may
	// still attempt to make edits instead of planning.
	if (mode === "plan") {
		systemPrompt = systemPrompt ? `${systemPrompt}\n\n${PLAN_MODE_INSTRUCTIONS}` : PLAN_MODE_INSTRUCTIONS
	}

	const stateManager = StateManager.get()
	const globalSubagentsEnabled = stateManager.getGlobalSettingsKey("subagentsEnabled") ?? false
	const globalUseAutoCondense = stateManager.getGlobalSettingsKey("useAutoCondense") ?? false
	const useAutoCondense = input.taskSettings?.useAutoCondense ?? globalUseAutoCondense

	// Core resolves providers against the SDK registry, which uses the SDK's
	// own provider id spelling (e.g. "openai-compatible" rather than the
	// extension's "openai"). Convert before handing the id to core.
	const sdkProviderId = toSdkProviderId(providerId)

	const providerConfig = {
		...(sdkProviderConfig ?? {}),
		providerId: sdkProviderId,
		modelId,
		...(apiKey ? { apiKey } : {}),
		...(baseUrl ? { baseUrl } : {}),
		fetch,
	}

	const config: CoreSessionConfig = {
		providerId: sdkProviderId,
		modelId,
		apiKey,
		baseUrl,
		providerConfig,
		cwd,
		workspaceRoot,
		systemPrompt,
		enableTools: true,
		enableSpawnAgent: input.taskSettings?.subagentsEnabled ?? globalSubagentsEnabled,
		enableAgentTeams: false,
		...(useAutoCondense
			? {
					compaction: {
						enabled: true,
						strategy: "basic",
					},
				}
			: {}),
		disableMcpSettingsTools: true,
		mode: mode === "plan" ? "plan" : "act",
		...reasoningConfig,
		maxIterations: undefined,
		logger: sdkLogger,
		extensionContext: {
			user: distinctId ? { distinctId } : undefined,
			client: {
				name: "cline-vscode",
				version: ExtensionRegistryInfo.version,
			},
			workspace: {
				rootPath: workspaceRoot,
				cwd,
				workspaceName: resolveWorkspaceName(workspaceRoot),
				ide: "VS Code",
				platform: process.platform,
				mode: mode === "plan" ? "plan" : "act",
			},
			logger: sdkLogger,
		},
		hooks: buildAgentHooks(StateManager.get()),
	}

	return config
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

/**
 * Build the StartSessionInput for a new task.
 *
 * IMPORTANT: We pass `interactive: true` but NO `prompt`. This creates the
 * session and returns immediately — the runtime host only executes a turn when
 * a prompt is sent. The caller should then call `core.send({ sessionId, prompt })`
 * to run the first turn. This cleanly separates session creation from
 * inference, preventing the gRPC handler from blocking until the first
 * agent turn completes.
 */
export function buildStartSessionInput(config: CoreSessionConfig, input: SessionConfigInput): ClineCoreStartInput {
	return {
		config,
		// Do NOT pass prompt here — start() should return immediately.
		// The prompt is sent separately via core.send() after session creation.
		prompt: undefined,
		interactive: true, // VSCode extension always uses interactive mode
		userImages: input.images,
		userFiles: input.files,
	}
}

/**
 * Build the StartSessionInput for resuming an existing task.
 *
 * When resuming, we don't pass initialMessages — the SDK's session
 * persistence handles loading the conversation history from disk.
 */
export function buildResumeSessionInput(
	sessionId: string,
	prompt: string,
	images?: string[],
	files?: string[],
): { sessionId: string; prompt: string; userImages?: string[]; userFiles?: string[] } {
	return {
		sessionId,
		prompt,
		userImages: images,
		userFiles: files,
	}
}

// ---------------------------------------------------------------------------
// Task history helpers
// ---------------------------------------------------------------------------

/**
 * Get a HistoryItem by ID from the task history.
 */
export function getHistoryItemById(taskId: string, dataDir?: string): HistoryItem | undefined {
	const history = readTaskHistory(dataDir)
	return history.find((item) => item.id === taskId)
}

/**
 * Update a HistoryItem in the task history.
 * Returns the updated history array.
 */
export function updateHistoryItem(item: HistoryItem, dataDir?: string): HistoryItem[] {
	const history = readTaskHistory(dataDir)
	const index = history.findIndex((h) => h.id === item.id)
	if (index >= 0) {
		history[index] = item
	} else {
		history.unshift(item)
	}
	return history
}

/**
 * Create a new HistoryItem from a session start result.
 */
export function createHistoryItemFromSession(sessionId: string, prompt: string, modelId?: string, cwd?: string): HistoryItem {
	return {
		id: sessionId,
		ts: Date.now(),
		task: prompt,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		modelId,
		cwdOnTaskInitialization: cwd,
	}
}
