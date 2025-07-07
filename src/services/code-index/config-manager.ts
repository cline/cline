import { ApiHandlerOptions } from "../../shared/api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { EmbedderProvider } from "./interfaces/manager"
import { CodeIndexConfig, PreviousConfigSnapshot } from "./interfaces/config"
import { DEFAULT_SEARCH_MIN_SCORE, DEFAULT_MAX_SEARCH_RESULTS } from "./constants"
import { getDefaultModelId, getModelDimension, getModelScoreThreshold } from "../../shared/embeddingModels"

/**
 * Manages configuration state and validation for the code indexing feature.
 * Handles loading, validating, and providing access to configuration values.
 */
export class CodeIndexConfigManager {
	private isEnabled: boolean = false
	private embedderProvider: EmbedderProvider = "openai"
	private modelId?: string
	private openAiOptions?: ApiHandlerOptions
	private ollamaOptions?: ApiHandlerOptions
	private openAiCompatibleOptions?: { baseUrl: string; apiKey: string; modelDimension?: number }
	private geminiOptions?: { apiKey: string }
	private qdrantUrl?: string = "http://localhost:6333"
	private qdrantApiKey?: string
	private searchMinScore?: number
	private searchMaxResults?: number

	constructor(private readonly contextProxy: ContextProxy) {
		// Initialize with current configuration to avoid false restart triggers
		this._loadAndSetConfiguration()
	}

	/**
	 * Gets the context proxy instance
	 */
	public getContextProxy(): ContextProxy {
		return this.contextProxy
	}

	/**
	 * Private method that handles loading configuration from storage and updating instance variables.
	 * This eliminates code duplication between initializeWithCurrentConfig() and loadConfiguration().
	 */
	private _loadAndSetConfiguration(): void {
		// Load configuration from storage
		const codebaseIndexConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig") ?? {
			codebaseIndexEnabled: false,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderProvider: "openai",
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
			codebaseIndexSearchMinScore: undefined,
			codebaseIndexSearchMaxResults: undefined,
		}

		const {
			codebaseIndexEnabled,
			codebaseIndexQdrantUrl,
			codebaseIndexEmbedderProvider,
			codebaseIndexEmbedderBaseUrl,
			codebaseIndexEmbedderModelId,
			codebaseIndexSearchMinScore,
			codebaseIndexSearchMaxResults,
		} = codebaseIndexConfig

		const openAiKey = this.contextProxy?.getSecret("codeIndexOpenAiKey") ?? ""
		const qdrantApiKey = this.contextProxy?.getSecret("codeIndexQdrantApiKey") ?? ""
		// Fix: Read OpenAI Compatible settings from the correct location within codebaseIndexConfig
		const openAiCompatibleBaseUrl = codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl ?? ""
		const openAiCompatibleApiKey = this.contextProxy?.getSecret("codebaseIndexOpenAiCompatibleApiKey") ?? ""
		const openAiCompatibleModelDimension = codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension as
			| number
			| undefined
		const geminiApiKey = this.contextProxy?.getSecret("codebaseIndexGeminiApiKey") ?? ""

		// Update instance variables with configuration
		this.isEnabled = codebaseIndexEnabled || false
		this.qdrantUrl = codebaseIndexQdrantUrl
		this.qdrantApiKey = qdrantApiKey ?? ""
		this.searchMinScore = codebaseIndexSearchMinScore
		this.searchMaxResults = codebaseIndexSearchMaxResults
		this.openAiOptions = { openAiNativeApiKey: openAiKey }

		// Set embedder provider with support for openai-compatible
		if (codebaseIndexEmbedderProvider === "ollama") {
			this.embedderProvider = "ollama"
		} else if (codebaseIndexEmbedderProvider === "openai-compatible") {
			this.embedderProvider = "openai-compatible"
		} else if (codebaseIndexEmbedderProvider === "gemini") {
			this.embedderProvider = "gemini"
		} else {
			this.embedderProvider = "openai"
		}

		this.modelId = codebaseIndexEmbedderModelId || undefined

		this.ollamaOptions = {
			ollamaBaseUrl: codebaseIndexEmbedderBaseUrl,
		}

		this.openAiCompatibleOptions =
			openAiCompatibleBaseUrl && openAiCompatibleApiKey
				? {
						baseUrl: openAiCompatibleBaseUrl,
						apiKey: openAiCompatibleApiKey,
						modelDimension: openAiCompatibleModelDimension,
					}
				: undefined

		this.geminiOptions = geminiApiKey ? { apiKey: geminiApiKey } : undefined
	}

	/**
	 * Loads persisted configuration from globalState.
	 */
	public async loadConfiguration(): Promise<{
		configSnapshot: PreviousConfigSnapshot
		currentConfig: {
			isEnabled: boolean
			isConfigured: boolean
			embedderProvider: EmbedderProvider
			modelId?: string
			openAiOptions?: ApiHandlerOptions
			ollamaOptions?: ApiHandlerOptions
			openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
			geminiOptions?: { apiKey: string }
			qdrantUrl?: string
			qdrantApiKey?: string
			searchMinScore?: number
		}
		requiresRestart: boolean
	}> {
		// Capture the ACTUAL previous state before loading new configuration
		const previousConfigSnapshot: PreviousConfigSnapshot = {
			enabled: this.isEnabled,
			configured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			openAiKey: this.openAiOptions?.openAiNativeApiKey ?? "",
			ollamaBaseUrl: this.ollamaOptions?.ollamaBaseUrl ?? "",
			openAiCompatibleBaseUrl: this.openAiCompatibleOptions?.baseUrl ?? "",
			openAiCompatibleApiKey: this.openAiCompatibleOptions?.apiKey ?? "",
			openAiCompatibleModelDimension: this.openAiCompatibleOptions?.modelDimension,
			geminiApiKey: this.geminiOptions?.apiKey ?? "",
			qdrantUrl: this.qdrantUrl ?? "",
			qdrantApiKey: this.qdrantApiKey ?? "",
		}

		// Refresh secrets from VSCode storage to ensure we have the latest values
		await this.contextProxy.refreshSecrets()

		// Load new configuration from storage and update instance variables
		this._loadAndSetConfiguration()

		const requiresRestart = this.doesConfigChangeRequireRestart(previousConfigSnapshot)

		return {
			configSnapshot: previousConfigSnapshot,
			currentConfig: {
				isEnabled: this.isEnabled,
				isConfigured: this.isConfigured(),
				embedderProvider: this.embedderProvider,
				modelId: this.modelId,
				openAiOptions: this.openAiOptions,
				ollamaOptions: this.ollamaOptions,
				openAiCompatibleOptions: this.openAiCompatibleOptions,
				geminiOptions: this.geminiOptions,
				qdrantUrl: this.qdrantUrl,
				qdrantApiKey: this.qdrantApiKey,
				searchMinScore: this.currentSearchMinScore,
			},
			requiresRestart,
		}
	}

	/**
	 * Checks if the service is properly configured based on the embedder type.
	 */
	public isConfigured(): boolean {
		if (this.embedderProvider === "openai") {
			const openAiKey = this.openAiOptions?.openAiNativeApiKey
			const qdrantUrl = this.qdrantUrl
			return !!(openAiKey && qdrantUrl)
		} else if (this.embedderProvider === "ollama") {
			// Ollama model ID has a default, so only base URL is strictly required for config
			const ollamaBaseUrl = this.ollamaOptions?.ollamaBaseUrl
			const qdrantUrl = this.qdrantUrl
			return !!(ollamaBaseUrl && qdrantUrl)
		} else if (this.embedderProvider === "openai-compatible") {
			const baseUrl = this.openAiCompatibleOptions?.baseUrl
			const apiKey = this.openAiCompatibleOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(baseUrl && apiKey && qdrantUrl)
			return isConfigured
		} else if (this.embedderProvider === "gemini") {
			const apiKey = this.geminiOptions?.apiKey
			const qdrantUrl = this.qdrantUrl
			const isConfigured = !!(apiKey && qdrantUrl)
			return isConfigured
		}
		return false // Should not happen if embedderProvider is always set correctly
	}

	/**
	 * Determines if a configuration change requires restarting the indexing process.
	 * Simplified logic: only restart for critical changes that affect service functionality.
	 *
	 * CRITICAL CHANGES (require restart):
	 * - Provider changes (openai -> ollama, etc.)
	 * - Authentication changes (API keys, base URLs)
	 * - Vector dimension changes (model changes that affect embedding size)
	 * - Qdrant connection changes (URL, API key)
	 * - Feature enable/disable transitions
	 *
	 * MINOR CHANGES (no restart needed):
	 * - Search minimum score adjustments
	 * - UI-only settings
	 * - Non-functional configuration tweaks
	 */
	doesConfigChangeRequireRestart(prev: PreviousConfigSnapshot): boolean {
		const nowConfigured = this.isConfigured()

		// Handle null/undefined values safely
		const prevEnabled = prev?.enabled ?? false
		const prevConfigured = prev?.configured ?? false
		const prevProvider = prev?.embedderProvider ?? "openai"
		const prevOpenAiKey = prev?.openAiKey ?? ""
		const prevOllamaBaseUrl = prev?.ollamaBaseUrl ?? ""
		const prevOpenAiCompatibleBaseUrl = prev?.openAiCompatibleBaseUrl ?? ""
		const prevOpenAiCompatibleApiKey = prev?.openAiCompatibleApiKey ?? ""
		const prevOpenAiCompatibleModelDimension = prev?.openAiCompatibleModelDimension
		const prevGeminiApiKey = prev?.geminiApiKey ?? ""
		const prevQdrantUrl = prev?.qdrantUrl ?? ""
		const prevQdrantApiKey = prev?.qdrantApiKey ?? ""

		// 1. Transition from disabled/unconfigured to enabled+configured
		if ((!prevEnabled || !prevConfigured) && this.isEnabled && nowConfigured) {
			return true
		}

		// 2. If was disabled and still is, no restart needed
		if (!prevEnabled && !this.isEnabled) {
			return false
		}

		// 3. If wasn't ready before and isn't ready now, no restart needed
		if (!prevConfigured && !nowConfigured) {
			return false
		}

		// 4. CRITICAL CHANGES - Always restart for these
		if (this.isEnabled || prevEnabled) {
			// Provider change
			if (prevProvider !== this.embedderProvider) {
				return true
			}

			// Authentication changes (API keys)
			const currentOpenAiKey = this.openAiOptions?.openAiNativeApiKey ?? ""
			const currentOllamaBaseUrl = this.ollamaOptions?.ollamaBaseUrl ?? ""
			const currentOpenAiCompatibleBaseUrl = this.openAiCompatibleOptions?.baseUrl ?? ""
			const currentOpenAiCompatibleApiKey = this.openAiCompatibleOptions?.apiKey ?? ""
			const currentOpenAiCompatibleModelDimension = this.openAiCompatibleOptions?.modelDimension
			const currentGeminiApiKey = this.geminiOptions?.apiKey ?? ""
			const currentQdrantUrl = this.qdrantUrl ?? ""
			const currentQdrantApiKey = this.qdrantApiKey ?? ""

			if (prevOpenAiKey !== currentOpenAiKey) {
				return true
			}

			if (prevOllamaBaseUrl !== currentOllamaBaseUrl) {
				return true
			}

			if (
				prevOpenAiCompatibleBaseUrl !== currentOpenAiCompatibleBaseUrl ||
				prevOpenAiCompatibleApiKey !== currentOpenAiCompatibleApiKey
			) {
				return true
			}

			// Check for OpenAI Compatible modelDimension changes
			if (this.embedderProvider === "openai-compatible" || prevProvider === "openai-compatible") {
				if (prevOpenAiCompatibleModelDimension !== currentOpenAiCompatibleModelDimension) {
					return true
				}
			}

			if (prevQdrantUrl !== currentQdrantUrl || prevQdrantApiKey !== currentQdrantApiKey) {
				return true
			}

			// Vector dimension changes (still important for compatibility)
			if (this._hasVectorDimensionChanged(prevProvider, prev?.modelId)) {
				return true
			}
		}

		return false
	}

	/**
	 * Checks if model changes result in vector dimension changes that require restart.
	 */
	private _hasVectorDimensionChanged(prevProvider: EmbedderProvider, prevModelId?: string): boolean {
		const currentProvider = this.embedderProvider
		const currentModelId = this.modelId ?? getDefaultModelId(currentProvider)
		const resolvedPrevModelId = prevModelId ?? getDefaultModelId(prevProvider)

		// If model IDs are the same and provider is the same, no dimension change
		if (prevProvider === currentProvider && resolvedPrevModelId === currentModelId) {
			return false
		}

		// Get vector dimensions for both models
		const prevDimension = getModelDimension(prevProvider, resolvedPrevModelId)
		const currentDimension = getModelDimension(currentProvider, currentModelId)

		// If we can't determine dimensions, be safe and restart
		if (prevDimension === undefined || currentDimension === undefined) {
			return true
		}

		// Only restart if dimensions actually changed
		return prevDimension !== currentDimension
	}

	/**
	 * Gets the current configuration state.
	 */
	public getConfig(): CodeIndexConfig {
		return {
			isEnabled: this.isEnabled,
			isConfigured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			openAiOptions: this.openAiOptions,
			ollamaOptions: this.ollamaOptions,
			openAiCompatibleOptions: this.openAiCompatibleOptions,
			geminiOptions: this.geminiOptions,
			qdrantUrl: this.qdrantUrl,
			qdrantApiKey: this.qdrantApiKey,
			searchMinScore: this.currentSearchMinScore,
			searchMaxResults: this.currentSearchMaxResults,
		}
	}

	/**
	 * Gets whether the code indexing feature is enabled
	 */
	public get isFeatureEnabled(): boolean {
		return this.isEnabled
	}

	/**
	 * Gets whether the code indexing feature is properly configured
	 */
	public get isFeatureConfigured(): boolean {
		return this.isConfigured()
	}

	/**
	 * Gets the current embedder type (openai or ollama)
	 */
	public get currentEmbedderProvider(): EmbedderProvider {
		return this.embedderProvider
	}

	/**
	 * Gets the current Qdrant configuration
	 */
	public get qdrantConfig(): { url?: string; apiKey?: string } {
		return {
			url: this.qdrantUrl,
			apiKey: this.qdrantApiKey,
		}
	}

	/**
	 * Gets the current model ID being used for embeddings.
	 */
	public get currentModelId(): string | undefined {
		return this.modelId
	}

	/**
	 * Gets the configured minimum search score based on user setting, model-specific threshold, or fallback.
	 * Priority: 1) User setting, 2) Model-specific threshold, 3) Default DEFAULT_SEARCH_MIN_SCORE constant.
	 */
	public get currentSearchMinScore(): number {
		// First check if user has configured a custom score threshold
		if (this.searchMinScore !== undefined) {
			return this.searchMinScore
		}

		// Fall back to model-specific threshold
		const currentModelId = this.modelId ?? getDefaultModelId(this.embedderProvider)
		const modelSpecificThreshold = getModelScoreThreshold(this.embedderProvider, currentModelId)
		return modelSpecificThreshold ?? DEFAULT_SEARCH_MIN_SCORE
	}

	/**
	 * Gets the configured maximum search results.
	 * Returns user setting if configured, otherwise returns default.
	 */
	public get currentSearchMaxResults(): number {
		return this.searchMaxResults ?? DEFAULT_MAX_SEARCH_RESULTS
	}
}
