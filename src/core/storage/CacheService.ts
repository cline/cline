import { ApiConfiguration } from "@shared/api"
import { updateGlobalState, updateWorkspaceState, getAllExtensionState, storeSecret } from "./state"
import { SecretKey, GlobalStateKey, LocalStateKey } from "./state-keys"
import { CACHE_SERVICE_NOT_INITIALIZED } from "./error-messages"
import type { ExtensionContext } from "vscode"

/**
 * Interface for persistence error event data
 */
export interface PersistenceErrorEvent {
	error: Error
}

/**
 * In-memory cache service for fast state access
 * Provides immediate reads/writes with async disk persistence
 */
export class CacheService {
	private globalStateCache: Map<GlobalStateKey, any> = new Map()
	private secretsCache: Map<SecretKey, string | undefined> = new Map()
	private workspaceStateCache: Map<LocalStateKey, any> = new Map()
	private context: ExtensionContext
	private isInitialized = false

	// Debounced persistence state
	private pendingGlobalState = new Set<GlobalStateKey>()
	private pendingSecrets = new Set<SecretKey>()
	private pendingWorkspaceState = new Set<LocalStateKey>()
	private persistenceTimeout: NodeJS.Timeout | null = null
	private readonly PERSISTENCE_DELAY_MS = 500

	// Callback for persistence errors
	onPersistenceError?: (event: PersistenceErrorEvent) => void

	constructor(context: ExtensionContext) {
		this.context = context
	}

	/**
	 * Initialize the cache by loading data from disk
	 */
	async initialize(): Promise<void> {
		try {
			// Load API configuration and populate cache with component keys
			const { apiConfiguration } = await getAllExtensionState(this.context)
			if (apiConfiguration) {
				// Populate the caches with the API configuration component keys
				// Use populate method to avoid triggering persistence during initialization
				this.populateApiConfigurationCache(apiConfiguration)
			}

			this.isInitialized = true
			console.log("CacheService initialized successfully")
		} catch (error) {
			console.error("Failed to initialize CacheService:", error)
			throw error
		}
	}

	/**
	 * Set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalState<T>(key: GlobalStateKey, value: T): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.globalStateCache.set(key, value)

		// Add to pending persistence set and schedule debounced write
		this.pendingGlobalState.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalStateBatch(updates: Partial<Record<GlobalStateKey, any>>): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			this.globalStateCache.set(key as GlobalStateKey, value)
			this.pendingGlobalState.add(key as GlobalStateKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecret(key: SecretKey, value: string | undefined): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.secretsCache.set(key, value)

		// Add to pending persistence set and schedule debounced write
		this.pendingSecrets.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecretsBatch(updates: Partial<Record<SecretKey, string | undefined>>): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			this.secretsCache.set(key as SecretKey, value)
			this.pendingSecrets.add(key as SecretKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set method for workspace state keys - updates cache immediately and schedules debounced persistence
	 */
	setWorkspaceState<T>(key: LocalStateKey, value: T): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.workspaceStateCache.set(key, value)

		// Add to pending persistence set and schedule debounced write
		this.pendingWorkspaceState.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for workspace state keys - updates cache immediately and schedules debounced persistence
	 */
	setWorkspaceStateBatch(updates: Partial<Record<LocalStateKey, any>>): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			this.workspaceStateCache.set(key as LocalStateKey, value)
			this.pendingWorkspaceState.add(key as LocalStateKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Convenience method for getting API configuration
	 * Ensures cache is initialized if not already done
	 */
	getApiConfiguration(): ApiConfiguration {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Construct API configuration from cached component keys
		return this.constructApiConfigurationFromCache()
	}

	/**
	 * Convenience method for setting API configuration
	 */
	setApiConfiguration(apiConfiguration: ApiConfiguration): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		const {
			apiKey,
			openRouterApiKey,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsBedrockApiKey,
			awsProfile,
			awsUseProfile,
			awsAuthentication,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiApiKey,
			openAiHeaders,
			ollamaBaseUrl,
			ollamaApiKey,
			ollamaApiOptionsCtxNum,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiApiKey,
			geminiBaseUrl,
			openAiNativeApiKey,
			deepSeekApiKey,
			requestyApiKey,
			togetherApiKey,
			qwenApiKey,
			doubaoApiKey,
			mistralApiKey,
			azureApiVersion,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmApiKey,
			liteLlmUsePromptCache,
			qwenApiLine,
			moonshotApiLine,
			asksageApiKey,
			asksageApiUrl,
			xaiApiKey,
			clineAccountId,
			sambanovaApiKey,
			cerebrasApiKey,
			groqApiKey,
			moonshotApiKey,
			nebiusApiKey,
			favoritedModelIds,
			fireworksApiKey,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			claudeCodePath,
			basetenApiKey,
			huggingFaceApiKey,
			requestTimeoutMs,
			// Plan mode configurations
			planModeApiProvider,
			planModeApiModelId,
			planModeThinkingBudgetTokens,
			planModeReasoningEffort,
			planModeVsCodeLmModelSelector,
			planModeAwsBedrockCustomSelected,
			planModeAwsBedrockCustomModelBaseId,
			planModeOpenRouterModelId,
			planModeOpenRouterModelInfo,
			planModeOpenAiModelId,
			planModeOpenAiModelInfo,
			planModeOllamaModelId,
			planModeLmStudioModelId,
			planModeLiteLlmModelId,
			planModeLiteLlmModelInfo,
			planModeRequestyModelId,
			planModeRequestyModelInfo,
			planModeTogetherModelId,
			planModeFireworksModelId,
			planModeSapAiCoreModelId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,
			// Act mode configurations
			actModeApiProvider,
			actModeApiModelId,
			actModeThinkingBudgetTokens,
			actModeReasoningEffort,
			actModeVsCodeLmModelSelector,
			actModeAwsBedrockCustomSelected,
			actModeAwsBedrockCustomModelBaseId,
			actModeOpenRouterModelId,
			actModeOpenRouterModelInfo,
			actModeOpenAiModelId,
			actModeOpenAiModelInfo,
			actModeOllamaModelId,
			actModeLmStudioModelId,
			actModeLiteLlmModelId,
			actModeLiteLlmModelInfo,
			actModeRequestyModelId,
			actModeRequestyModelInfo,
			actModeTogetherModelId,
			actModeFireworksModelId,
			actModeSapAiCoreModelId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,
		} = apiConfiguration

		// Batch update global state keys
		this.setGlobalStateBatch({
			// Plan mode configuration updates
			planModeApiProvider,
			planModeApiModelId,
			planModeThinkingBudgetTokens,
			planModeReasoningEffort,
			planModeVsCodeLmModelSelector,
			planModeAwsBedrockCustomSelected,
			planModeAwsBedrockCustomModelBaseId,
			planModeOpenRouterModelId,
			planModeOpenRouterModelInfo,
			planModeOpenAiModelId,
			planModeOpenAiModelInfo,
			planModeOllamaModelId,
			planModeLmStudioModelId,
			planModeLiteLlmModelId,
			planModeLiteLlmModelInfo,
			planModeRequestyModelId,
			planModeRequestyModelInfo,
			planModeTogetherModelId,
			planModeFireworksModelId,
			planModeSapAiCoreModelId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,

			// Act mode configuration updates
			actModeApiProvider,
			actModeApiModelId,
			actModeThinkingBudgetTokens,
			actModeReasoningEffort,
			actModeVsCodeLmModelSelector,
			actModeAwsBedrockCustomSelected,
			actModeAwsBedrockCustomModelBaseId,
			actModeOpenRouterModelId,
			actModeOpenRouterModelInfo,
			actModeOpenAiModelId,
			actModeOpenAiModelInfo,
			actModeOllamaModelId,
			actModeLmStudioModelId,
			actModeLiteLlmModelId,
			actModeLiteLlmModelInfo,
			actModeRequestyModelId,
			actModeRequestyModelInfo,
			actModeTogetherModelId,
			actModeFireworksModelId,
			actModeSapAiCoreModelId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,

			// Global state updates
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsProfile,
			awsUseProfile,
			awsAuthentication,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiHeaders,
			ollamaBaseUrl,
			ollamaApiOptionsCtxNum,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiBaseUrl,
			azureApiVersion,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmUsePromptCache,
			qwenApiLine,
			moonshotApiLine,
			asksageApiUrl,
			favoritedModelIds,
			requestTimeoutMs,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			claudeCodePath,
		})

		// Batch update secrets
		this.setSecretsBatch({
			apiKey,
			openRouterApiKey,
			clineAccountId,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsBedrockApiKey,
			openAiApiKey,
			ollamaApiKey,
			geminiApiKey,
			openAiNativeApiKey,
			deepSeekApiKey,
			requestyApiKey,
			togetherApiKey,
			qwenApiKey,
			doubaoApiKey,
			mistralApiKey,
			liteLlmApiKey,
			fireworksApiKey,
			asksageApiKey,
			xaiApiKey,
			sambanovaApiKey,
			cerebrasApiKey,
			groqApiKey,
			moonshotApiKey,
			nebiusApiKey,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			basetenApiKey,
			huggingFaceApiKey,
		})
	}

	/**
	 * Get method for global state keys - reads from in-memory cache
	 */
	getGlobalStateKey<T>(key: GlobalStateKey): T | undefined {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}
		return this.globalStateCache.get(key) as T | undefined
	}

	/**
	 * Get method for secret keys - reads from in-memory cache
	 */
	getSecretKey(key: SecretKey): string | undefined {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}
		return this.secretsCache.get(key)
	}

	/**
	 * Get method for workspace state keys - reads from in-memory cache
	 */
	getWorkspaceStateKey<T>(key: LocalStateKey): T | undefined {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}
		return this.workspaceStateCache.get(key) as T | undefined
	}

	/**
	 * Reinitialize the cache service by clearing all state and reloading from disk
	 * Used for error recovery when write operations fail
	 */
	async reInitialize(): Promise<void> {
		// Clear all cached data and pending state
		this.dispose()

		// Reinitialize from disk
		await this.initialize()
	}

	/**
	 * Dispose of the cache service
	 */
	private dispose(): void {
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}

		this.pendingGlobalState.clear()
		this.pendingSecrets.clear()
		this.pendingWorkspaceState.clear()

		this.globalStateCache.clear()
		this.secretsCache.clear()
		this.workspaceStateCache.clear()

		this.isInitialized = false
	}

	/**
	 * Schedule debounced persistence - simple timeout-based persistence
	 */
	private scheduleDebouncedPersistence(): void {
		// Clear existing timeout if one is pending
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
		}

		// Schedule a new timeout to persist pending changes
		this.persistenceTimeout = setTimeout(async () => {
			try {
				await Promise.all([
					this.persistGlobalStateBatch(this.pendingGlobalState),
					this.persistSecretsBatch(this.pendingSecrets),
					this.persistWorkspaceStateBatch(this.pendingWorkspaceState),
				])

				// Clear pending sets on successful persistence
				this.pendingGlobalState.clear()
				this.pendingSecrets.clear()
				this.pendingWorkspaceState.clear()
				this.persistenceTimeout = null
			} catch (error) {
				console.error("Failed to persist pending changes:", error)
				this.persistenceTimeout = null

				// Call persistence error callback for error recovery
				this.onPersistenceError?.({ error: error as Error })
			}
		}, this.PERSISTENCE_DELAY_MS)
	}

	/**
	 * Private method to batch persist global state keys with Promise.all
	 */
	private async persistGlobalStateBatch(keys: Set<GlobalStateKey>): Promise<void> {
		try {
			await Promise.all(
				Array.from(keys).map((key) => {
					const value = this.globalStateCache.get(key)
					return this.context.globalState.update(key, value)
				}),
			)
		} catch (error) {
			console.error("Failed to persist global state batch:", error)
			throw error
		}
	}

	/**
	 * Private method to batch persist secrets with Promise.all
	 */
	private async persistSecretsBatch(keys: Set<SecretKey>): Promise<void> {
		try {
			await Promise.all(
				Array.from(keys).map((key) => {
					const value = this.secretsCache.get(key)
					if (value) {
						return this.context.secrets.store(key, value)
					} else {
						return this.context.secrets.delete(key)
					}
				}),
			)
		} catch (error) {
			console.error("Failed to persist secrets batch:", error)
			throw error
		}
	}

	/**
	 * Private method to batch persist workspace state keys with Promise.all
	 */
	private async persistWorkspaceStateBatch(keys: Set<LocalStateKey>): Promise<void> {
		try {
			await Promise.all(
				Array.from(keys).map((key) => {
					const value = this.workspaceStateCache.get(key)
					return this.context.workspaceState.update(key, value)
				}),
			)
		} catch (error) {
			console.error("Failed to persist workspace state batch:", error)
			throw error
		}
	}

	/**
	 * Private method to populate API configuration cache without triggering persistence
	 * Used during initialization
	 */
	private populateApiConfigurationCache(apiConfiguration: ApiConfiguration): void {
		const {
			apiKey,
			openRouterApiKey,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsBedrockApiKey,
			awsProfile,
			awsUseProfile,
			awsAuthentication,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiApiKey,
			openAiHeaders,
			ollamaBaseUrl,
			ollamaApiKey,
			ollamaApiOptionsCtxNum,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiApiKey,
			geminiBaseUrl,
			openAiNativeApiKey,
			deepSeekApiKey,
			requestyApiKey,
			togetherApiKey,
			qwenApiKey,
			doubaoApiKey,
			mistralApiKey,
			azureApiVersion,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmApiKey,
			liteLlmUsePromptCache,
			qwenApiLine,
			moonshotApiLine,
			asksageApiKey,
			asksageApiUrl,
			xaiApiKey,
			clineAccountId,
			sambanovaApiKey,
			cerebrasApiKey,
			groqApiKey,
			basetenApiKey,
			moonshotApiKey,
			nebiusApiKey,
			favoritedModelIds,
			fireworksApiKey,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			claudeCodePath,
			huggingFaceApiKey,
			requestTimeoutMs,
			// Plan mode configurations
			planModeApiProvider,
			planModeApiModelId,
			planModeThinkingBudgetTokens,
			planModeReasoningEffort,
			planModeVsCodeLmModelSelector,
			planModeAwsBedrockCustomSelected,
			planModeAwsBedrockCustomModelBaseId,
			planModeOpenRouterModelId,
			planModeOpenRouterModelInfo,
			planModeOpenAiModelId,
			planModeOpenAiModelInfo,
			planModeOllamaModelId,
			planModeLmStudioModelId,
			planModeLiteLlmModelId,
			planModeLiteLlmModelInfo,
			planModeRequestyModelId,
			planModeRequestyModelInfo,
			planModeTogetherModelId,
			planModeFireworksModelId,
			planModeSapAiCoreModelId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,
			// Act mode configurations
			actModeApiProvider,
			actModeApiModelId,
			actModeThinkingBudgetTokens,
			actModeReasoningEffort,
			actModeVsCodeLmModelSelector,
			actModeAwsBedrockCustomSelected,
			actModeAwsBedrockCustomModelBaseId,
			actModeOpenRouterModelId,
			actModeOpenRouterModelInfo,
			actModeOpenAiModelId,
			actModeOpenAiModelInfo,
			actModeOllamaModelId,
			actModeLmStudioModelId,
			actModeLiteLlmModelId,
			actModeLiteLlmModelInfo,
			actModeRequestyModelId,
			actModeRequestyModelInfo,
			actModeTogetherModelId,
			actModeFireworksModelId,
			actModeSapAiCoreModelId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,
		} = apiConfiguration

		// Directly populate global state cache without triggering persistence
		const globalStateUpdates = {
			// Plan mode configuration updates
			planModeApiProvider,
			planModeApiModelId,
			planModeThinkingBudgetTokens,
			planModeReasoningEffort,
			planModeVsCodeLmModelSelector,
			planModeAwsBedrockCustomSelected,
			planModeAwsBedrockCustomModelBaseId,
			planModeOpenRouterModelId,
			planModeOpenRouterModelInfo,
			planModeOpenAiModelId,
			planModeOpenAiModelInfo,
			planModeOllamaModelId,
			planModeLmStudioModelId,
			planModeLiteLlmModelId,
			planModeLiteLlmModelInfo,
			planModeRequestyModelId,
			planModeRequestyModelInfo,
			planModeTogetherModelId,
			planModeFireworksModelId,
			planModeSapAiCoreModelId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,

			// Act mode configuration updates
			actModeApiProvider,
			actModeApiModelId,
			actModeThinkingBudgetTokens,
			actModeReasoningEffort,
			actModeVsCodeLmModelSelector,
			actModeAwsBedrockCustomSelected,
			actModeAwsBedrockCustomModelBaseId,
			actModeOpenRouterModelId,
			actModeOpenRouterModelInfo,
			actModeOpenAiModelId,
			actModeOpenAiModelInfo,
			actModeOllamaModelId,
			actModeLmStudioModelId,
			actModeLiteLlmModelId,
			actModeLiteLlmModelInfo,
			actModeRequestyModelId,
			actModeRequestyModelInfo,
			actModeTogetherModelId,
			actModeFireworksModelId,
			actModeSapAiCoreModelId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,

			// Global state updates
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsProfile,
			awsUseProfile,
			awsAuthentication,
			vertexProjectId,
			vertexRegion,
			openAiBaseUrl,
			openAiHeaders,
			ollamaBaseUrl,
			ollamaApiOptionsCtxNum,
			lmStudioBaseUrl,
			anthropicBaseUrl,
			geminiBaseUrl,
			azureApiVersion,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmUsePromptCache,
			qwenApiLine,
			moonshotApiLine,
			asksageApiUrl,
			favoritedModelIds,
			requestTimeoutMs,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			claudeCodePath,
		}

		// Populate global state cache directly
		Object.entries(globalStateUpdates).forEach(([key, value]) => {
			this.globalStateCache.set(key as GlobalStateKey, value)
		})

		// Directly populate secrets cache without triggering persistence
		const secretsUpdates = {
			apiKey,
			openRouterApiKey,
			clineAccountId,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsBedrockApiKey,
			openAiApiKey,
			ollamaApiKey,
			geminiApiKey,
			openAiNativeApiKey,
			deepSeekApiKey,
			requestyApiKey,
			togetherApiKey,
			qwenApiKey,
			doubaoApiKey,
			mistralApiKey,
			liteLlmApiKey,
			fireworksApiKey,
			asksageApiKey,
			xaiApiKey,
			sambanovaApiKey,
			cerebrasApiKey,
			groqApiKey,
			basetenApiKey,
			moonshotApiKey,
			nebiusApiKey,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			huggingFaceApiKey,
		}

		// Populate secrets cache directly
		Object.entries(secretsUpdates).forEach(([key, value]) => {
			this.secretsCache.set(key as SecretKey, value)
		})
	}

	/**
	 * Construct API configuration from cached component keys
	 */
	private constructApiConfigurationFromCache(): ApiConfiguration {
		return {
			// Secrets
			apiKey: this.secretsCache.get("apiKey"),
			openRouterApiKey: this.secretsCache.get("openRouterApiKey"),
			clineAccountId: this.secretsCache.get("clineAccountId"),
			awsAccessKey: this.secretsCache.get("awsAccessKey"),
			awsSecretKey: this.secretsCache.get("awsSecretKey"),
			awsSessionToken: this.secretsCache.get("awsSessionToken"),
			awsBedrockApiKey: this.secretsCache.get("awsBedrockApiKey"),
			openAiApiKey: this.secretsCache.get("openAiApiKey"),
			ollamaApiKey: this.secretsCache.get("ollamaApiKey"),
			geminiApiKey: this.secretsCache.get("geminiApiKey"),
			openAiNativeApiKey: this.secretsCache.get("openAiNativeApiKey"),
			deepSeekApiKey: this.secretsCache.get("deepSeekApiKey"),
			requestyApiKey: this.secretsCache.get("requestyApiKey"),
			togetherApiKey: this.secretsCache.get("togetherApiKey"),
			qwenApiKey: this.secretsCache.get("qwenApiKey"),
			doubaoApiKey: this.secretsCache.get("doubaoApiKey"),
			mistralApiKey: this.secretsCache.get("mistralApiKey"),
			liteLlmApiKey: this.secretsCache.get("liteLlmApiKey"),
			fireworksApiKey: this.secretsCache.get("fireworksApiKey"),
			asksageApiKey: this.secretsCache.get("asksageApiKey"),
			xaiApiKey: this.secretsCache.get("xaiApiKey"),
			sambanovaApiKey: this.secretsCache.get("sambanovaApiKey"),
			cerebrasApiKey: this.secretsCache.get("cerebrasApiKey"),
			groqApiKey: this.secretsCache.get("groqApiKey"),
			basetenApiKey: this.secretsCache.get("basetenApiKey"),
			moonshotApiKey: this.secretsCache.get("moonshotApiKey"),
			nebiusApiKey: this.secretsCache.get("nebiusApiKey"),
			sapAiCoreClientId: this.secretsCache.get("sapAiCoreClientId"),
			sapAiCoreClientSecret: this.secretsCache.get("sapAiCoreClientSecret"),
			huggingFaceApiKey: this.secretsCache.get("huggingFaceApiKey"),

			// Global state
			awsRegion: this.globalStateCache.get("awsRegion"),
			awsUseCrossRegionInference: this.globalStateCache.get("awsUseCrossRegionInference"),
			awsBedrockUsePromptCache: this.globalStateCache.get("awsBedrockUsePromptCache"),
			awsBedrockEndpoint: this.globalStateCache.get("awsBedrockEndpoint"),
			awsProfile: this.globalStateCache.get("awsProfile"),
			awsUseProfile: this.globalStateCache.get("awsUseProfile"),
			awsAuthentication: this.globalStateCache.get("awsAuthentication"),
			vertexProjectId: this.globalStateCache.get("vertexProjectId"),
			vertexRegion: this.globalStateCache.get("vertexRegion"),
			openAiBaseUrl: this.globalStateCache.get("openAiBaseUrl"),
			openAiHeaders: this.globalStateCache.get("openAiHeaders") || {},
			ollamaBaseUrl: this.globalStateCache.get("ollamaBaseUrl"),
			ollamaApiOptionsCtxNum: this.globalStateCache.get("ollamaApiOptionsCtxNum"),
			lmStudioBaseUrl: this.globalStateCache.get("lmStudioBaseUrl"),
			anthropicBaseUrl: this.globalStateCache.get("anthropicBaseUrl"),
			geminiBaseUrl: this.globalStateCache.get("geminiBaseUrl"),
			azureApiVersion: this.globalStateCache.get("azureApiVersion"),
			openRouterProviderSorting: this.globalStateCache.get("openRouterProviderSorting"),
			liteLlmBaseUrl: this.globalStateCache.get("liteLlmBaseUrl"),
			liteLlmUsePromptCache: this.globalStateCache.get("liteLlmUsePromptCache"),
			qwenApiLine: this.globalStateCache.get("qwenApiLine"),
			moonshotApiLine: this.globalStateCache.get("moonshotApiLine"),
			asksageApiUrl: this.globalStateCache.get("asksageApiUrl"),
			favoritedModelIds: this.globalStateCache.get("favoritedModelIds"),
			requestTimeoutMs: this.globalStateCache.get("requestTimeoutMs"),
			fireworksModelMaxCompletionTokens: this.globalStateCache.get("fireworksModelMaxCompletionTokens"),
			fireworksModelMaxTokens: this.globalStateCache.get("fireworksModelMaxTokens"),
			sapAiCoreBaseUrl: this.globalStateCache.get("sapAiCoreBaseUrl"),
			sapAiCoreTokenUrl: this.globalStateCache.get("sapAiCoreTokenUrl"),
			sapAiResourceGroup: this.globalStateCache.get("sapAiResourceGroup"),
			claudeCodePath: this.globalStateCache.get("claudeCodePath"),

			// Plan mode configurations
			planModeApiProvider: this.globalStateCache.get("planModeApiProvider"),
			planModeApiModelId: this.globalStateCache.get("planModeApiModelId"),
			planModeThinkingBudgetTokens: this.globalStateCache.get("planModeThinkingBudgetTokens"),
			planModeReasoningEffort: this.globalStateCache.get("planModeReasoningEffort"),
			planModeVsCodeLmModelSelector: this.globalStateCache.get("planModeVsCodeLmModelSelector"),
			planModeAwsBedrockCustomSelected: this.globalStateCache.get("planModeAwsBedrockCustomSelected"),
			planModeAwsBedrockCustomModelBaseId: this.globalStateCache.get("planModeAwsBedrockCustomModelBaseId"),
			planModeOpenRouterModelId: this.globalStateCache.get("planModeOpenRouterModelId"),
			planModeOpenRouterModelInfo: this.globalStateCache.get("planModeOpenRouterModelInfo"),
			planModeOpenAiModelId: this.globalStateCache.get("planModeOpenAiModelId"),
			planModeOpenAiModelInfo: this.globalStateCache.get("planModeOpenAiModelInfo"),
			planModeOllamaModelId: this.globalStateCache.get("planModeOllamaModelId"),
			planModeLmStudioModelId: this.globalStateCache.get("planModeLmStudioModelId"),
			planModeLiteLlmModelId: this.globalStateCache.get("planModeLiteLlmModelId"),
			planModeLiteLlmModelInfo: this.globalStateCache.get("planModeLiteLlmModelInfo"),
			planModeRequestyModelId: this.globalStateCache.get("planModeRequestyModelId"),
			planModeRequestyModelInfo: this.globalStateCache.get("planModeRequestyModelInfo"),
			planModeTogetherModelId: this.globalStateCache.get("planModeTogetherModelId"),
			planModeFireworksModelId: this.globalStateCache.get("planModeFireworksModelId"),
			planModeSapAiCoreModelId: this.globalStateCache.get("planModeSapAiCoreModelId"),
			planModeGroqModelId: this.globalStateCache.get("planModeGroqModelId"),
			planModeGroqModelInfo: this.globalStateCache.get("planModeGroqModelInfo"),
			planModeBasetenModelId: this.globalStateCache.get("planModeBasetenModelId"),
			planModeBasetenModelInfo: this.globalStateCache.get("planModeBasetenModelInfo"),
			planModeHuggingFaceModelId: this.globalStateCache.get("planModeHuggingFaceModelId"),
			planModeHuggingFaceModelInfo: this.globalStateCache.get("planModeHuggingFaceModelInfo"),

			// Act mode configurations
			actModeApiProvider: this.globalStateCache.get("actModeApiProvider"),
			actModeApiModelId: this.globalStateCache.get("actModeApiModelId"),
			actModeThinkingBudgetTokens: this.globalStateCache.get("actModeThinkingBudgetTokens"),
			actModeReasoningEffort: this.globalStateCache.get("actModeReasoningEffort"),
			actModeVsCodeLmModelSelector: this.globalStateCache.get("actModeVsCodeLmModelSelector"),
			actModeAwsBedrockCustomSelected: this.globalStateCache.get("actModeAwsBedrockCustomSelected"),
			actModeAwsBedrockCustomModelBaseId: this.globalStateCache.get("actModeAwsBedrockCustomModelBaseId"),
			actModeOpenRouterModelId: this.globalStateCache.get("actModeOpenRouterModelId"),
			actModeOpenRouterModelInfo: this.globalStateCache.get("actModeOpenRouterModelInfo"),
			actModeOpenAiModelId: this.globalStateCache.get("actModeOpenAiModelId"),
			actModeOpenAiModelInfo: this.globalStateCache.get("actModeOpenAiModelInfo"),
			actModeOllamaModelId: this.globalStateCache.get("actModeOllamaModelId"),
			actModeLmStudioModelId: this.globalStateCache.get("actModeLmStudioModelId"),
			actModeLiteLlmModelId: this.globalStateCache.get("actModeLiteLlmModelId"),
			actModeLiteLlmModelInfo: this.globalStateCache.get("actModeLiteLlmModelInfo"),
			actModeRequestyModelId: this.globalStateCache.get("actModeRequestyModelId"),
			actModeRequestyModelInfo: this.globalStateCache.get("actModeRequestyModelInfo"),
			actModeTogetherModelId: this.globalStateCache.get("actModeTogetherModelId"),
			actModeFireworksModelId: this.globalStateCache.get("actModeFireworksModelId"),
			actModeSapAiCoreModelId: this.globalStateCache.get("actModeSapAiCoreModelId"),
			actModeGroqModelId: this.globalStateCache.get("actModeGroqModelId"),
			actModeGroqModelInfo: this.globalStateCache.get("actModeGroqModelInfo"),
			actModeBasetenModelId: this.globalStateCache.get("actModeBasetenModelId"),
			actModeBasetenModelInfo: this.globalStateCache.get("actModeBasetenModelInfo"),
			actModeHuggingFaceModelId: this.globalStateCache.get("actModeHuggingFaceModelId"),
			actModeHuggingFaceModelInfo: this.globalStateCache.get("actModeHuggingFaceModelInfo"),
		} as ApiConfiguration
	}
}
