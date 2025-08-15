import { ApiConfiguration } from "@shared/api"
import { SecretKey, GlobalStateKey, LocalStateKey, GlobalState, Secrets, LocalState } from "./state-keys"
import { CACHE_SERVICE_NOT_INITIALIZED } from "./error-messages"
import type { ExtensionContext } from "vscode"
import { readStateFromDisk } from "./utils/state-helpers"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { DEFAULT_FOCUS_CHAIN_SETTINGS } from "@shared/FocusChainSettings"

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
	private globalStateCache: GlobalState = {} as GlobalState
	private secretsCache: Secrets = {} as Secrets
	private workspaceStateCache: LocalState = {} as LocalState
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
			// Load all extension state from disk
			const state = await readStateFromDisk(this.context)

			if (state) {
				// Populate the caches with all extension state fields
				// Use populate method to avoid triggering persistence during initialization
				this.populateCache(state)
			}

			this.isInitialized = true
		} catch (error) {
			console.error("Failed to initialize CacheService:", error)
			throw error
		}
	}

	/**
	 * Set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.globalStateCache[key] = value

		// Add to pending persistence set and schedule debounced write
		this.pendingGlobalState.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalStateBatch(updates: Partial<GlobalState>): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache in one go
		// Using object.assign to because typescript is not able to infer the type of the updates object when using Object.entries
		Object.assign(this.globalStateCache, updates)

		// Then track the keys for persistence
		Object.keys(updates).forEach((key) => {
			this.pendingGlobalState.add(key as GlobalStateKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecret<K extends keyof Secrets>(key: K, value: Secrets[K]): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.secretsCache[key] = value

		// Add to pending persistence set and schedule debounced write
		this.pendingSecrets.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecretsBatch(updates: Partial<Secrets>): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			this.secretsCache[key as keyof Secrets] = value
			this.pendingSecrets.add(key as SecretKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Set method for workspace state keys - updates cache immediately and schedules debounced persistence
	 */
	setWorkspaceState<K extends keyof LocalState>(key: K, value: LocalState[K]): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.workspaceStateCache[key] = value

		// Add to pending persistence set and schedule debounced write
		this.pendingWorkspaceState.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for workspace state keys - updates cache immediately and schedules debounced persistence
	 */
	setWorkspaceStateBatch(updates: Partial<LocalState>): void {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}

		// Update cache immediately for all keys
		Object.entries(updates).forEach(([key, value]) => {
			this.workspaceStateCache[key as keyof LocalState] = value
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
			requestyBaseUrl,
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
			huaweiCloudMaasApiKey,
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
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,
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
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,
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
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,

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
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,

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
			requestyBaseUrl,
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
			huaweiCloudMaasApiKey,
		})
	}

	/**
	 * Get method for global state keys - reads from in-memory cache
	 */
	getGlobalStateKey<K extends keyof GlobalState>(key: K): GlobalState[K] {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}
		return this.globalStateCache[key]
	}

	/**
	 * Get method for secret keys - reads from in-memory cache
	 */
	getSecretKey<K extends keyof Secrets>(key: K): Secrets[K] {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}
		return this.secretsCache[key]
	}

	/**
	 * Get method for workspace state keys - reads from in-memory cache
	 */
	getWorkspaceStateKey<K extends keyof LocalState>(key: K): LocalState[K] {
		if (!this.isInitialized) {
			throw new Error(CACHE_SERVICE_NOT_INITIALIZED)
		}
		return this.workspaceStateCache[key]
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

		this.globalStateCache = {} as GlobalState
		this.secretsCache = {} as Secrets
		this.workspaceStateCache = {} as LocalState

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
					const value = this.globalStateCache[key]
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
					const value = this.secretsCache[key]
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
					const value = this.workspaceStateCache[key]
					return this.context.workspaceState.update(key, value)
				}),
			)
		} catch (error) {
			console.error("Failed to persist workspace state batch:", error)
			throw error
		}
	}

	/**
	 * Private method to populate cache with all extension state without triggering persistence
	 * Used during initialization
	 */
	private populateCache(state: any): void {
		// Extract API configuration fields
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
			requestyBaseUrl,
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
			huaweiCloudMaasApiKey,
			requestTimeoutMs,
			authNonce,
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
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,
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
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,
		} = state.apiConfiguration || {}

		// Directly populate global state cache without triggering persistence
		const globalStateFields = {
			// Extension state fields
			strictPlanModeEnabled: state.strictPlanModeEnabled,
			isNewUser: state.isNewUser,
			welcomeViewCompleted: state.welcomeViewCompleted,
			autoApprovalSettings: state.autoApprovalSettings || DEFAULT_AUTO_APPROVAL_SETTINGS,
			globalClineRulesToggles: state.globalClineRulesToggles,
			browserSettings: state.browserSettings,
			focusChainSettings: state.focusChainSettings || DEFAULT_FOCUS_CHAIN_SETTINGS,
			focusChainFeatureFlagEnabled: state.focusChainFeatureFlagEnabled,
			preferredLanguage: state.preferredLanguage,
			openaiReasoningEffort: state.openaiReasoningEffort,
			mode: state.mode,
			userInfo: state.userInfo,
			mcpMarketplaceEnabled: state.mcpMarketplaceEnabled,
			mcpDisplayMode: state.mcpDisplayMode,
			mcpResponsesCollapsed: state.mcpResponsesCollapsed,
			telemetrySetting: state.telemetrySetting,
			planActSeparateModelsSetting: state.planActSeparateModelsSetting,
			enableCheckpointsSetting: state.enableCheckpointsSetting,
			shellIntegrationTimeout: state.shellIntegrationTimeout,
			terminalReuseEnabled: state.terminalReuseEnabled,
			terminalOutputLineLimit: state.terminalOutputLineLimit,
			defaultTerminalProfile: state.defaultTerminalProfile,
			globalWorkflowToggles: state.globalWorkflowToggles,
			taskHistory: state.taskHistory,
			lastShownAnnouncementId: state.lastShownAnnouncementId,
			mcpMarketplaceCatalog: state.mcpMarketplaceCatalog,

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
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,

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
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,

			// API configuration global state updates
			awsRegion,
			awsUseCrossRegionInference,
			awsBedrockUsePromptCache,
			awsBedrockEndpoint,
			awsProfile,
			awsUseProfile,
			awsAuthentication,
			awsBedrockApiKey,
			vertexProjectId,
			vertexRegion,
			requestyBaseUrl,
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
		} satisfies GlobalState

		// Populate global state cache directly
		Object.assign(this.globalStateCache, globalStateFields)

		// Directly populate secrets cache without triggering persistence
		const secretsFields = {
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
			authNonce,
			huggingFaceApiKey,
			huaweiCloudMaasApiKey,
		} satisfies Secrets

		// Populate secrets cache directly
		Object.assign(this.secretsCache, secretsFields)

		// Populate workspace state cache directly
		const workspaceStateFields = {
			localClineRulesToggles: state.localClineRulesToggles,
			localWindsurfRulesToggles: state.localWindsurfRulesToggles,
			localCursorRulesToggles: state.localCursorRulesToggles,
			workflowToggles: state.localWorkflowToggles, // Note: key name is "workflowToggles" in LocalStateKey
		}

		Object.assign(this.workspaceStateCache, workspaceStateFields)
	}

	/**
	 * Construct API configuration from cached component keys
	 */
	private constructApiConfigurationFromCache(): ApiConfiguration {
		return {
			// Secrets
			apiKey: this.secretsCache["apiKey"],
			openRouterApiKey: this.secretsCache["openRouterApiKey"],
			clineAccountId: this.secretsCache["clineAccountId"],
			awsAccessKey: this.secretsCache["awsAccessKey"],
			awsSecretKey: this.secretsCache["awsSecretKey"],
			awsSessionToken: this.secretsCache["awsSessionToken"],
			awsBedrockApiKey: this.secretsCache["awsBedrockApiKey"],
			openAiApiKey: this.secretsCache["openAiApiKey"],
			ollamaApiKey: this.secretsCache["ollamaApiKey"],
			geminiApiKey: this.secretsCache["geminiApiKey"],
			openAiNativeApiKey: this.secretsCache["openAiNativeApiKey"],
			deepSeekApiKey: this.secretsCache["deepSeekApiKey"],
			requestyApiKey: this.secretsCache["requestyApiKey"],
			togetherApiKey: this.secretsCache["togetherApiKey"],
			qwenApiKey: this.secretsCache["qwenApiKey"],
			doubaoApiKey: this.secretsCache["doubaoApiKey"],
			mistralApiKey: this.secretsCache["mistralApiKey"],
			liteLlmApiKey: this.secretsCache["liteLlmApiKey"],
			fireworksApiKey: this.secretsCache["fireworksApiKey"],
			asksageApiKey: this.secretsCache["asksageApiKey"],
			xaiApiKey: this.secretsCache["xaiApiKey"],
			sambanovaApiKey: this.secretsCache["sambanovaApiKey"],
			cerebrasApiKey: this.secretsCache["cerebrasApiKey"],
			groqApiKey: this.secretsCache["groqApiKey"],
			basetenApiKey: this.secretsCache["basetenApiKey"],
			moonshotApiKey: this.secretsCache["moonshotApiKey"],
			nebiusApiKey: this.secretsCache["nebiusApiKey"],
			sapAiCoreClientId: this.secretsCache["sapAiCoreClientId"],
			sapAiCoreClientSecret: this.secretsCache["sapAiCoreClientSecret"],
			huggingFaceApiKey: this.secretsCache["huggingFaceApiKey"],
			huaweiCloudMaasApiKey: this.secretsCache["huaweiCloudMaasApiKey"],

			// Global state
			awsRegion: this.globalStateCache["awsRegion"],
			awsUseCrossRegionInference: this.globalStateCache["awsUseCrossRegionInference"],
			awsBedrockUsePromptCache: this.globalStateCache["awsBedrockUsePromptCache"],
			awsBedrockEndpoint: this.globalStateCache["awsBedrockEndpoint"],
			awsProfile: this.globalStateCache["awsProfile"],
			awsUseProfile: this.globalStateCache["awsUseProfile"],
			awsAuthentication: this.globalStateCache["awsAuthentication"],
			vertexProjectId: this.globalStateCache["vertexProjectId"],
			vertexRegion: this.globalStateCache["vertexRegion"],
			requestyBaseUrl: this.globalStateCache["requestyBaseUrl"],
			openAiBaseUrl: this.globalStateCache["openAiBaseUrl"],
			openAiHeaders: this.globalStateCache["openAiHeaders"] || {},
			ollamaBaseUrl: this.globalStateCache["ollamaBaseUrl"],
			ollamaApiOptionsCtxNum: this.globalStateCache["ollamaApiOptionsCtxNum"],
			lmStudioBaseUrl: this.globalStateCache["lmStudioBaseUrl"],
			anthropicBaseUrl: this.globalStateCache["anthropicBaseUrl"],
			geminiBaseUrl: this.globalStateCache["geminiBaseUrl"],
			azureApiVersion: this.globalStateCache["azureApiVersion"],
			openRouterProviderSorting: this.globalStateCache["openRouterProviderSorting"],
			liteLlmBaseUrl: this.globalStateCache["liteLlmBaseUrl"],
			liteLlmUsePromptCache: this.globalStateCache["liteLlmUsePromptCache"],
			qwenApiLine: this.globalStateCache["qwenApiLine"],
			moonshotApiLine: this.globalStateCache["moonshotApiLine"],
			asksageApiUrl: this.globalStateCache["asksageApiUrl"],
			favoritedModelIds: this.globalStateCache["favoritedModelIds"],
			requestTimeoutMs: this.globalStateCache["requestTimeoutMs"],
			fireworksModelMaxCompletionTokens: this.globalStateCache["fireworksModelMaxCompletionTokens"],
			fireworksModelMaxTokens: this.globalStateCache["fireworksModelMaxTokens"],
			sapAiCoreBaseUrl: this.globalStateCache["sapAiCoreBaseUrl"],
			sapAiCoreTokenUrl: this.globalStateCache["sapAiCoreTokenUrl"],
			sapAiResourceGroup: this.globalStateCache["sapAiResourceGroup"],
			claudeCodePath: this.globalStateCache["claudeCodePath"],

			// Plan mode configurations
			planModeApiProvider: this.globalStateCache["planModeApiProvider"],
			planModeApiModelId: this.globalStateCache["planModeApiModelId"],
			planModeThinkingBudgetTokens: this.globalStateCache["planModeThinkingBudgetTokens"],
			planModeReasoningEffort: this.globalStateCache["planModeReasoningEffort"],
			planModeVsCodeLmModelSelector: this.globalStateCache["planModeVsCodeLmModelSelector"],
			planModeAwsBedrockCustomSelected: this.globalStateCache["planModeAwsBedrockCustomSelected"],
			planModeAwsBedrockCustomModelBaseId: this.globalStateCache["planModeAwsBedrockCustomModelBaseId"],
			planModeOpenRouterModelId: this.globalStateCache["planModeOpenRouterModelId"],
			planModeOpenRouterModelInfo: this.globalStateCache["planModeOpenRouterModelInfo"],
			planModeOpenAiModelId: this.globalStateCache["planModeOpenAiModelId"],
			planModeOpenAiModelInfo: this.globalStateCache["planModeOpenAiModelInfo"],
			planModeOllamaModelId: this.globalStateCache["planModeOllamaModelId"],
			planModeLmStudioModelId: this.globalStateCache["planModeLmStudioModelId"],
			planModeLiteLlmModelId: this.globalStateCache["planModeLiteLlmModelId"],
			planModeLiteLlmModelInfo: this.globalStateCache["planModeLiteLlmModelInfo"],
			planModeRequestyModelId: this.globalStateCache["planModeRequestyModelId"],
			planModeRequestyModelInfo: this.globalStateCache["planModeRequestyModelInfo"],
			planModeTogetherModelId: this.globalStateCache["planModeTogetherModelId"],
			planModeFireworksModelId: this.globalStateCache["planModeFireworksModelId"],
			planModeSapAiCoreModelId: this.globalStateCache["planModeSapAiCoreModelId"],
			planModeGroqModelId: this.globalStateCache["planModeGroqModelId"],
			planModeGroqModelInfo: this.globalStateCache["planModeGroqModelInfo"],
			planModeBasetenModelId: this.globalStateCache["planModeBasetenModelId"],
			planModeBasetenModelInfo: this.globalStateCache["planModeBasetenModelInfo"],
			planModeHuggingFaceModelId: this.globalStateCache["planModeHuggingFaceModelId"],
			planModeHuggingFaceModelInfo: this.globalStateCache["planModeHuggingFaceModelInfo"],
			planModeHuaweiCloudMaasModelId: this.globalStateCache["planModeHuaweiCloudMaasModelId"],
			planModeHuaweiCloudMaasModelInfo: this.globalStateCache["planModeHuaweiCloudMaasModelInfo"],

			// Act mode configurations
			actModeApiProvider: this.globalStateCache["actModeApiProvider"],
			actModeApiModelId: this.globalStateCache["actModeApiModelId"],
			actModeThinkingBudgetTokens: this.globalStateCache["actModeThinkingBudgetTokens"],
			actModeReasoningEffort: this.globalStateCache["actModeReasoningEffort"],
			actModeVsCodeLmModelSelector: this.globalStateCache["actModeVsCodeLmModelSelector"],
			actModeAwsBedrockCustomSelected: this.globalStateCache["actModeAwsBedrockCustomSelected"],
			actModeAwsBedrockCustomModelBaseId: this.globalStateCache["actModeAwsBedrockCustomModelBaseId"],
			actModeOpenRouterModelId: this.globalStateCache["actModeOpenRouterModelId"],
			actModeOpenRouterModelInfo: this.globalStateCache["actModeOpenRouterModelInfo"],
			actModeOpenAiModelId: this.globalStateCache["actModeOpenAiModelId"],
			actModeOpenAiModelInfo: this.globalStateCache["actModeOpenAiModelInfo"],
			actModeOllamaModelId: this.globalStateCache["actModeOllamaModelId"],
			actModeLmStudioModelId: this.globalStateCache["actModeLmStudioModelId"],
			actModeLiteLlmModelId: this.globalStateCache["actModeLiteLlmModelId"],
			actModeLiteLlmModelInfo: this.globalStateCache["actModeLiteLlmModelInfo"],
			actModeRequestyModelId: this.globalStateCache["actModeRequestyModelId"],
			actModeRequestyModelInfo: this.globalStateCache["actModeRequestyModelInfo"],
			actModeTogetherModelId: this.globalStateCache["actModeTogetherModelId"],
			actModeFireworksModelId: this.globalStateCache["actModeFireworksModelId"],
			actModeSapAiCoreModelId: this.globalStateCache["actModeSapAiCoreModelId"],
			actModeGroqModelId: this.globalStateCache["actModeGroqModelId"],
			actModeGroqModelInfo: this.globalStateCache["actModeGroqModelInfo"],
			actModeBasetenModelId: this.globalStateCache["actModeBasetenModelId"],
			actModeBasetenModelInfo: this.globalStateCache["actModeBasetenModelInfo"],
			actModeHuggingFaceModelId: this.globalStateCache["actModeHuggingFaceModelId"],
			actModeHuggingFaceModelInfo: this.globalStateCache["actModeHuggingFaceModelInfo"],
			actModeHuaweiCloudMaasModelId: this.globalStateCache["actModeHuaweiCloudMaasModelId"],
			actModeHuaweiCloudMaasModelInfo: this.globalStateCache["actModeHuaweiCloudMaasModelInfo"],
		}
	}
}
