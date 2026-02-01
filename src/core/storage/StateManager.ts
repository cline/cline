import { ApiConfiguration, ModelInfo } from "@shared/api"
import {
	ApiHandlerSettingsKeys,
	GlobalState,
	GlobalStateAndSettings,
	GlobalStateAndSettingsKey,
	isSecretKey,
	isSettingsKey,
	LocalState,
	LocalStateKey,
	RemoteConfigFields,
	SecretKey,
	SecretKeys,
	Secrets,
	Settings,
	SettingsKey,
} from "@shared/storage/state-keys"
import chokidar, { FSWatcher } from "chokidar"
import type { ExtensionContext } from "vscode"
import { Logger } from "@/shared/services/Logger"
import { secretStorage } from "@/shared/storage/ClineSecretStorage"
import {
	getTaskHistoryStateFilePath,
	readTaskHistoryFromState,
	readTaskSettingsFromStorage,
	writeTaskHistoryToState,
	writeTaskSettingsToStorage,
} from "./disk"
import { STATE_MANAGER_NOT_INITIALIZED } from "./error-messages"
import { filterAllowedRemoteConfigFields } from "./remote-config/utils"
import { readGlobalStateFromDisk, readSecretsFromDisk, readWorkspaceStateFromDisk } from "./utils/state-helpers"
export interface PersistenceErrorEvent {
	error: Error
}

/**
 * In-memory state manager for fast state access.
 * Provides immediate reads/writes with async disk persistence.
 *
 * MULTI-INSTANCE BEHAVIOR:
 * StateManager reads from disk ONLY during initialize(). After that, all reads come from
 * the in-memory cache. Writes update both the cache and disk, but other running instances
 * won't see those changes because they don't re-read from disk.
 *
 * This means: If you have multiple VS Code windows open, each has its own StateManager
 * instance with its own cache. Changing a setting (like plan/act mode) in Window A writes
 * to disk, but Window B keeps using its cached value. Window B only sees the change after
 * restart (when it re-initializes from disk).
 *
 * This is intentional for performance (avoids constant disk reads) and provides natural
 * isolation between concurrent instances. Task-specific state is independent anyway since
 * each window typically runs different tasks.
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
		secretStorage.init(context.secrets)
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
			const globalState = await readGlobalStateFromDisk(context)
			const secrets = await readSecretsFromDisk()
			const workspaceState = await readWorkspaceStateFromDisk(context)

			// Populate the cache with all extension state and secrets fields
			// Use populate method to avoid triggering persistence during initialization
			StateManager.instance.populateCache(globalState, secrets, workspaceState)

			// Start watcher for taskHistory.json so external edits update cache (no persist loop)
			await StateManager.instance.setupTaskHistoryWatcher()

			StateManager.instance.isInitialized = true
		} catch (error) {
			Logger.error("[StateManager] Failed to initialize:", error)
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
			this.pendingGlobalState.add(key as GlobalStateAndSettingsKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence()
	}

	private setRemoteConfigState(updates: Partial<GlobalStateAndSettings>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Update cache in one go
		this.remoteConfigCache = {
			...this.remoteConfigCache,
			...filterAllowedRemoteConfigFields(updates),
		}
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
			Logger.error("[StateManager] Failed to load task settings, defaulting to globally selected settings.", error)
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
				Logger.error("[StateManager] Failed to persist task settings before clearing:", error)
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
			// Skip unchanged values as we don't want to trigger unnecessary
			// writes & incorrectly fire an onDidChange events.
			const current = this.secretsCache[key as keyof Secrets]
			if (current === value) {
				return
			}
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
					Logger.error("[StateManager] Failed to reload task history on change:", err)
				}
			}

			this.taskHistoryWatcher
				.on("add", () => syncTaskHistoryFromDisk())
				.on("change", () => syncTaskHistoryFromDisk())
				.on("unlink", async () => {
					this.globalStateCache["taskHistory"] = []
					await this.onSyncExternalChange?.()
				})
				.on("error", (error) => Logger.error("[StateManager] TaskHistory watcher error:", error))
		} catch (err) {
			Logger.error("[StateManager] Failed to set up taskHistory watcher:", err)
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
	 * Automatically categorizes keys based on STATE_DEFINITION and SecretKeys
	 */
	setApiConfiguration(apiConfiguration: ApiConfiguration): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Automatically categorize the API configuration keys
		const { settingsUpdates, secretsUpdates } = Object.entries(apiConfiguration).reduce(
			(acc, [key, value]) => {
				if (key === undefined || value === undefined) {
					return acc // Skip undefined values
				}

				if (isSecretKey(key)) {
					// This is a secret key
					acc.secretsUpdates[key as keyof Secrets] = value as any
				} else if (isSettingsKey(key)) {
					// This is a settings key
					acc.settingsUpdates[key as keyof Settings] = value as any
				}

				return acc
			},
			{ settingsUpdates: {} as Partial<Settings>, secretsUpdates: {} as Partial<Secrets> },
		)

		// Batch update settings (stored in global state)
		if (Object.keys(settingsUpdates).length > 0) {
			this.setRemoteConfigState(settingsUpdates)
			this.setGlobalStateBatch(settingsUpdates)
		}

		// Batch update secrets
		if (Object.keys(secretsUpdates).length > 0) {
			this.setSecretsBatch(secretsUpdates)
		}
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
				Logger.error("[StateManager] Failed to persist pending changes:", error)
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
	 * Helper to get a setting value with override support
	 * Precedence: remote config > task settings > global settings
	 */
	private getSettingWithOverride<K extends keyof Settings>(key: K): Settings[K] {
		const remoteValue = this.remoteConfigCache[key]
		if (remoteValue !== undefined) {
			return remoteValue
		}
		const taskValue = this.taskStateCache[key]
		if (taskValue !== undefined) {
			return taskValue
		}
		return this.globalStateCache[key]
	}

	/**
	 * Helper to get a secret value
	 */
	private getSecret<K extends keyof Secrets>(key: K): Secrets[K] {
		return this.secretsCache[key]
	}

	/**
	 * Construct API configuration from cached component keys
	 */
	private constructApiConfigurationFromCache(): ApiConfiguration {
		// Build secrets object
		const secrets = Object.fromEntries(SecretKeys.map((key) => [key, this.getSecret(key)])) as Secrets

		// Preserve legacy fallback behavior for LiteLLM API key:
		// if a remoteLiteLlmApiKey is set (via remote config), it should
		// take precedence over the local liteLlmApiKey.
		const remoteLiteLlmApiKey = this.secretsCache["remoteLiteLlmApiKey"]
		if (remoteLiteLlmApiKey !== undefined && remoteLiteLlmApiKey !== null && remoteLiteLlmApiKey !== "") {
			secrets.liteLlmApiKey = remoteLiteLlmApiKey
		}

		// Build API handler settings object with task override support
		const settings = Object.fromEntries(ApiHandlerSettingsKeys.map((key) => [key, this.getSettingWithOverride(key)]))

		return { ...secrets, ...settings } satisfies ApiConfiguration
	}

	/**
	 * Get all global state entries (for debugging/inspection)
	 */
	public getAllGlobalStateEntries(): Record<string, unknown> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return { ...this.globalStateCache }
	}

	/**
	 * Get all workspace state entries (for debugging/inspection)
	 */
	public getAllWorkspaceStateEntries(): Record<string, unknown> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}
		return { ...this.workspaceStateCache }
	}
}
