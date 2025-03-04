import * as vscode from "vscode"
import { logger } from "../utils/logging"
import { GLOBAL_STATE_KEYS, SECRET_KEYS } from "../shared/globalState"

export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext
	private stateCache: Map<string, any>
	private secretCache: Map<string, string | undefined>

	constructor(context: vscode.ExtensionContext) {
		// Initialize properties first
		this.originalContext = context
		this.stateCache = new Map()
		this.secretCache = new Map()

		// Initialize state cache with all defined global state keys
		this.initializeStateCache()

		// Initialize secret cache with all defined secret keys
		this.initializeSecretCache()

		logger.debug("ContextProxy created")
	}

	// Helper method to initialize state cache
	private initializeStateCache(): void {
		for (const key of GLOBAL_STATE_KEYS) {
			try {
				const value = this.originalContext.globalState.get(key)
				this.stateCache.set(key, value)
			} catch (error) {
				logger.error(`Error loading global ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
	}

	// Helper method to initialize secret cache
	private initializeSecretCache(): void {
		for (const key of SECRET_KEYS) {
			// Get actual value and update cache when promise resolves
			;(this.originalContext.secrets.get(key) as Promise<string | undefined>)
				.then((value) => {
					this.secretCache.set(key, value)
				})
				.catch((error: Error) => {
					logger.error(`Error loading secret ${key}: ${error.message}`)
				})
		}
	}

	get extensionUri(): vscode.Uri {
		return this.originalContext.extensionUri
	}
	get extensionPath(): string {
		return this.originalContext.extensionPath
	}
	get globalStorageUri(): vscode.Uri {
		return this.originalContext.globalStorageUri
	}
	get logUri(): vscode.Uri {
		return this.originalContext.logUri
	}
	get extension(): vscode.Extension<any> | undefined {
		return this.originalContext.extension
	}
	get extensionMode(): vscode.ExtensionMode {
		return this.originalContext.extensionMode
	}

	getGlobalState<T>(key: string): T | undefined
	getGlobalState<T>(key: string, defaultValue: T): T
	getGlobalState<T>(key: string, defaultValue?: T): T | undefined {
		const value = this.stateCache.get(key) as T | undefined
		return value !== undefined ? value : (defaultValue as T | undefined)
	}

	updateGlobalState<T>(key: string, value: T): Thenable<void> {
		this.stateCache.set(key, value)
		return this.originalContext.globalState.update(key, value)
	}

	getSecret(key: string): string | undefined {
		return this.secretCache.get(key)
	}

	storeSecret(key: string, value?: string): Thenable<void> {
		// Update cache
		this.secretCache.set(key, value)
		// Write directly to context
		if (value === undefined) {
			return this.originalContext.secrets.delete(key)
		} else {
			return this.originalContext.secrets.store(key, value)
		}
	}
}
