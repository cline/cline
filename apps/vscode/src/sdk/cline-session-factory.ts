// Replaces classic task creation from src/core/task/index.ts (see origin/main)
//
// Creates and manages SDK sessions using ClineCore. This factory handles:
// - Creating ClineCore instances with proper configuration
// - Building session config from legacy state (provider, model, API key)
// - Custom session persistence adapter reading ~/.cline/data/tasks/
// - Mapping HistoryItem ↔ SDK session fields
//
// The factory does NOT handle UI concerns — that's the SdkController's job.

import {
	buildWorkspaceMetadata,
	type ClineCoreStartInput,
	type CoreSessionConfig,
	getProviderAuthHandler,
	type ProviderSettings,
	readCompactionStrategyGlobally,
	resolveProviderApiKeyFromSettings,
	type StartSessionResult,
} from "@cline/core"
import type { ProviderApiLine, ModelInfo as SdkModelInfo } from "@cline/llms"
import {
	getGeneratedModelsForProvider,
	getModelsForProvider,
	isProviderApiLine,
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
	OLLAMA_DEFAULT_CONTEXT_WINDOW,
} from "@cline/llms"
import { buildClineSystemPrompt, isClineProvider } from "@cline/shared"
import type { ApiConfiguration } from "@shared/api"
import { ClineClient } from "@shared/cline"
import type { HistoryItem } from "@shared/HistoryItem"
import { DEFAULT_LANGUAGE_SETTINGS, getLanguageKey, type LanguageDisplay } from "@shared/Languages"
import { toLegacyApiProvider } from "@shared/model-catalog/provider-helpers"
import { Logger } from "@shared/services/Logger"
import type { Settings } from "@shared/storage/state-keys"
import type { Mode } from "@shared/storage/types"
import { reasoningEffortFromThinkingBudget } from "@shared/utils/reasoning-support"
import { stringifyVsCodeLmModelSelector } from "@shared/vsCodeSelectorUtils"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { getDistinctId } from "@/services/logging/distinctId"
import { fetch } from "@/shared/net"
import { type BedrockProviderConfig, buildBedrockProviderConfig } from "./bedrock-config"
import { buildAgentHooks } from "./hooks-adapter"
import { readTaskHistory, resolveDataDir } from "./legacy-state-reader"
import type { ResolvedModelSelection } from "./model-catalog/contracts"
import { nonNegativeFiniteNumber, positiveFiniteNumber, toSdkApiFormat } from "./model-catalog/model-values"
import { parseProviderId } from "./model-catalog/provider-id"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"
import { createProviderConfigStore, resolveRuntimeModelSelection } from "./model-catalog/store"
import { getProviderSettingsManager } from "./provider-migration"
import { buildSapProviderConfig, type SapProviderConfig } from "./sap-config"
import type { SdkSessionHost } from "./session-host"

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
	/** The config used to start the active session. */
	startConfig?: Pick<CoreSessionConfig, "providerId" | "modelId">
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

/**
 * Host identity for the session's client context, resolved through HostProvider
 * rather than the `vscode` module directly: this file is also bundled into the
 * standalone cline-core (JetBrains), where `vscode` is a Proxy-stub module and
 * direct API reads would yield non-string values. The hostbridge returns the
 * per-host values (e.g. "Cline for JetBrains" + IDE version on JetBrains).
 */
async function resolveHostIdentity() {
	try {
		return await HostProvider.env.getHostVersion({})
	} catch (error) {
		Logger.debug("Failed to resolve host version for client identity", error)
		return undefined
	}
}

async function resolveIsMultiRootWorkspace(): Promise<boolean> {
	try {
		const { paths } = await HostProvider.workspace.getWorkspacePaths({})
		return paths.length > 1
	} catch {
		return false
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

function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return value === "low" || value === "medium" || value === "high" || value === "xhigh"
}

function hasStaleDisabledReasoningFields(reasoning: ProviderReasoningSettings | undefined): boolean {
	return reasoning?.enabled === false && (reasoning.effort !== undefined || reasoning.budgetTokens !== undefined)
}

function providerSettingsProviderId(providerId: string): string {
	return toSdkProviderId(providerId)
}

/**
 * Convert SDK provider-level reasoning settings into the SDK session fields that
 * are actually forwarded as model options. Keep `thinking` and
 * `reasoningEffort` coherent: a disabled/none state must never carry an effort.
 *
 * A persisted `budgetTokens` without an effort (written by older extension
 * versions or the legacy-state migration) is honored by mapping the budget
 * onto the effort scale, so users who had extended thinking enabled keep it
 * enabled after upgrading to the effort-based control.
 */
export function normalizeProviderReasoningSettings(reasoning: ProviderReasoningSettings | undefined): SessionReasoningConfig {
	if (!reasoning) {
		return {}
	}

	if (reasoning.enabled === false || reasoning.effort === "none") {
		return { thinking: false }
	}

	const effort = isReasoningEffort(reasoning.effort)
		? reasoning.effort
		: reasoningEffortFromThinkingBudget(reasoning.budgetTokens)

	if (reasoning.enabled === true) {
		return {
			thinking: true,
			...(effort ? { reasoningEffort: effort } : {}),
		}
	}

	if (isReasoningEffort(reasoning.effort)) {
		return { reasoningEffort: reasoning.effort }
	}

	// Legacy budget with no explicit enabled/effort: treat as thinking-on.
	return effort ? { thinking: true, reasoningEffort: effort } : {}
}

function resolveProviderReasoningConfig(providerId: string): SessionReasoningConfig {
	try {
		const manager = getProviderSettingsManager(resolveDataDir())
		const settings = manager.getProviderSettings(providerSettingsProviderId(providerId))
		if (!settings) {
			return {}
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

		return normalizeProviderReasoningSettings(settings.reasoning)
	} catch (error) {
		Logger.warn("[SessionFactory] Provider reasoning resolution failed:", error)
		return {}
	}
}

function resolveOcaReasoningConfig(mode: Mode, apiConfig: ApiConfiguration | undefined): SessionReasoningConfig | undefined {
	const rawEffort = mode === "plan" ? apiConfig?.planModeOcaReasoningEffort : apiConfig?.actModeOcaReasoningEffort
	const effort = rawEffort?.trim().toLowerCase()
	if (!effort) {
		return undefined
	}

	if (effort === "none") {
		return { thinking: false }
	}

	return isReasoningEffort(effort) ? { thinking: true, reasoningEffort: effort } : undefined
}

function resolveOpenAiCompatibleMaxTokens(config: ApiConfiguration | undefined, mode: Mode): number | undefined {
	const modelInfo = mode === "plan" ? config?.planModeOpenAiModelInfo : config?.actModeOpenAiModelInfo
	return positiveFiniteNumber(modelInfo?.maxTokens)
}

function toSdkModelInfo(selection: ResolvedModelSelection): SdkModelInfo {
	const modelInfo = selection.modelInfo
	// Seed from the SDK capability list preserved at the catalog boundary
	// (`adaptSdkModelInfo`), then layer user overrides and the legacy boolean
	// projections on top. The preserved list is the only source that carries
	// capabilities without a legacy boolean (e.g. `tools`), and the SDK treats
	// a populated capabilities array as authoritative — reconstructing one
	// purely from the booleans silently disables everything they don't cover.
	const preservedCapabilities = modelInfo.capabilities as NonNullable<SdkModelInfo["capabilities"]> | undefined
	const capabilities = new Set<NonNullable<SdkModelInfo["capabilities"]>[number]>([
		...(preservedCapabilities ?? []),
		...((selection.overrides?.capabilities ?? []) as NonNullable<SdkModelInfo["capabilities"]>),
	])
	const setCapability = (capability: NonNullable<SdkModelInfo["capabilities"]>[number], enabled: boolean): void => {
		if (enabled) capabilities.add(capability)
		else capabilities.delete(capability)
	}
	if (modelInfo.supportsImages !== undefined) setCapability("images", modelInfo.supportsImages)
	setCapability("prompt-cache", modelInfo.supportsPromptCache)
	if (modelInfo.supportsReasoning !== undefined) setCapability("reasoning", modelInfo.supportsReasoning)
	if (selection.overrides?.supportsAttachments !== undefined) setCapability("files", selection.overrides.supportsAttachments)
	if (preservedCapabilities === undefined || preservedCapabilities.length === 0) {
		// No authoritative SDK list survived to here (dynamic-list snapshot,
		// fallback metadata, or a custom model). The array we are rebuilding
		// from booleans must still carry a definitive tool-calling signal,
		// because a non-empty capabilities array without "tools" reads as
		// "cannot call tools" to the SDK runtime. Legacy metadata only models
		// tool support for OpenAI-compatible entries via `supportsTools`.
		//
		// An EMPTY array is the same "no signal" state as an absent one —
		// modelHasCapability treats both as unspecified — and configs carried
		// over from before the field existed (or round-tripped through a
		// boundary that defaults it to []) land exactly here. Guarding only
		// `undefined` let those custom models keep a non-empty, tool-less
		// array once any boolean projection (e.g. reasoning) populated it,
		// silently disabling tool calling at the runtime gate (#13463).
		const supportsTools = (modelInfo as { supportsTools?: boolean }).supportsTools
		setCapability("tools", supportsTools !== false)
	}

	const maxTokens = positiveFiniteNumber(modelInfo.maxTokens)
	const contextWindow = positiveFiniteNumber(modelInfo.contextWindow)
	const maxInputTokens =
		positiveFiniteNumber(selection.overrides?.maxInputTokens) ?? positiveFiniteNumber(modelInfo.maxInputTokens)
	const temperature = nonNegativeFiniteNumber(modelInfo.temperature)
	const inputPrice = nonNegativeFiniteNumber(modelInfo.inputPrice)
	const outputPrice = nonNegativeFiniteNumber(modelInfo.outputPrice)
	const cacheRead = nonNegativeFiniteNumber(modelInfo.cacheReadsPrice)
	const cacheWrite = nonNegativeFiniteNumber(modelInfo.cacheWritesPrice)
	const apiFormat = toSdkApiFormat(modelInfo.apiFormat)
	const hasPricing =
		inputPrice !== undefined || outputPrice !== undefined || cacheRead !== undefined || cacheWrite !== undefined

	return {
		id: selection.modelId,
		name: modelInfo.name ?? selection.modelId,
		...(maxTokens !== undefined ? { maxTokens } : {}),
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(maxInputTokens !== undefined ? { maxInputTokens } : {}),
		...(capabilities.size > 0 ? { capabilities: [...capabilities] } : {}),
		...(modelInfo.operation !== undefined ? { operation: modelInfo.operation } : {}),
		...(modelInfo.operationModes !== undefined ? { operationModes: [...modelInfo.operationModes] } : {}),
		...(modelInfo.modalities !== undefined ? { modalities: modelInfo.modalities } : {}),
		...(apiFormat !== undefined ? { apiFormat } : {}),
		...(temperature !== undefined ? { temperature } : {}),
		...(hasPricing
			? {
					pricing: {
						...(inputPrice !== undefined ? { input: inputPrice } : {}),
						...(outputPrice !== undefined ? { output: outputPrice } : {}),
						...(cacheRead !== undefined ? { cacheRead } : {}),
						...(cacheWrite !== undefined ? { cacheWrite } : {}),
					},
				}
			: {}),
	}
}

function resolveCommittedRuntimeModel(
	providerId: string,
	mode: Mode,
	modelId: string | undefined,
): ResolvedModelSelection | undefined {
	if (!modelId) {
		return undefined
	}
	try {
		const parsedProviderId = parseProviderId(providerId)
		const selection = createProviderConfigStore().readSelection(parsedProviderId, mode)
		return selection?.modelId === modelId ? selection : resolveRuntimeModelSelection(parsedProviderId, modelId)
	} catch (error) {
		Logger.warn(`[SessionFactory] Failed to resolve committed model settings for provider=${providerId}:`, error)
		return undefined
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
}

// ---------------------------------------------------------------------------
// Provider/model defaults
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER_ID = "cline"

/**
 * Providers whose model list comes from a live local endpoint (Ollama's
 * `/api/tags`, LM Studio's `/v1/models`). Their installed models are the only
 * meaningful catalog; a bundled-catalog default would silently select a model
 * the user never installed (e.g. an Ollama Cloud nemotron model).
 */
function providerHasLocalModelSource(providerId: string): boolean {
	return Boolean(MODEL_COLLECTIONS_BY_PROVIDER_ID[toSdkProviderId(providerId)]?.provider.modelsSourceUrl)
}

export function getDefaultModelIdForProvider(providerId: string): string | undefined {
	const sdkProviderId = toSdkProviderId(providerId)
	if (providerHasLocalModelSource(providerId)) {
		return undefined
	}
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
			const apiKey = resolveProviderApiKeyFromSettings(manager, providerSettingsProviderId(providerId))?.trim()
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

	// SDK-backed API-key providers save credentials in providers.json instead
	// of legacy ApiConfiguration fields. Fall back to that store so providers
	// exposed through the SDK settings UI still receive credentials at task
	// startup.
	try {
		const manager = getProviderSettingsManager()
		const apiKey = resolveProviderApiKeyFromSettings(manager, providerSettingsProviderId(providerId))?.trim()
		if (apiKey) {
			return apiKey
		}
	} catch {
		Logger.warn(`[SessionFactory] Failed to read ${providerId} API key from providers.json`)
	}

	return undefined
}

/**
 * Resolve the model ID for a given provider and mode from the ApiConfiguration.
 * Uses mode-specific model ID fields when available, falls back to generic fields.
 */
export function resolveModelId(providerId: string, mode: Mode, config: ApiConfiguration): string | undefined {
	// VS Code LM has no plain model-id field: the selected model is stored as a
	// structured LanguageModelChatSelector ({vendor, family, ...}) in
	// plan/actModeVsCodeLmModelSelector. The SDK ProviderConfig only carries a
	// string modelId, so we stringify the selector to "vendor/family[/version/id]"
	// and the VS Code LM handler parses it back. See sdk/vscode-lm/vscode-lm-handler.ts.
	if (providerId === "vscode-lm") {
		const selector = mode === "plan" ? config.planModeVsCodeLmModelSelector : config.actModeVsCodeLmModelSelector
		return selector ? stringifyVsCodeLmModelSelector(selector) || undefined : undefined
	}

	if (providerId === "sapaicore") {
		const genericField = mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
		const legacyField = mode === "plan" ? "planModeSapAiCoreModelId" : "actModeSapAiCoreModelId"
		return (
			(config[genericField] as string | undefined)?.trim() ||
			(config[legacyField] as string | undefined)?.trim() ||
			undefined
		)
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

export function resolveVertexProviderConfig(config: ApiConfiguration): Pick<ProviderSettings, "gcp" | "region"> {
	let providerSettingsProjectId: string | undefined
	let providerSettingsRegion: string | undefined
	try {
		const settings = getProviderSettingsManager().getProviderSettings("vertex")
		providerSettingsProjectId = settings?.gcp?.projectId?.trim() || undefined
		providerSettingsRegion = settings?.gcp?.region?.trim() || settings?.region?.trim() || undefined
	} catch {
		Logger.warn("[SessionFactory] Failed to read Vertex settings from providers.json")
	}

	const region = (providerSettingsRegion ?? config.vertexRegion?.trim()) || undefined
	return {
		region,
		gcp: {
			projectId: (providerSettingsProjectId ?? config.vertexProjectId?.trim()) || undefined,
			region,
		},
	}
}

type OllamaProviderConfig = {
	modelInfo?: { id: string; name: string; contextWindow: number }
	timeoutMs?: number
}

/**
 * Resolve the user's "Model Context Window" setting for Ollama and surface it
 * as the selected model's `contextWindow`. The gateway carries it on the
 * resolved model definition, and the Ollama vendor maps it onto the wire as
 * `options.num_ctx` — without it Ollama loads every model with its 4096-token
 * server default. Keeping it on the model also means context management
 * budgets against the window Ollama actually applies (Ollama truncates the
 * prompt to `num_ctx` server-side).
 */
export function resolveOllamaProviderConfig(config: ApiConfiguration, modelId: string | undefined): OllamaProviderConfig {
	// providers.json (`contextWindow`) is the source of truth; the legacy
	// StateManager string is a migration fallback (the config store mirrors
	// writes to both).
	let settingsContextWindow: number | undefined
	try {
		const value = getProviderSettingsManager().getProviderSettings("ollama")?.contextWindow
		settingsContextWindow = typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined
	} catch {
		Logger.warn("[SessionFactory] Failed to read Ollama settings from providers.json")
	}
	const raw = config.ollamaApiOptionsCtxNum?.trim()
	const parsed = raw ? Number(raw) : Number.NaN
	const legacyContextWindow = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
	const contextWindow = settingsContextWindow ?? legacyContextWindow ?? OLLAMA_DEFAULT_CONTEXT_WINDOW
	const timeoutMs = config.requestTimeoutMs
	return {
		...(typeof timeoutMs === "number" && timeoutMs > 0 ? { timeoutMs } : {}),
		...(modelId ? { modelInfo: { id: modelId, name: modelId, contextWindow } } : {}),
	}
}

export function resolveBaseUrl(providerId: string, config: ApiConfiguration): string | undefined {
	const baseUrlMap: Record<string, keyof ApiConfiguration> = {
		anthropic: "anthropicBaseUrl",
		openai: "openAiBaseUrl",
		// The OpenAI Compatible provider may be stored under its SDK spelling
		// (settings written through the SDK settings store) instead of the
		// extension's legacy "openai" id; both use the same legacy state field.
		"openai-compatible": "openAiBaseUrl",
		ollama: "ollamaBaseUrl",
		lmstudio: "lmStudioBaseUrl",
		gemini: "geminiBaseUrl",
		requesty: "requestyBaseUrl",
		litellm: "liteLlmBaseUrl",
		asksage: "asksageApiUrl",
		oca: "ocaBaseUrl",
		aihubmix: "aihubmixBaseUrl",
		dify: "difyBaseUrl",
	}

	const field = baseUrlMap[providerId]
	if (field) {
		const fromState = normalizeSdkBaseUrl(providerId, config[field])
		if (fromState) {
			return fromState
		}
	}

	// SDK-backed providers save their base URL in providers.json instead of
	// legacy ApiConfiguration fields. Fall back to that store (mirroring
	// resolveApiKey) so ProviderConfig consumers that don't re-resolve settings
	// themselves — e.g. the compaction summarizer's createHandlerAsync — still
	// reach the configured endpoint instead of the provider default.
	try {
		const manager = getProviderSettingsManager()
		const settingsBaseUrl = manager.getProviderSettings(providerSettingsProviderId(providerId))?.baseUrl
		const normalized = normalizeSdkBaseUrl(providerId, settingsBaseUrl)
		if (normalized) {
			return normalized
		}
	} catch {
		Logger.warn(`[SessionFactory] Failed to read ${providerId} base URL from providers.json`)
	}

	return undefined
}

/**
 * Resolve the regional API line ("china" | "international") for providers with
 * regional endpoints (Qwen, Moonshot, Z AI, MiniMax and their coding
 * variants). Resolution order:
 *
 * 1. The provider's own legacy StateManager field (mirroring resolveBaseUrl).
 * 2. The provider's own providers.json `apiLine` (SDK-store fallback).
 * 3. For coding variants without their own legacy field or stored line, the
 *    base provider's legacy field (qwen-code shares Qwen's DashScope region,
 *    zai-coding-plan shares Z AI's account region) — so a variant-specific
 *    providers.json setting still wins over the shared field.
 *
 * The SDK gateway maps the line to the provider's regional base URL when no
 * explicit base URL is configured.
 */
export function resolveApiLine(providerId: string, config: ApiConfiguration): ProviderApiLine | undefined {
	const apiLineMap: Record<string, keyof ApiConfiguration> = {
		qwen: "qwenApiLine",
		moonshot: "moonshotApiLine",
		zai: "zaiApiLine",
		minimax: "minimaxApiLine",
	}
	const sharedApiLineMap: Record<string, keyof ApiConfiguration> = {
		"qwen-code": "qwenApiLine",
		"zai-coding-plan": "zaiApiLine",
	}

	const field = apiLineMap[providerId]
	if (field) {
		const fromState = config[field]
		if (isProviderApiLine(fromState)) {
			return fromState
		}
	}

	try {
		const settingsApiLine = getProviderSettingsManager().getProviderSettings(providerSettingsProviderId(providerId))?.apiLine
		if (isProviderApiLine(settingsApiLine)) {
			return settingsApiLine
		}
	} catch {
		Logger.warn(`[SessionFactory] Failed to read ${providerId} API line from providers.json`)
	}

	const sharedField = sharedApiLineMap[providerId]
	if (sharedField) {
		const fromSharedState = config[sharedField]
		if (isProviderApiLine(fromSharedState)) {
			return fromSharedState
		}
	}

	return undefined
}

// ---------------------------------------------------------------------------
// Session config builder
// ---------------------------------------------------------------------------

/**
 * Build a CoreSessionConfig from the current state.
 *
 * Reads provider settings from the classic StateManager's ApiConfiguration
 * (which correctly reads from globalState.json + secrets.json), then resolves
 * the provider, model, and API key for the current mode (plan/act).
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
	let apiLine: ProviderApiLine | undefined
	let apiConfig: ApiConfiguration | undefined
	// Cloud-provider structured options. The core runtime reads these from
	// CoreSessionConfig.providerConfig; without them the SDK gateway never receives
	// region/project/auth fields for inference calls.
	let bedrockProviderConfig: BedrockProviderConfig | undefined
	let vertexProviderConfig: Pick<ProviderSettings, "gcp" | "region"> | undefined
	let sapProviderConfig: SapProviderConfig | undefined
	let ollamaProviderConfig: ReturnType<typeof resolveOllamaProviderConfig> | undefined

	try {
		const stateManager = StateManager.get()
		apiConfig = stateManager.getApiConfiguration()

		// Resolve the provider for the current mode. State written by older
		// builds or other hosts may carry SDK catalog spellings (e.g.
		// `openai-compatible`); fold them back to the legacy spelling the
		// provider-keyed maps below are keyed by.
		const modeProvider = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider
		providerId = modeProvider ? toLegacyApiProvider(modeProvider) : modeProvider

		if (providerId) {
			// Resolve API key
			apiKey = resolveApiKey(providerId, apiConfig)

			// Resolve model ID
			modelId = resolveModelId(providerId, mode, apiConfig)

			// Resolve base URL
			baseUrl = resolveBaseUrl(providerId, apiConfig)

			// Resolve the regional API line (Qwen/Moonshot/Z AI/MiniMax). The
			// SDK gateway routes to the line's regional endpoint when no
			// explicit base URL is set.
			apiLine = resolveApiLine(providerId, apiConfig)

			// Resolve Bedrock region + AWS authentication options from the legacy
			// ApiConfiguration (StateManager is the VSCode source of truth, not
			// providers.json).
			if (providerId === "bedrock") {
				bedrockProviderConfig = buildBedrockProviderConfig(apiConfig, mode)
			}

			if (providerId === "vertex") {
				vertexProviderConfig = resolveVertexProviderConfig(apiConfig)
			}

			if (providerId === "sapaicore") {
				sapProviderConfig = buildSapProviderConfig(apiConfig, mode)
				baseUrl = sapProviderConfig.baseUrl
			}

			if (providerId === "ollama") {
				ollamaProviderConfig = resolveOllamaProviderConfig(apiConfig, modelId)
			}

			Logger.log(
				`[SessionFactory] Resolved from StateManager: provider=${providerId}, model=${modelId}, hasApiKey=${!!apiKey}`,
			)
		}
	} catch (error) {
		Logger.warn("[SessionFactory] StateManager credential resolution failed:", error)
	}

	// Fallback: try SDK's ProviderSettingsManager only when StateManager did not
	// resolve a provider at all. If the user selected a provider but credentials
	// are missing, keep that provider/model so the UI can surface the right auth
	// state instead of silently switching to a previous provider.
	if (!providerId) {
		try {
			const dataDir = resolveDataDir()
			const manager = getProviderSettingsManager(dataDir)
			const lastUsed = manager.getLastUsedProviderSettings({
				isClinePassEnabled: true,
			})

			if (lastUsed?.provider && lastUsed?.apiKey) {
				// providers.json stores SDK provider ids (e.g. `openai-compatible`);
				// normalize to the legacy spelling used across this factory.
				providerId = toLegacyApiProvider(lastUsed.provider)
				modelId = lastUsed.model
				apiKey = lastUsed.apiKey
				baseUrl = lastUsed.baseUrl
				apiLine = isProviderApiLine(lastUsed.apiLine) ? lastUsed.apiLine : undefined
				Logger.log(`[SessionFactory] Using SDK provider fallback: ${providerId}/${modelId}`)
			}
		} catch (error) {
			Logger.warn("[SessionFactory] SDK ProviderSettingsManager fallback failed:", error)
		}
	}

	// Final defaults. Keep this aligned with the provider catalog so the UI and
	// session factory share one source of truth for default models.
	providerId = providerId ?? DEFAULT_PROVIDER_ID
	if (!modelId && providerHasLocalModelSource(providerId)) {
		// Local-model-source providers: the committed selection lives in
		// providers.json when the legacy state slot is empty (e.g. configs
		// created through the SDK settings store). Never fall through to a
		// catalog default — an empty model id surfaces an explicit "select a
		// model" state instead of silently running a model the user never chose.
		try {
			modelId = getProviderSettingsManager().getProviderSettings(providerSettingsProviderId(providerId))?.model?.trim()
		} catch {
			Logger.warn(`[SessionFactory] Failed to read ${providerId} model from providers.json`)
		}
		modelId = modelId || ""
	} else {
		modelId = modelId ?? getDefaultModelIdForProvider(providerId) ?? getDefaultModelIdForProvider(DEFAULT_PROVIDER_ID) ?? ""
	}
	if (!apiKey && apiConfig) {
		apiKey = resolveApiKey(providerId, apiConfig)
	}
	apiKey = apiKey ?? ""
	const committedRuntimeModel = resolveCommittedRuntimeModel(providerId, mode, modelId)
	const overriddenMaxTokens = committedRuntimeModel?.overrides?.maxTokens
	const maxTokensPerTurn =
		positiveFiniteNumber(overriddenMaxTokens) ??
		(providerId === "openai" ? resolveOpenAiCompatibleMaxTokens(apiConfig, mode) : undefined)
	const temperature = nonNegativeFiniteNumber(committedRuntimeModel?.overrides?.temperature)
	const reasoningConfig =
		providerId === "oca"
			? (resolveOcaReasoningConfig(mode, apiConfig) ?? resolveProviderReasoningConfig(providerId))
			: resolveProviderReasoningConfig(providerId)

	// Include rich workspace metadata so Cline API observability can extract
	// git remotes and the latest commit hash from the system message.
	let workspaceMetadata: string | undefined
	if (isClineProvider(providerId)) {
		try {
			workspaceMetadata = await buildWorkspaceMetadata(workspaceRoot)
		} catch (error) {
			Logger.warn("[SessionFactory] Failed to build workspace metadata:", error)
		}
	}

	let systemPrompt = ""
	try {
		const workspaceName = resolveWorkspaceName(cwd)
		systemPrompt = buildClineSystemPrompt({
			ide: "VS Code",
			workspaceRoot,
			workspaceName,
			metadata: workspaceMetadata,
			mode: mode === "plan" ? "plan" : "act",
			providerId,
			platform: process.platform,
			// The extension never exposes switch_to_act_mode (unlike the CLI):
			// matching the legacy extension, the user must flip the Plan/Act
			// toggle themselves, so the plan contract must not tell the model to
			// call a tool it does not have.
			planModeSwitchTool: false,
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

	const stateManager = StateManager.get()
	// Auto compact is on by default; keep this fallback aligned with the
	// `useAutoCondense` default in shared/storage/state-keys.ts.
	const globalUseAutoCondense = stateManager.getGlobalSettingsKey("useAutoCondense") ?? true
	const compactionStrategy = readCompactionStrategyGlobally()
	const enableCheckpoints = stateManager.getGlobalSettingsKey("enableCheckpointsSetting") ?? true
	const useAutoCondense = input.taskSettings?.useAutoCondense ?? globalUseAutoCondense

	// Core resolves providers against the SDK registry, which uses the SDK's
	// own provider id spelling (e.g. "openai-compatible" rather than the
	// extension's "openai"). Convert before handing the id to core.
	const sdkProviderId = toSdkProviderId(providerId)
	const hostIdentity = await resolveHostIdentity()
	const isMultiRoot = await resolveIsMultiRootWorkspace()
	let knownModels: Awaited<ReturnType<typeof getModelsForProvider>> | undefined
	try {
		// Constructing the settings manager loads providers.json and models.json into
		// the @cline/llms registry. Reading models from that registry ensures custom
		// model overrides are included in the inference provider config, not just in
		// the webview/display path.
		getProviderSettingsManager(resolveDataDir())
		knownModels = await getModelsForProvider(sdkProviderId)
		// Only inject host-resolved metadata that carries real information
		// (catalog/state base or user overrides). Pure fallback fabrications
		// must not reach the runtime; the SDK's own resolution handles those.
		const isPureFallbackModel = committedRuntimeModel?.modelInfoSource === "fallback" && !committedRuntimeModel.overrides
		if (committedRuntimeModel && !isPureFallbackModel && !knownModels?.[modelId]) {
			knownModels = {
				...(knownModels ?? {}),
				[modelId]: toSdkModelInfo(committedRuntimeModel),
			}
		}
	} catch (error) {
		Logger.warn(`[SessionFactory] Failed to resolve known models for provider=${sdkProviderId}:`, error)
	}

	// Always pass a providerConfig so the proxy/CA-aware fetch reaches the SDK
	// gateway; without it the agent loop uses bare global fetch and corporate
	// proxy/self-signed CA setups fail on JetBrains and CLI. Cloud providers
	// additionally need structured options (region/project/auth/SAP OAuth), which core
	// reads from providerConfig in createAgentModelFromConfig.
	const cloudProviderConfig = bedrockProviderConfig ?? vertexProviderConfig ?? sapProviderConfig ?? ollamaProviderConfig
	// Spread the cloud config first so the explicit fields below — notably the
	// proxy/CA-aware fetch — can never be clobbered if those types gain matching keys.
	const providerConfig = {
		...(cloudProviderConfig ?? {}),
		providerId: sdkProviderId,
		modelId,
		...(apiKey ? { apiKey } : {}),
		...(baseUrl !== undefined ? { baseUrl } : {}),
		...(apiLine !== undefined ? { apiLine } : {}),
		...(knownModels && Object.keys(knownModels).length > 0 ? { knownModels } : {}),
		// Mirror the user's Max Output Tokens for consumers that build handlers
		// straight from providerConfig — notably the compaction summarizer, which
		// otherwise falls back to a small default output cap (CLINE-2911).
		...(maxTokensPerTurn !== undefined ? { maxOutputTokens: maxTokensPerTurn } : {}),
		fetch,
	}

	const config: CoreSessionConfig = {
		providerId: sdkProviderId,
		modelId,
		apiKey,
		baseUrl,
		providerConfig,
		// Also expose the catalog at the top level: manual compaction
		// (sdk-compaction.ts) budgets against config.knownModels[modelId] and
		// otherwise falls back to a conservative 64k input budget.
		...(knownModels && Object.keys(knownModels).length > 0 ? { knownModels } : {}),
		cwd,
		workspaceRoot,
		systemPrompt,
		enableTools: true,
		checkpoint: {
			enabled: enableCheckpoints,
		},
		enableSpawnAgent: false,
		enableAgentTeams: false,
		...(useAutoCondense
			? {
					compaction: {
						enabled: true,
						strategy: compactionStrategy,
					},
				}
			: {}),
		disableMcpSettingsTools: true,
		mode: mode === "plan" ? "plan" : "act",
		...reasoningConfig,
		...(maxTokensPerTurn !== undefined ? { maxTokensPerTurn } : {}),
		...(temperature !== undefined ? { temperature } : {}),
		maxIterations: undefined,
		logger: sdkLogger,
		extensionContext: {
			user: distinctId ? { distinctId } : undefined,
			client: {
				name: hostIdentity?.clineType || ClineClient.VSCode,
				version: hostIdentity?.clineVersion || ExtensionRegistryInfo.version,
				platform: hostIdentity?.platform || undefined,
				platformVersion: hostIdentity?.version || undefined,
				isMultiRoot,
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
 * IMPORTANT: We pass `interactive: true` but NO `prompt`. This allocates the
 * session in memory and returns immediately; no persisted session row or
 * artifacts are created yet. The caller then uses
 * `core.send({ sessionId, prompt })` for the first user turn, which persists
 * that same session ID before inference. This keeps initialization responsive
 * without leaving empty history entries when the user never sends a message.
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
