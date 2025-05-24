import { ApiHandlerOptions } from "../../shared/api"
import { ContextProxy } from "../../core/config/ContextProxy"
import { EmbedderProvider } from "./interfaces/manager"
import { getModelDimension, getDefaultModelId } from "../../shared/embeddingModels"
import { CodeIndexConfig, PreviousConfigSnapshot } from "./interfaces/config"
import { SEARCH_MIN_SCORE } from "./constants"

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
	private qdrantUrl?: string
	private qdrantApiKey?: string
	private searchMinScore?: number

	constructor(private readonly contextProxy: ContextProxy) {}

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
			qdrantUrl?: string
			qdrantApiKey?: string
			searchMinScore?: number
		}
		requiresRestart: boolean
		requiresClear: boolean
	}> {
		const previousConfigSnapshot: PreviousConfigSnapshot = {
			enabled: this.isEnabled,
			configured: this.isConfigured(),
			embedderProvider: this.embedderProvider,
			modelId: this.modelId,
			openAiKey: this.openAiOptions?.openAiNativeApiKey,
			ollamaBaseUrl: this.ollamaOptions?.ollamaBaseUrl,
			qdrantUrl: this.qdrantUrl,
			qdrantApiKey: this.qdrantApiKey,
		}

		let codebaseIndexConfig = this.contextProxy?.getGlobalState("codebaseIndexConfig") ?? {
			codebaseIndexEnabled: false,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexSearchMinScore: 0.4,
			codebaseIndexEmbedderProvider: "openai",
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
		}

		const {
			codebaseIndexEnabled,
			codebaseIndexQdrantUrl,
			codebaseIndexEmbedderProvider,
			codebaseIndexEmbedderBaseUrl,
			codebaseIndexEmbedderModelId,
		} = codebaseIndexConfig

		const openAiKey = this.contextProxy?.getSecret("codeIndexOpenAiKey") ?? ""
		const qdrantApiKey = this.contextProxy?.getSecret("codeIndexQdrantApiKey") ?? ""

		this.isEnabled = codebaseIndexEnabled || false
		this.qdrantUrl = codebaseIndexQdrantUrl
		this.qdrantApiKey = qdrantApiKey ?? ""
		this.openAiOptions = { openAiNativeApiKey: openAiKey }
		this.searchMinScore = SEARCH_MIN_SCORE

		this.embedderProvider = codebaseIndexEmbedderProvider === "ollama" ? "ollama" : "openai"
		this.modelId = codebaseIndexEmbedderModelId || undefined

		this.ollamaOptions = {
			ollamaBaseUrl: codebaseIndexEmbedderBaseUrl,
		}

		const previousModelId =
			previousConfigSnapshot.modelId ?? getDefaultModelId(previousConfigSnapshot.embedderProvider)
		const currentModelId = this.modelId ?? getDefaultModelId(this.embedderProvider)
		const previousDimension = previousModelId
			? getModelDimension(previousConfigSnapshot.embedderProvider, previousModelId)
			: undefined
		const currentDimension = currentModelId ? getModelDimension(this.embedderProvider, currentModelId) : undefined
		const requiresClear =
			previousDimension !== undefined && currentDimension !== undefined && previousDimension !== currentDimension

		return {
			configSnapshot: previousConfigSnapshot,
			currentConfig: {
				isEnabled: this.isEnabled,
				isConfigured: this.isConfigured(),
				embedderProvider: this.embedderProvider,
				modelId: this.modelId,
				openAiOptions: this.openAiOptions,
				ollamaOptions: this.ollamaOptions,
				qdrantUrl: this.qdrantUrl,
				qdrantApiKey: this.qdrantApiKey,
				searchMinScore: this.searchMinScore,
			},
			requiresRestart: this._didConfigChangeRequireRestart(previousConfigSnapshot),
			requiresClear,
		}
	}

	/**
	 * Checks if the service is properly configured based on the embedder type.
	 */
	public isConfigured(): boolean {
		if (this.embedderProvider === "openai") {
			return !!(this.openAiOptions?.openAiNativeApiKey && this.qdrantUrl)
		} else if (this.embedderProvider === "ollama") {
			// Ollama model ID has a default, so only base URL is strictly required for config
			return !!(this.ollamaOptions?.ollamaBaseUrl && this.qdrantUrl)
		}
		return false // Should not happen if embedderProvider is always set correctly
	}

	/**
	 * Determines if a configuration change requires restarting the indexing process.
	 * @param prev The previous configuration snapshot
	 * @returns boolean indicating whether a restart is needed
	 */
	private _didConfigChangeRequireRestart(prev: PreviousConfigSnapshot): boolean {
		const nowConfigured = this.isConfigured() // Recalculate based on current state

		// Check for transition from disabled/unconfigured to enabled+configured
		const transitionedToReady = (!prev.enabled || !prev.configured) && this.isEnabled && nowConfigured
		if (transitionedToReady) return true

		// If wasn't ready before and isn't ready now, no restart needed for config change itself
		if (!prev.configured && !nowConfigured) return false
		// If was disabled and still is, no restart needed
		if (!prev.enabled && !this.isEnabled) return false

		// Check for changes in relevant settings if the feature is enabled (or was enabled)
		if (this.isEnabled || prev.enabled) {
			// Check for embedder type change
			if (prev.embedderProvider !== this.embedderProvider) return true
			if (prev.modelId !== this.modelId) return true // Any model change requires restart

			// Check OpenAI settings change if using OpenAI
			if (this.embedderProvider === "openai") {
				if (prev.openAiKey !== this.openAiOptions?.openAiNativeApiKey) return true
				// Model ID check moved above
			}

			// Check Ollama settings change if using Ollama
			if (this.embedderProvider === "ollama") {
				if (prev.ollamaBaseUrl !== this.ollamaOptions?.ollamaBaseUrl) {
					return true
				}
				// Model ID check moved above
			}

			// Check Qdrant settings changes
			if (prev.qdrantUrl !== this.qdrantUrl || prev.qdrantApiKey !== this.qdrantApiKey) {
				return true
			}
		}

		return false
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
			qdrantUrl: this.qdrantUrl,
			qdrantApiKey: this.qdrantApiKey,
			searchMinScore: this.searchMinScore,
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
	 * Gets the configured minimum search score.
	 */
	public get currentSearchMinScore(): number | undefined {
		return this.searchMinScore
	}
}
