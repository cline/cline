import { ApiConfiguration, ModelInfo } from "@shared/api"
import {
	GlobalState,
	GlobalStateAndSettings,
	GlobalStateAndSettingsKey,
	GlobalStateKey,
	LocalState,
	LocalStateKey,
	RemoteConfigFields,
	SecretKey,
	Secrets,
	Settings,
	SettingsKey,
} from "@shared/storage/state-keys"
import chokidar, { FSWatcher } from "chokidar"
import type { ExtensionContext } from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import {
	getTaskHistoryStateFilePath,
	readTaskHistoryFromState,
	readTaskSettingsFromStorage,
	writeTaskHistoryToState,
	writeTaskSettingsToStorage,
} from "./disk"
import { STATE_MANAGER_NOT_INITIALIZED } from "./error-messages"
import { readGlobalStateFromDisk, readSecretsFromDisk, readWorkspaceStateFromDisk } from "./utils/state-helpers"
export interface PersistenceErrorEvent {
	error: Error
}

/**
 * In-memory state manager for fast state access
 * Provides immediate reads/writes with async disk persistence
 */
export class StateManager {
	private static instance: StateManager | null = null

	private globalStateCache: GlobalStateAndSettings = {} as GlobalStateAndSettings
	private taskStateCache: Partial<Settings> = {}
	private remoteConfigCache: Partial<RemoteConfigFields> = {} as RemoteConfigFields
	private secretsCache: Secrets = {} as Secrets
	private workspaceStateCache: LocalState = {} as LocalState
	private context: ExtensionContext
	private isInitialized = false

	// In-memory model info cache (not persisted to disk)
	// These are for dynamic providers that fetch models from APIs
	private modelInfoCache: {
		openRouterModels: Record<string, ModelInfo> | null
		groqModels: Record<string, ModelInfo> | null
		basetenModels: Record<string, ModelInfo> | null
		huggingFaceModels: Record<string, ModelInfo> | null
		requestyModels: Record<string, ModelInfo> | null
		huaweiCloudMaasModels: Record<string, ModelInfo> | null
		hicapModels: Record<string, ModelInfo> | null
		aihubmixModels: Record<string, ModelInfo> | null
		liteLlmModels: Record<string, ModelInfo> | null
	} = {
		openRouterModels: null,
		groqModels: null,
		basetenModels: null,
		huggingFaceModels: null,
		requestyModels: null,
		huaweiCloudMaasModels: null,
		hicapModels: null,
		aihubmixModels: null,
		liteLlmModels: null,
	}

	// Debounced persistence state
	private pendingGlobalState = new Set<GlobalStateAndSettingsKey>()
	private pendingTaskState = new Map<string, Set<SettingsKey>>()
	private pendingSecrets = new Set<SecretKey>()
	private pendingWorkspaceState = new Set<LocalStateKey>()
	private persistenceTimeout: NodeJS.Timeout | null = null
	private readonly PERSISTENCE_DELAY_MS = 500
	private taskHistoryWatcher: FSWatcher | null = null

	// Callback for persistence errors
	onPersistenceError?: (event: PersistenceErrorEvent) => void

	// Callback to sync external state changes with the UI client
	onSyncExternalChange?: () => void | Promise<void>

	private constructor(context: ExtensionContext) {
		this.context = context
	}

	/**
	 * Initialize the cache by loading data from disk
	 */
	public static async initialize(context: ExtensionContext): Promise<StateManager> {
		if (!StateManager.instance) {
			StateManager.instance = new StateManager(context)
		}

		if (StateManager.instance.isInitialized) {
			throw new Error("StateManager has already been initialized.")
		}

		try {
			// Load all extension state from disk
			const globalState = await readGlobalStateFromDisk(StateManager.instance.context)
			const secrets = await readSecretsFromDisk(StateManager.instance.context)
			const workspaceState = await readWorkspaceStateFromDisk(StateManager.instance.context)

			// Populate the cache with all extension state and secrets fields
			// Use populate method to avoid triggering persistence during initialization
			StateManager.instance.populateCache(globalState, secrets, workspaceState)

			// Start watcher for taskHistory.json so external edits update cache (no persist loop)
			await StateManager.instance.setupTaskHistoryWatcher()

			StateManager.instance.isInitialized = true
		} catch (error) {
			console.error("[StateManager] Failed to initialize:", error)
			throw error
		}

		return StateManager.instance
	}

	public static get(): StateManager {
		if (!StateManager.instance) {
			throw new Error("StateManager has not been initialized")
		}
		return StateManager.instance
	}

	/**
	 * Register callbacks for state manager events
	 */
	public registerCallbacks(callbacks: {
		onPersistenceError?: (event: PersistenceErrorEvent) => void | Promise<void>
		onSyncExternalChange?: () => void | Promise<void>
	}): void {
		if (callbacks.onPersistenceError) {
			this.onPersistenceError = callbacks.onPersistenceError
		}
		if (callbacks.onSyncExternalChange) {
			this.onSyncExternalChange = callbacks.onSyncExternalChange
		}
	}

	/**
	 * Set method for global state keys - updates cache immediately and schedules debounced persistence
	 */
	setGlobalState<K extends keyof GlobalStateAndSettings>(key: K, value: GlobalStateAndSettings[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
	setGlobalStateBatch(updates: Partial<GlobalStateAndSettings>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
	 * Set method for task settings keys - updates cache immediately and schedules debounced persistence
	 */
	setTaskSettings<K extends keyof Settings>(taskId: string, key: K, value: Settings[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access
		this.taskStateCache[key] = value

		// Add to pending persistence set and schedule debounced write
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		this.pendingTaskState.get(taskId)!.add(key)
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Batch set method for task settings keys - updates cache immediately and schedules debounced persistence
	 */
	setTaskSettingsBatch(taskId: string, updates: Partial<Settings>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Update cache in one go
		Object.assign(this.taskStateCache, updates)

		// Then track the keys for persistence
		if (!this.pendingTaskState.has(taskId)) {
			this.pendingTaskState.set(taskId, new Set())
		}
		Object.keys(updates).forEach((key) => {
			this.pendingTaskState.get(taskId)!.add(key as SettingsKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	/**
	 * Load task settings from disk into cache
	 */
	async loadTaskSettings(taskId: string): Promise<void> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		try {
			const taskSettings = await readTaskSettingsFromStorage(taskId)
			// Populate task cache with loaded settings
			Object.assign(this.taskStateCache, taskSettings)
		} catch (error) {
			// If reading fails, just use empty cache

			console.error("[StateManager] Failed to load task settings:", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: `Failed to load task settings, defaulting to globally selected settings.`,
			})
		}
	}

	/**
	 * Clear task settings cache - ensures pending changes are persisted first
	 */
	async clearTaskSettings(): Promise<void> {
		// If there are pending task settings, persist them first
		if (this.pendingTaskState.size > 0) {
			try {
				// Persist pending task state immediately
				await this.persistTaskStateBatch(this.pendingTaskState)
				// Clear pending set after successful persistence
				this.pendingTaskState.clear()
			} catch (error) {
				console.error("[StateManager] Failed to persist task settings before clearing:", error)
				// If persistence fails, we just move on with clearing the in-memory state.
				// clearTaskSettings realistically probably won't be called in the small window of time between task settings being set and their persistence anyways
			}
		}

		this.taskStateCache = {}
		this.pendingTaskState.clear()
	}

	/**
	 * Set method for secret keys - updates cache immediately and schedules debounced persistence
	 */
	setSecret<K extends keyof Secrets>(key: K, value: Secrets[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
	 * Set method for remote config field - updates cache immediately (no persistence)
	 * Remote config is read-only from the extension's perspective and only stored in memory
	 */
	setRemoteConfigField<K extends keyof RemoteConfigFields>(key: K, value: RemoteConfigFields[K]): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Update cache immediately for instant access (no persistence needed)
		this.remoteConfigCache[key] = value
	}

	/**
	 * Get method for remote config settings - returns cache immediately (no persistence)
	 * Remote config is read-only from the extension's perspective and only stored in memory
	 */
	getRemoteConfigSettings(): Partial<RemoteConfigFields> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		return this.remoteConfigCache
	}

	/**
	 * Clear remote config cache
	 * Used when switching organizations or when remote config is no longer applicable
	 */
	clearRemoteConfig(): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		this.remoteConfigCache = {} as GlobalStateAndSettings
	}

	/**
	 * Set models cache for a specific provider (in-memory only, not persisted)
	 */
	setModelsCache(
		provider:
			| "openRouter"
			| "groq"
			| "baseten"
			| "huggingFace"
			| "requesty"
			| "huaweiCloudMaas"
			| "hicap"
			| "aihubmix"
			| "liteLlm",
		models: Record<string, ModelInfo>,
	): void {
		const cacheKey = `${provider}Models` as keyof typeof this.modelInfoCache
		this.modelInfoCache[cacheKey] = models
	}

	/**
	 * Get model info by provider and model ID (from in-memory cache)
	 */
	getModelInfo(
		provider:
			| "openRouter"
			| "groq"
			| "baseten"
			| "huggingFace"
			| "requesty"
			| "huaweiCloudMaas"
			| "hicap"
			| "aihubmix"
			| "liteLlm",
		modelId: string,
	): ModelInfo | undefined {
		const cacheKey = `${provider}Models` as keyof typeof this.modelInfoCache
		return this.modelInfoCache[cacheKey]?.[modelId]
	}

	/**
	 * Initialize chokidar watcher for the taskHistory.json file
	 * Updates in-memory cache on external changes without writing back to disk.
	 */
	private async setupTaskHistoryWatcher(): Promise<void> {
		try {
			const historyFile = await getTaskHistoryStateFilePath()

			// Close any existing watcher before creating a new one
			if (this.taskHistoryWatcher) {
				await this.taskHistoryWatcher.close()
				this.taskHistoryWatcher = null
			}

			this.taskHistoryWatcher = chokidar.watch(historyFile, {
				persistent: true,
				ignoreInitial: true,
				atomic: true,
				awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
			})

			const syncTaskHistoryFromDisk = async () => {
				try {
					if (!this.isInitialized) {
						return
					}
					const onDisk = await readTaskHistoryFromState()
					const cached = this.globalStateCache["taskHistory"]
					if (JSON.stringify(onDisk) !== JSON.stringify(cached)) {
						this.globalStateCache["taskHistory"] = onDisk
						await this.onSyncExternalChange?.()
					}
				} catch (err) {
					console.error("[StateManager] Failed to reload task history on change:", err)
				}
			}

			this.taskHistoryWatcher
				.on("add", () => syncTaskHistoryFromDisk())
				.on("change", () => syncTaskHistoryFromDisk())
				.on("unlink", async () => {
					this.globalStateCache["taskHistory"] = []
					await this.onSyncExternalChange?.()
				})
				.on("error", (error) => console.error("[StateManager] TaskHistory watcher error:", error))
		} catch (err) {
			console.error("[StateManager] Failed to set up taskHistory watcher:", err)
		}
	}

	/**
	 * Convenience method for getting API configuration
	 * Ensures cache is initialized if not already done
	 */
	getApiConfiguration(): ApiConfiguration {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Construct API configuration from cached component keys
		return this.constructApiConfigurationFromCache()
	}

	/**
	 * Convenience method for setting API configuration
	 */
	setApiConfiguration(apiConfiguration: ApiConfiguration): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		const {
			apiKey,
			openRouterApiKey,
			awsAccessKey,
			awsSecretKey,
			awsSessionToken,
			awsRegion,
			awsUseCrossRegionInference,
			awsUseGlobalInference,
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
			lmStudioMaxTokens,
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
			azureIdentity,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmApiKey,
			liteLlmUsePromptCache,
			qwenApiLine,
			moonshotApiLine,
			zaiApiLine,
			asksageApiKey,
			asksageApiUrl,
			xaiApiKey,
			clineAccountId,
			sambanovaApiKey,
			cerebrasApiKey,
			groqApiKey,
			moonshotApiKey,
			nebiusApiKey,
			fireworksApiKey,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			sapAiCoreClientId,
			sapAiCoreClientSecret,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			sapAiCoreUseOrchestrationMode,
			claudeCodePath,
			qwenCodeOauthPath,
			basetenApiKey,
			huggingFaceApiKey,
			huaweiCloudMaasApiKey,
			difyApiKey,
			difyBaseUrl,
			vercelAiGatewayApiKey,
			zaiApiKey,
			minimaxApiKey,
			minimaxApiLine,
			nousResearchApiKey,
			requestTimeoutMs,
			ocaBaseUrl,
			ocaMode,
			hicapApiKey,
			hicapModelId,
			aihubmixApiKey,
			aihubmixBaseUrl,
			aihubmixAppCode,
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
			planModeSapAiCoreDeploymentId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,
			planModeOcaModelId,
			planModeOcaModelInfo,
			planModeHicapModelId,
			planModeHicapModelInfo,
			planModeAihubmixModelId,
			planModeAihubmixModelInfo,
			planModeNousResearchModelId,
			geminiPlanModeThinkingLevel,
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
			actModeSapAiCoreDeploymentId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,
			actModeOcaModelId,
			actModeOcaModelInfo,
			actModeHicapModelId,
			actModeHicapModelInfo,
			actModeAihubmixModelId,
			actModeAihubmixModelInfo,
			actModeNousResearchModelId,
			geminiActModeThinkingLevel,
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
			planModeSapAiCoreDeploymentId,
			planModeGroqModelId,
			planModeGroqModelInfo,
			planModeBasetenModelId,
			planModeBasetenModelInfo,
			planModeHuggingFaceModelId,
			planModeHuggingFaceModelInfo,
			planModeHuaweiCloudMaasModelId,
			planModeHuaweiCloudMaasModelInfo,
			planModeOcaModelId,
			planModeOcaModelInfo,
			planModeHicapModelId,
			planModeHicapModelInfo,
			planModeAihubmixModelId,
			planModeAihubmixModelInfo,
			planModeNousResearchModelId,
			geminiPlanModeThinkingLevel,

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
			actModeSapAiCoreDeploymentId,
			actModeGroqModelId,
			actModeGroqModelInfo,
			actModeBasetenModelId,
			actModeBasetenModelInfo,
			actModeHuggingFaceModelId,
			actModeHuggingFaceModelInfo,
			actModeHuaweiCloudMaasModelId,
			actModeHuaweiCloudMaasModelInfo,
			actModeOcaModelId,
			actModeOcaModelInfo,
			actModeHicapModelId,
			actModeHicapModelInfo,
			actModeAihubmixModelId,
			actModeAihubmixModelInfo,
			actModeNousResearchModelId,
			geminiActModeThinkingLevel,

			// Global state updates
			awsRegion,
			awsUseCrossRegionInference,
			awsUseGlobalInference,
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
			lmStudioMaxTokens,
			anthropicBaseUrl,
			geminiBaseUrl,
			azureApiVersion,
			azureIdentity,
			openRouterProviderSorting,
			liteLlmBaseUrl,
			liteLlmUsePromptCache,
			qwenApiLine,
			moonshotApiLine,
			zaiApiLine,
			asksageApiUrl,
			requestTimeoutMs,
			fireworksModelMaxCompletionTokens,
			fireworksModelMaxTokens,
			sapAiCoreBaseUrl,
			sapAiCoreTokenUrl,
			sapAiResourceGroup,
			sapAiCoreUseOrchestrationMode,
			claudeCodePath,
			difyBaseUrl,
			qwenCodeOauthPath,
			ocaBaseUrl,
			minimaxApiLine,
			ocaMode,
			hicapModelId,
			aihubmixBaseUrl,
			aihubmixAppCode,
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
			difyApiKey,
			vercelAiGatewayApiKey,
			zaiApiKey,
			minimaxApiKey,
			hicapApiKey,
			aihubmixApiKey,
			nousResearchApiKey,
		})
	}

	/**
	 * Get method for global settings keys - reads from in-memory cache
	 * Precedence: remote config > task settings > global settings
	 */
	getGlobalSettingsKey<K extends keyof Settings>(key: K): Settings[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		if (this.remoteConfigCache[key] !== undefined) {
			// type casting here, TS cannot infer that the key will ONLY be one of Settings

			return this.remoteConfigCache[key] as Settings[K]
		}
		if (this.taskStateCache[key] !== undefined) {
			return this.taskStateCache[key]
		}
		return this.globalStateCache[key]
	}

	/**
	 * Get method for global state keys - reads from in-memory cache
	 */
	getGlobalStateKey<K extends keyof GlobalState>(key: K): GlobalState[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		if (this.remoteConfigCache[key] !== undefined) {
			// type casting here, TS cannot infer that the key will ONLY be one of GlobalState
			return this.remoteConfigCache[key] as GlobalState[K]
		}
		return this.globalStateCache[key]
	}

	/**
	 * Get method for secret keys - reads from in-memory cache
	 */
	getSecretKey<K extends keyof Secrets>(key: K): Secrets[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return this.secretsCache[key]
	}

	/**
	 * Get method for workspace state keys - reads from in-memory cache
	 */
	getWorkspaceStateKey<K extends keyof LocalState>(key: K): LocalState[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return this.workspaceStateCache[key]
	}

	/**
	 * Reinitialize the state manager by clearing all state and reloading from disk
	 * Used for error recovery when write operations fail
	 */
	async reInitialize(currentTaskId?: string): Promise<void> {
		// Clear all cached data and pending state
		this.dispose()

		// Reinitialize from disk
		await StateManager.initialize(this.context)

		// If there's an active task, reload its settings
		if (currentTaskId) {
			await this.loadTaskSettings(currentTaskId)
		}
	}

	/**
	 * Dispose of the state manager
	 */
	private dispose(): void {
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}
		// Close file watcher if active
		if (this.taskHistoryWatcher) {
			this.taskHistoryWatcher.close()
			this.taskHistoryWatcher = null
		}

		this.pendingGlobalState.clear()
		this.pendingSecrets.clear()
		this.pendingWorkspaceState.clear()
		this.pendingTaskState.clear()

		this.globalStateCache = {} as GlobalStateAndSettings
		this.secretsCache = {} as Secrets
		this.workspaceStateCache = {} as LocalState
		this.taskStateCache = {}
		this.remoteConfigCache = {} as GlobalStateAndSettings

		this.isInitialized = false
	}

	/**
	 * Private method to persist all pending state changes
	 * Returns early if nothing is pending
	 */
	private async persistPendingState(): Promise<void> {
		// Early return if nothing to persist
		if (
			this.pendingGlobalState.size === 0 &&
			this.pendingSecrets.size === 0 &&
			this.pendingWorkspaceState.size === 0 &&
			this.pendingTaskState.size === 0
		) {
			return
		}

		// Execute all persistence operations in parallel
		await Promise.all([
			this.persistGlobalStateBatch(this.pendingGlobalState),
			this.persistSecretsBatch(this.pendingSecrets),
			this.persistWorkspaceStateBatch(this.pendingWorkspaceState),
			this.persistTaskStateBatch(this.pendingTaskState),
		])

		// Clear pending sets after successful persistence
		this.pendingGlobalState.clear()
		this.pendingSecrets.clear()
		this.pendingWorkspaceState.clear()
		this.pendingTaskState.clear()
	}

	/**
	 * Flush all pending state changes immediately to disk
	 * Bypasses the debounced persistence and forces immediate writes
	 */
	public async flushPendingState(): Promise<void> {
		// Cancel any pending timeout
		if (this.persistenceTimeout) {
			clearTimeout(this.persistenceTimeout)
			this.persistenceTimeout = null
		}

		// Execute persistence immediately
		await this.persistPendingState()
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
				await this.persistPendingState()
				this.persistenceTimeout = null
			} catch (error) {
				console.error("[StateManager] Failed to persist pending changes:", error)
				this.persistenceTimeout = null

				// Call persistence error callback for error recovery
				this.onPersistenceError?.({ error: error })
			}
		}, this.PERSISTENCE_DELAY_MS)
	}

	/**
	 * Private method to batch persist global state keys with Promise.all
	 */
	private async persistGlobalStateBatch(keys: Set<GlobalStateAndSettingsKey>): Promise<void> {
		try {
			await Promise.all(
				Array.from(keys).map((key) => {
					if (key === "taskHistory") {
						// Route task history persistence to file, not VS Code globalState
						return writeTaskHistoryToState(this.globalStateCache[key])
					}
					return this.context.globalState.update(key, this.globalStateCache[key])
				}),
			)
		} catch (error) {
			console.error("[StateManager] Failed to persist global state batch:", error)
			throw error
		}
	}

	/**
	 * Private method to batch persist task state keys with a single write operation
	 */
	private async persistTaskStateBatch(pendingTaskStates: Map<string, Set<SettingsKey>>): Promise<void> {
		if (pendingTaskStates.size === 0) {
			return
		}
		try {
			// Persist each task's settings
			await Promise.all(
				Array.from(pendingTaskStates.entries()).map(([taskId, keys]) => {
					if (keys.size === 0) {
						return Promise.resolve()
					}
					const settingsToWrite: Record<string, any> = {}
					for (const key of keys) {
						const value = this.taskStateCache[key]
						if (value !== undefined) {
							settingsToWrite[key] = value
						}
					}
					return writeTaskSettingsToStorage(taskId, settingsToWrite)
				}),
			)
		} catch (error) {
			console.error("[StateManager] Failed to persist task settings batch:", error)
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
	private populateCache(globalState: GlobalState, secrets: Secrets, workspaceState: LocalState): void {
		Object.assign(this.globalStateCache, globalState)
		Object.assign(this.secretsCache, secrets)
		Object.assign(this.workspaceStateCache, workspaceState)
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
			liteLlmApiKey: this.secretsCache["remoteLiteLlmApiKey"] || this.secretsCache["liteLlmApiKey"],
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
			difyApiKey: this.secretsCache["difyApiKey"],
			vercelAiGatewayApiKey: this.secretsCache["vercelAiGatewayApiKey"],
			zaiApiKey: this.secretsCache["zaiApiKey"],
			minimaxApiKey: this.secretsCache["minimaxApiKey"],
			hicapApiKey: this.secretsCache["hicapApiKey"],
			aihubmixApiKey: this.secretsCache["aihubmixApiKey"],

			// Global state (with remote config precedence for applicable fields)
			awsRegion:
				this.remoteConfigCache["awsRegion"] || this.taskStateCache["awsRegion"] || this.globalStateCache["awsRegion"],
			awsUseCrossRegionInference:
				this.remoteConfigCache["awsUseCrossRegionInference"] ||
				this.taskStateCache["awsUseCrossRegionInference"] ||
				this.globalStateCache["awsUseCrossRegionInference"],
			awsUseGlobalInference:
				this.remoteConfigCache["awsUseGlobalInference"] ||
				this.taskStateCache["awsUseGlobalInference"] ||
				this.globalStateCache["awsUseGlobalInference"],
			awsBedrockUsePromptCache:
				this.remoteConfigCache["awsBedrockUsePromptCache"] ||
				this.taskStateCache["awsBedrockUsePromptCache"] ||
				this.globalStateCache["awsBedrockUsePromptCache"],
			awsBedrockEndpoint:
				this.remoteConfigCache["awsBedrockEndpoint"] ||
				this.taskStateCache["awsBedrockEndpoint"] ||
				this.globalStateCache["awsBedrockEndpoint"],
			awsProfile: this.taskStateCache["awsProfile"] || this.globalStateCache["awsProfile"],
			awsUseProfile: this.taskStateCache["awsUseProfile"] || this.globalStateCache["awsUseProfile"],
			awsAuthentication: this.taskStateCache["awsAuthentication"] || this.globalStateCache["awsAuthentication"],
			vertexProjectId:
				this.remoteConfigCache["vertexProjectId"] ||
				this.taskStateCache["vertexProjectId"] ||
				this.globalStateCache["vertexProjectId"],
			vertexRegion:
				this.remoteConfigCache["vertexRegion"] ||
				this.taskStateCache["vertexRegion"] ||
				this.globalStateCache["vertexRegion"],
			requestyBaseUrl: this.taskStateCache["requestyBaseUrl"] || this.globalStateCache["requestyBaseUrl"],
			openAiBaseUrl:
				this.remoteConfigCache["openAiBaseUrl"] ||
				this.taskStateCache["openAiBaseUrl"] ||
				this.globalStateCache["openAiBaseUrl"],
			openAiHeaders:
				this.remoteConfigCache["openAiHeaders"] ||
				this.taskStateCache["openAiHeaders"] ||
				this.globalStateCache["openAiHeaders"] ||
				{},
			ollamaBaseUrl: this.taskStateCache["ollamaBaseUrl"] || this.globalStateCache["ollamaBaseUrl"],
			ollamaApiOptionsCtxNum:
				this.taskStateCache["ollamaApiOptionsCtxNum"] || this.globalStateCache["ollamaApiOptionsCtxNum"],
			lmStudioBaseUrl: this.taskStateCache["lmStudioBaseUrl"] || this.globalStateCache["lmStudioBaseUrl"],
			lmStudioMaxTokens: this.taskStateCache["lmStudioMaxTokens"] || this.globalStateCache["lmStudioMaxTokens"],
			anthropicBaseUrl: this.taskStateCache["anthropicBaseUrl"] || this.globalStateCache["anthropicBaseUrl"],
			geminiBaseUrl: this.taskStateCache["geminiBaseUrl"] || this.globalStateCache["geminiBaseUrl"],
			azureApiVersion:
				this.remoteConfigCache["azureApiVersion"] ||
				this.taskStateCache["azureApiVersion"] ||
				this.globalStateCache["azureApiVersion"],
			azureIdentity:
				this.remoteConfigCache["azureIdentity"] ||
				this.taskStateCache["azureIdentity"] ||
				this.globalStateCache["azureIdentity"],
			openRouterProviderSorting:
				this.taskStateCache["openRouterProviderSorting"] || this.globalStateCache["openRouterProviderSorting"],
			liteLlmBaseUrl:
				this.remoteConfigCache["liteLlmBaseUrl"] ||
				this.taskStateCache["liteLlmBaseUrl"] ||
				this.globalStateCache["liteLlmBaseUrl"],
			liteLlmUsePromptCache: this.taskStateCache["liteLlmUsePromptCache"] || this.globalStateCache["liteLlmUsePromptCache"],
			qwenApiLine: this.taskStateCache["qwenApiLine"] || this.globalStateCache["qwenApiLine"],
			moonshotApiLine: this.taskStateCache["moonshotApiLine"] || this.globalStateCache["moonshotApiLine"],
			zaiApiLine: this.taskStateCache["zaiApiLine"] || this.globalStateCache["zaiApiLine"],
			asksageApiUrl: this.taskStateCache["asksageApiUrl"] || this.globalStateCache["asksageApiUrl"],
			requestTimeoutMs: this.taskStateCache["requestTimeoutMs"] || this.globalStateCache["requestTimeoutMs"],
			fireworksModelMaxCompletionTokens:
				this.taskStateCache["fireworksModelMaxCompletionTokens"] ||
				this.globalStateCache["fireworksModelMaxCompletionTokens"],
			fireworksModelMaxTokens:
				this.taskStateCache["fireworksModelMaxTokens"] || this.globalStateCache["fireworksModelMaxTokens"],
			sapAiCoreBaseUrl: this.taskStateCache["sapAiCoreBaseUrl"] || this.globalStateCache["sapAiCoreBaseUrl"],
			sapAiCoreTokenUrl: this.taskStateCache["sapAiCoreTokenUrl"] || this.globalStateCache["sapAiCoreTokenUrl"],
			sapAiResourceGroup: this.taskStateCache["sapAiResourceGroup"] || this.globalStateCache["sapAiResourceGroup"],
			sapAiCoreUseOrchestrationMode:
				this.taskStateCache["sapAiCoreUseOrchestrationMode"] || this.globalStateCache["sapAiCoreUseOrchestrationMode"],
			claudeCodePath: this.taskStateCache["claudeCodePath"] || this.globalStateCache["claudeCodePath"],
			qwenCodeOauthPath: this.taskStateCache["qwenCodeOauthPath"] || this.globalStateCache["qwenCodeOauthPath"],
			difyBaseUrl: this.taskStateCache["difyBaseUrl"] || this.globalStateCache["difyBaseUrl"],
			ocaBaseUrl: this.globalStateCache["ocaBaseUrl"],
			minimaxApiLine: this.taskStateCache["minimaxApiLine"] || this.globalStateCache["minimaxApiLine"],
			ocaMode: this.globalStateCache["ocaMode"],
			hicapModelId: this.globalStateCache["hicapModelId"],
			aihubmixBaseUrl: this.taskStateCache["aihubmixBaseUrl"] || this.globalStateCache["aihubmixBaseUrl"],
			aihubmixAppCode: this.taskStateCache["aihubmixAppCode"] || this.globalStateCache["aihubmixAppCode"],

			// Plan mode configurations
			planModeApiProvider:
				this.remoteConfigCache["planModeApiProvider"] ||
				this.taskStateCache["planModeApiProvider"] ||
				this.globalStateCache["planModeApiProvider"],
			planModeApiModelId: this.taskStateCache["planModeApiModelId"] || this.globalStateCache["planModeApiModelId"],
			planModeThinkingBudgetTokens:
				this.taskStateCache["planModeThinkingBudgetTokens"] || this.globalStateCache["planModeThinkingBudgetTokens"],
			planModeReasoningEffort:
				this.taskStateCache["planModeReasoningEffort"] || this.globalStateCache["planModeReasoningEffort"],
			planModeVsCodeLmModelSelector:
				this.taskStateCache["planModeVsCodeLmModelSelector"] || this.globalStateCache["planModeVsCodeLmModelSelector"],
			planModeAwsBedrockCustomSelected:
				this.taskStateCache["planModeAwsBedrockCustomSelected"] ||
				this.globalStateCache["planModeAwsBedrockCustomSelected"],
			planModeAwsBedrockCustomModelBaseId:
				this.taskStateCache["planModeAwsBedrockCustomModelBaseId"] ||
				this.globalStateCache["planModeAwsBedrockCustomModelBaseId"],
			planModeOpenRouterModelId:
				this.taskStateCache["planModeOpenRouterModelId"] || this.globalStateCache["planModeOpenRouterModelId"],
			planModeOpenRouterModelInfo:
				this.taskStateCache["planModeOpenRouterModelInfo"] || this.globalStateCache["planModeOpenRouterModelInfo"],
			planModeOpenAiModelId: this.taskStateCache["planModeOpenAiModelId"] || this.globalStateCache["planModeOpenAiModelId"],
			planModeOpenAiModelInfo:
				this.taskStateCache["planModeOpenAiModelInfo"] || this.globalStateCache["planModeOpenAiModelInfo"],
			planModeOllamaModelId: this.taskStateCache["planModeOllamaModelId"] || this.globalStateCache["planModeOllamaModelId"],
			planModeLmStudioModelId:
				this.taskStateCache["planModeLmStudioModelId"] || this.globalStateCache["planModeLmStudioModelId"],
			planModeLiteLlmModelId:
				this.taskStateCache["planModeLiteLlmModelId"] || this.globalStateCache["planModeLiteLlmModelId"],
			planModeLiteLlmModelInfo:
				this.taskStateCache["planModeLiteLlmModelInfo"] || this.globalStateCache["planModeLiteLlmModelInfo"],
			planModeRequestyModelId:
				this.taskStateCache["planModeRequestyModelId"] || this.globalStateCache["planModeRequestyModelId"],
			planModeRequestyModelInfo:
				this.taskStateCache["planModeRequestyModelInfo"] || this.globalStateCache["planModeRequestyModelInfo"],
			planModeTogetherModelId:
				this.taskStateCache["planModeTogetherModelId"] || this.globalStateCache["planModeTogetherModelId"],
			planModeFireworksModelId:
				this.taskStateCache["planModeFireworksModelId"] || this.globalStateCache["planModeFireworksModelId"],
			planModeSapAiCoreModelId:
				this.taskStateCache["planModeSapAiCoreModelId"] || this.globalStateCache["planModeSapAiCoreModelId"],
			planModeSapAiCoreDeploymentId:
				this.taskStateCache["planModeSapAiCoreDeploymentId"] || this.globalStateCache["planModeSapAiCoreDeploymentId"],
			planModeGroqModelId: this.taskStateCache["planModeGroqModelId"] || this.globalStateCache["planModeGroqModelId"],
			planModeGroqModelInfo: this.taskStateCache["planModeGroqModelInfo"] || this.globalStateCache["planModeGroqModelInfo"],
			planModeBasetenModelId:
				this.taskStateCache["planModeBasetenModelId"] || this.globalStateCache["planModeBasetenModelId"],
			planModeBasetenModelInfo:
				this.taskStateCache["planModeBasetenModelInfo"] || this.globalStateCache["planModeBasetenModelInfo"],
			planModeHuggingFaceModelId:
				this.taskStateCache["planModeHuggingFaceModelId"] || this.globalStateCache["planModeHuggingFaceModelId"],
			planModeHuggingFaceModelInfo:
				this.taskStateCache["planModeHuggingFaceModelInfo"] || this.globalStateCache["planModeHuggingFaceModelInfo"],
			planModeHuaweiCloudMaasModelId:
				this.taskStateCache["planModeHuaweiCloudMaasModelId"] || this.globalStateCache["planModeHuaweiCloudMaasModelId"],
			planModeHuaweiCloudMaasModelInfo:
				this.taskStateCache["planModeHuaweiCloudMaasModelInfo"] ||
				this.globalStateCache["planModeHuaweiCloudMaasModelInfo"],
			planModeOcaModelId: this.globalStateCache["planModeOcaModelId"],
			planModeOcaModelInfo: this.globalStateCache["planModeOcaModelInfo"],
			planModeHicapModelId: this.taskStateCache["planModeHicapModelId"] || this.globalStateCache["planModeHicapModelId"],
			planModeHicapModelInfo:
				this.taskStateCache["planModeHicapModelInfo"] || this.globalStateCache["planModeHicapModelInfo"],
			planModeAihubmixModelId:
				this.taskStateCache["planModeAihubmixModelId"] || this.globalStateCache["planModeAihubmixModelId"],
			planModeAihubmixModelInfo:
				this.taskStateCache["planModeAihubmixModelInfo"] || this.globalStateCache["planModeAihubmixModelInfo"],
			planModeNousResearchModelId:
				this.taskStateCache["planModeNousResearchModelId"] || this.globalStateCache["planModeNousResearchModelId"],
			geminiPlanModeThinkingLevel:
				this.taskStateCache["geminiPlanModeThinkingLevel"] || this.globalStateCache["geminiPlanModeThinkingLevel"],

			// Act mode configurations
			actModeApiProvider:
				this.remoteConfigCache["actModeApiProvider"] ||
				this.taskStateCache["actModeApiProvider"] ||
				this.globalStateCache["actModeApiProvider"],
			actModeApiModelId: this.taskStateCache["actModeApiModelId"] || this.globalStateCache["actModeApiModelId"],
			actModeThinkingBudgetTokens:
				this.taskStateCache["actModeThinkingBudgetTokens"] || this.globalStateCache["actModeThinkingBudgetTokens"],
			actModeReasoningEffort:
				this.taskStateCache["actModeReasoningEffort"] || this.globalStateCache["actModeReasoningEffort"],
			actModeVsCodeLmModelSelector:
				this.taskStateCache["actModeVsCodeLmModelSelector"] || this.globalStateCache["actModeVsCodeLmModelSelector"],
			actModeAwsBedrockCustomSelected:
				this.taskStateCache["actModeAwsBedrockCustomSelected"] ||
				this.globalStateCache["actModeAwsBedrockCustomSelected"],
			actModeAwsBedrockCustomModelBaseId:
				this.taskStateCache["actModeAwsBedrockCustomModelBaseId"] ||
				this.globalStateCache["actModeAwsBedrockCustomModelBaseId"],
			actModeOpenRouterModelId:
				this.taskStateCache["actModeOpenRouterModelId"] || this.globalStateCache["actModeOpenRouterModelId"],
			actModeOpenRouterModelInfo:
				this.taskStateCache["actModeOpenRouterModelInfo"] || this.globalStateCache["actModeOpenRouterModelInfo"],
			actModeOpenAiModelId: this.taskStateCache["actModeOpenAiModelId"] || this.globalStateCache["actModeOpenAiModelId"],
			actModeOpenAiModelInfo:
				this.taskStateCache["actModeOpenAiModelInfo"] || this.globalStateCache["actModeOpenAiModelInfo"],
			actModeOllamaModelId: this.taskStateCache["actModeOllamaModelId"] || this.globalStateCache["actModeOllamaModelId"],
			actModeLmStudioModelId:
				this.taskStateCache["actModeLmStudioModelId"] || this.globalStateCache["actModeLmStudioModelId"],
			actModeLiteLlmModelId: this.taskStateCache["actModeLiteLlmModelId"] || this.globalStateCache["actModeLiteLlmModelId"],
			actModeLiteLlmModelInfo:
				this.taskStateCache["actModeLiteLlmModelInfo"] || this.globalStateCache["actModeLiteLlmModelInfo"],
			actModeRequestyModelId:
				this.taskStateCache["actModeRequestyModelId"] || this.globalStateCache["actModeRequestyModelId"],
			actModeRequestyModelInfo:
				this.taskStateCache["actModeRequestyModelInfo"] || this.globalStateCache["actModeRequestyModelInfo"],
			actModeTogetherModelId:
				this.taskStateCache["actModeTogetherModelId"] || this.globalStateCache["actModeTogetherModelId"],
			actModeFireworksModelId:
				this.taskStateCache["actModeFireworksModelId"] || this.globalStateCache["actModeFireworksModelId"],
			actModeSapAiCoreModelId:
				this.taskStateCache["actModeSapAiCoreModelId"] || this.globalStateCache["actModeSapAiCoreModelId"],
			actModeSapAiCoreDeploymentId:
				this.taskStateCache["actModeSapAiCoreDeploymentId"] || this.globalStateCache["actModeSapAiCoreDeploymentId"],
			actModeGroqModelId: this.taskStateCache["actModeGroqModelId"] || this.globalStateCache["actModeGroqModelId"],
			actModeGroqModelInfo: this.taskStateCache["actModeGroqModelInfo"] || this.globalStateCache["actModeGroqModelInfo"],
			actModeBasetenModelId: this.taskStateCache["actModeBasetenModelId"] || this.globalStateCache["actModeBasetenModelId"],
			actModeBasetenModelInfo:
				this.taskStateCache["actModeBasetenModelInfo"] || this.globalStateCache["actModeBasetenModelInfo"],
			actModeHuggingFaceModelId:
				this.taskStateCache["actModeHuggingFaceModelId"] || this.globalStateCache["actModeHuggingFaceModelId"],
			actModeHuggingFaceModelInfo:
				this.taskStateCache["actModeHuggingFaceModelInfo"] || this.globalStateCache["actModeHuggingFaceModelInfo"],
			actModeHuaweiCloudMaasModelId:
				this.taskStateCache["actModeHuaweiCloudMaasModelId"] || this.globalStateCache["actModeHuaweiCloudMaasModelId"],
			actModeHuaweiCloudMaasModelInfo:
				this.taskStateCache["actModeHuaweiCloudMaasModelInfo"] ||
				this.globalStateCache["actModeHuaweiCloudMaasModelInfo"],
			actModeOcaModelId: this.globalStateCache["actModeOcaModelId"],
			actModeOcaModelInfo: this.globalStateCache["actModeOcaModelInfo"],
			actModeHicapModelId: this.globalStateCache["actModeHicapModelId"],
			actModeHicapModelInfo: this.globalStateCache["actModeHicapModelInfo"],
			actModeAihubmixModelId:
				this.taskStateCache["actModeAihubmixModelId"] || this.globalStateCache["actModeAihubmixModelId"],
			actModeAihubmixModelInfo:
				this.taskStateCache["actModeAihubmixModelInfo"] || this.globalStateCache["actModeAihubmixModelInfo"],
			actModeNousResearchModelId:
				this.taskStateCache["actModeNousResearchModelId"] || this.globalStateCache["actModeNousResearchModelId"],
			geminiActModeThinkingLevel:
				this.taskStateCache["geminiActModeThinkingLevel"] || this.globalStateCache["geminiActModeThinkingLevel"],
			nousResearchApiKey: this.secretsCache["nousResearchApiKey"],
		}
	}
}
