import * as vscode from "vscode"

import { logger } from "../utils/logging"
import {
	GLOBAL_STATE_KEYS,
	SECRET_KEYS,
	GlobalStateKey,
	SecretKey,
	ConfigurationKey,
	ConfigurationValues,
	isSecretKey,
	isGlobalStateKey,
} from "../shared/globalState"

export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext

	private stateCache: Map<GlobalStateKey, any>
	private secretCache: Map<SecretKey, string | undefined>
	private _isInitialized = false

	constructor(context: vscode.ExtensionContext) {
		this.originalContext = context
		this.stateCache = new Map()
		this.secretCache = new Map()
		this._isInitialized = false
	}

	public get isInitialized() {
		return this._isInitialized
	}

	public async initialize() {
		for (const key of GLOBAL_STATE_KEYS) {
			try {
				this.stateCache.set(key, this.originalContext.globalState.get(key))
			} catch (error) {
				logger.error(`Error loading global ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		const promises = SECRET_KEYS.map(async (key) => {
			try {
				this.secretCache.set(key, await this.originalContext.secrets.get(key))
			} catch (error) {
				logger.error(`Error loading secret ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		})

		await Promise.all(promises)

		this._isInitialized = true
	}

	get extensionUri() {
		return this.originalContext.extensionUri
	}

	get extensionPath() {
		return this.originalContext.extensionPath
	}

	get globalStorageUri() {
		return this.originalContext.globalStorageUri
	}

	get logUri() {
		return this.originalContext.logUri
	}

	get extension() {
		return this.originalContext.extension
	}

	get extensionMode() {
		return this.originalContext.extensionMode
	}

	getGlobalState<T>(key: GlobalStateKey): T | undefined
	getGlobalState<T>(key: GlobalStateKey, defaultValue: T): T
	getGlobalState<T>(key: GlobalStateKey, defaultValue?: T): T | undefined {
		const value = this.stateCache.get(key) as T | undefined
		return value !== undefined ? value : (defaultValue as T | undefined)
	}

	updateGlobalState<T>(key: GlobalStateKey, value: T) {
		this.stateCache.set(key, value)
		return this.originalContext.globalState.update(key, value)
	}

	getSecret(key: SecretKey) {
		return this.secretCache.get(key)
	}

	storeSecret(key: SecretKey, value?: string) {
		// Update cache.
		this.secretCache.set(key, value)

		// Write directly to context.
		return value === undefined
			? this.originalContext.secrets.delete(key)
			: this.originalContext.secrets.store(key, value)
	}
	/**
	 * Set a value in either secrets or global state based on key type.
	 * If the key is in SECRET_KEYS, it will be stored as a secret.
	 * If the key is in GLOBAL_STATE_KEYS or unknown, it will be stored in global state.
	 * @param key The key to set
	 * @param value The value to set
	 * @returns A promise that resolves when the operation completes
	 */
	setValue(key: ConfigurationKey, value: any) {
		if (isSecretKey(key)) {
			return this.storeSecret(key, value)
		} else if (isGlobalStateKey(key)) {
			return this.updateGlobalState(key, value)
		} else {
			logger.warn(`Unknown key: ${key}. Storing as global state.`)
			return this.updateGlobalState(key, value)
		}
	}

	/**
	 * Set multiple values at once. Each key will be routed to either
	 * secrets or global state based on its type.
	 * @param values An object containing key-value pairs to set
	 * @returns A promise that resolves when all operations complete
	 */
	async setValues(values: Partial<ConfigurationValues>) {
		const promises: Thenable<void>[] = []

		for (const [key, value] of Object.entries(values)) {
			promises.push(this.setValue(key as ConfigurationKey, value))
		}

		await Promise.all(promises)
	}

	/**
	 * Resets all global state, secrets, and in-memory caches.
	 * This clears all data from both the in-memory caches and the VSCode storage.
	 * @returns A promise that resolves when all reset operations are complete
	 */
	async resetAllState() {
		// Clear in-memory caches
		this.stateCache.clear()
		this.secretCache.clear()

		// Reset all global state values to undefined.
		const stateResetPromises = GLOBAL_STATE_KEYS.map((key) =>
			this.originalContext.globalState.update(key, undefined),
		)

		// Delete all secrets.
		const secretResetPromises = SECRET_KEYS.map((key) => this.originalContext.secrets.delete(key))

		// Wait for all reset operations to complete.
		await Promise.all([...stateResetPromises, ...secretResetPromises])

		this.initialize()
	}
}
