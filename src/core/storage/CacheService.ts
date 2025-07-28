import * as vscode from "vscode"
import { ApiConfiguration } from "@shared/api"
import {
	updateGlobalState,
	getGlobalState,
	updateApiConfiguration as updateApiConfigurationToDisk,
	getAllExtensionState,
} from "./state"

/**
 * In-memory cache service for fast state access
 * Provides immediate reads/writes with async disk persistence
 */
export class CacheService {
	private cache: Map<string, any> = new Map()
	private context: vscode.ExtensionContext
	private isInitialized = false

	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	/**
	 * Initialize the cache by loading data from disk
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		try {
			// For now, only load API configuration
			// In the future, we'll load all state here
			const { apiConfiguration } = await getAllExtensionState(this.context)
			if (apiConfiguration) {
				this.cache.set("apiConfiguration", apiConfiguration)
			}

			this.isInitialized = true
			console.log("CacheService initialized successfully")
		} catch (error) {
			console.error("Failed to initialize CacheService:", error)
			// Don't throw - we can still function without cache
			this.isInitialized = true
		}
	}

	/**
	 * Generic get method - reads from in-memory cache
	 */
	get<T>(key: string): T | undefined {
		return this.cache.get(key) as T | undefined
	}

	/**
	 * Generic set method - updates cache immediately and persists to disk async
	 */
	async set<T>(key: string, value: T): Promise<void> {
		// Update cache immediately for instant access
		this.cache.set(key, value)

		// Persist to disk asynchronously (don't await to avoid blocking)
		this.persistToState(key, value).catch((error) => {
			console.error(`Failed to persist ${key} to disk:`, error)
			// TODO: Could implement retry logic or error recovery here
		})
	}

	/**
	 * Convenience method for getting API configuration
	 * Ensures cache is initialized if not already done
	 */
	async getApiConfiguration(): Promise<ApiConfiguration> {
		// Auto-initialize if not ready
		if (!this.isInitialized) {
			await this.initialize()
		}
		// getAllExtensionState always returns apiConfiguration, so this should always be defined
		return this.get<ApiConfiguration>("apiConfiguration")!
	}

	/**
	 * Convenience method for setting API configuration
	 */
	async setApiConfiguration(config: ApiConfiguration): Promise<void> {
		// Update cache immediately
		this.cache.set("apiConfiguration", config)

		// Persist to disk asynchronously using the existing updateApiConfiguration function
		this.persistApiConfiguration(config).catch((error) => {
			console.error("Failed to persist API configuration to disk:", error)
			// TODO: Could implement retry logic or error recovery here
		})
	}

	/**
	 * Check if the cache has been initialized
	 */
	isReady(): boolean {
		return this.isInitialized
	}

	/**
	 * Clear all cached data (for testing or reset purposes)
	 */
	clear(): void {
		this.cache.clear()
	}

	/**
	 * Dispose of the cache service
	 */
	dispose(): void {
		this.cache.clear()
		this.isInitialized = false
	}

	/**
	 * Private method to persist data to VSCode state
	 */
	private async persistToState(key: string, value: any): Promise<void> {
		try {
			// For now, we only handle apiConfiguration
			// In the future, we'll add more specific handlers
			if (key === "apiConfiguration") {
				await updateApiConfigurationToDisk(this.context, value)
			} else {
				// Generic fallback for other keys
				await updateGlobalState(this.context, key as any, value)
			}
		} catch (error) {
			console.error(`Failed to persist ${key}:`, error)
			throw error
		}
	}

	/**
	 * Private method specifically for persisting API configuration
	 */
	private async persistApiConfiguration(config: ApiConfiguration): Promise<void> {
		try {
			await updateApiConfigurationToDisk(this.context, config)
		} catch (error) {
			console.error("Failed to persist API configuration:", error)
			throw error
		}
	}
}
