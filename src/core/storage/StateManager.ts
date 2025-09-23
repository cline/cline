import { ApiConfiguration } from "@shared/api"
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
import {
	GlobalState,
	GlobalStateAndSettings,
	GlobalStateAndSettingsKey,
	GlobalStateKey,
	LocalState,
	LocalStateKey,
	SecretKey,
	Secrets,
	Settings,
	SettingsKey,
} from "./state-keys"
import {
	categorizeApiConfigurationKeys,
	getApiConfigurationSecretKeys,
	getApiConfigurationSettingsKeys,
} from "./utils/api-configuration-helpers"
import { readGlobalStateFromDisk, readSecretsFromDisk, readWorkspaceStateFromDisk } from "./utils/state-helpers"
export interface PersistenceErrorEvent {
	error: Error
}

/**
 * In-memory state manager for fast state access
 * Provides immediate reads/writes with async disk persistence
 */
export class StateManager {
	private globalStateCache: GlobalStateAndSettings = {} as GlobalStateAndSettings
	private taskStateCache: Partial<Settings> = {}
	private secretsCache: Secrets = {} as Secrets
	private workspaceStateCache: LocalState = {} as LocalState
	private context: ExtensionContext
	private isInitialized = false

	// Debounced persistence state
	private pendingGlobalState = new Set<GlobalStateAndSettingsKey>()
	private pendingTaskState = new Set<SettingsKey>()
	private pendingSecrets = new Set<SecretKey>()
	private pendingWorkspaceState = new Set<LocalStateKey>()
	private persistenceTimeout: NodeJS.Timeout | null = null
	private readonly PERSISTENCE_DELAY_MS = 500
	private taskHistoryWatcher: FSWatcher | null = null

	// Callback for persistence errors
	onPersistenceError?: (event: PersistenceErrorEvent) => void

	// Callback to sync external state changes with the UI client
	onSyncExternalChange?: () => void | Promise<void>

	constructor(context: ExtensionContext) {
		this.context = context
	}

	/**
	 * Initialize the cache by loading data from disk
	 */
	async initialize(): Promise<void> {
		try {
			// Load all extension state from disk
			const globalState = await readGlobalStateFromDisk(this.context)
			const secrets = await readSecretsFromDisk(this.context)
			const workspaceState = await readWorkspaceStateFromDisk(this.context)

			// Populate the cache with all extension state and secrets fields
			// Use populate method to avoid triggering persistence during initialization
			this.populateCache(globalState, secrets, workspaceState)

			this.isInitialized = true

			// Start watcher for taskHistory.json so external edits update cache (no persist loop)
			await this.setupTaskHistoryWatcher()
		} catch (error) {
			console.error("[StateManager] Failed to initialize:", error)
			throw error
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
		this.pendingTaskState.add(key)
		this.scheduleDebouncedPersistence(taskId)
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
		Object.keys(updates).forEach((key) => {
			this.pendingTaskState.add(key as SettingsKey)
		})

		// Schedule debounced persistence
		this.scheduleDebouncedPersistence(taskId)
	}

	/**
	 * Load task settings from disk into cache
	 */
	async loadTaskSettings(taskId: string): Promise<void> {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		try {
			const taskSettings = await readTaskSettingsFromStorage(this.context, taskId)
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
	async clearTaskSettings(taskId?: string): Promise<void> {
		// If there are pending task settings, persist them first
		if (this.pendingTaskState.size > 0 && taskId) {
			try {
				// Persist pending task state immediately
				await this.persistTaskStateBatch(this.pendingTaskState, taskId)
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
	 * Initialize chokidar watcher for the taskHistory.json file
	 * Updates in-memory cache on external changes without writing back to disk.
	 */
	private async setupTaskHistoryWatcher(): Promise<void> {
		try {
			const historyFile = await getTaskHistoryStateFilePath(this.context)

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
					const onDisk = await readTaskHistoryFromState(this.context)
					const cached = this.globalStateCache["taskHistory"]
					if (JSON.stringify(onDisk) !== JSON.stringify(cached)) {
						// Use type assertion to bypass readonly constraint for internal state management
						;(this.globalStateCache as any)["taskHistory"] = onDisk
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
					// Use type assertion to bypass readonly constraint for internal state management
					;(this.globalStateCache as any)["taskHistory"] = []
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
	 * Automatically categorizes keys based on STATE_DEFINITION and SecretKeys
	 */
	setApiConfiguration(apiConfiguration: Partial<ApiConfiguration>): void {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
		}

		// Automatically categorize the API configuration keys
		const { settingsUpdates, secretsUpdates } = categorizeApiConfigurationKeys(apiConfiguration)

		// Batch update settings (stored in global state)
		if (Object.keys(settingsUpdates).length > 0) {
			this.setGlobalStateBatch(settingsUpdates)
		}

		// Batch update secrets
		if (Object.keys(secretsUpdates).length > 0) {
			this.setSecretsBatch(secretsUpdates)
		}
	}

	/**
	 * Get method for global settings keys - reads from in-memory cache
	 */
	getGlobalSettingsKey<K extends keyof Settings>(key: K): Settings[K] {
		if (!this.isInitialized) {
			throw new Error(STATE_MANAGER_NOT_INITIALIZED)
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
		await this.initialize()

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

		this.isInitialized = false
	}

	/**
	 * Schedule debounced persistence - simple timeout-based persistence
	 */
	private scheduleDebouncedPersistence(taskId?: string): void {
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
					this.persistTaskStateBatch(this.pendingTaskState, taskId),
				])

				// Clear pending sets on successful persistence
				this.pendingGlobalState.clear()
				this.pendingSecrets.clear()
				this.pendingWorkspaceState.clear()
				this.pendingTaskState.clear()
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
						return writeTaskHistoryToState(this.context, this.globalStateCache[key])
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
	 * Private method to batch persist task state keys with Promise.all
	 */
	private async persistTaskStateBatch(keys: Set<SettingsKey>, taskId: string | undefined): Promise<void> {
		if (!taskId) {
			return
		}
		try {
			await Promise.all(
				Array.from(keys).map((key) => {
					return writeTaskSettingsToStorage(this.context, taskId, { [key]: this.taskStateCache[key] })
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
	 * Helper to get a setting value with task-specific override support
	 * Returns task cache value if available, otherwise falls back to global cache
	 */
	private getSettingWithOverride<K extends keyof Settings>(key: K): Settings[K] {
		return this.taskStateCache[key] !== undefined ? this.taskStateCache[key] : this.globalStateCache[key]
	}

	/**
	 * Helper to get a secret value
	 */
	private getSecret<K extends keyof Secrets>(key: K): Secrets[K] {
		return this.secretsCache[key]
	}

	/**
	 * Construct API configuration from cached component keys
	 * Uses helper functions to automatically get keys from STATE_DEFINITION
	 */
	private constructApiConfigurationFromCache(): ApiConfiguration {
		// Get keys dynamically from STATE_DEFINITION and SecretKeys
		const settingsKeys = getApiConfigurationSettingsKeys()
		const secretKeys = getApiConfigurationSecretKeys()

		// Build configuration object
		const config: any = {}

		// Add all secrets
		for (const key of secretKeys) {
			config[key] = this.getSecret(key)
		}

		// Add all settings with task override support
		for (const key of settingsKeys) {
			config[key] = this.getSettingWithOverride(key)
		}

		// Add special case for openAiHeaders with default empty object
		config.openAiHeaders = this.getSettingWithOverride("openAiHeaders") || {}

		return config satisfies ApiConfiguration
	}
}
