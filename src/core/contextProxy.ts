import * as vscode from "vscode"
import { logger } from "../utils/logging"

/**
 * A proxy class for vscode.ExtensionContext that buffers state changes
 * and only commits them when explicitly requested or during disposal.
 */
export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext
	private pendingStateChanges: Map<string, any>
	private pendingSecretChanges: Map<string, string | undefined>
	private disposed: boolean

	constructor(context: vscode.ExtensionContext) {
		this.originalContext = context
		this.pendingStateChanges = new Map()
		this.pendingSecretChanges = new Map()
		this.disposed = false
		logger.debug("ContextProxy created")
	}

	// Read-only pass-through properties
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

	// State management methods
	async getGlobalState<T>(key: string): Promise<T | undefined>
	async getGlobalState<T>(key: string, defaultValue: T): Promise<T>
	async getGlobalState<T>(key: string, defaultValue?: T): Promise<T | undefined> {
		// Check pending changes first
		if (this.pendingStateChanges.has(key)) {
			const value = this.pendingStateChanges.get(key) as T | undefined
			return value !== undefined ? value : (defaultValue as T | undefined)
		}
		// Fall back to original context
		return this.originalContext.globalState.get<T>(key, defaultValue as T)
	}

	async updateGlobalState<T>(key: string, value: T): Promise<void> {
		if (this.disposed) {
			throw new Error("Cannot update state on disposed context")
		}
		logger.debug(`ContextProxy: buffering state update for key "${key}"`)
		this.pendingStateChanges.set(key, value)
	}

	// Secret storage methods
	async getSecret(key: string): Promise<string | undefined> {
		// Check pending changes first
		if (this.pendingSecretChanges.has(key)) {
			return this.pendingSecretChanges.get(key)
		}
		// Fall back to original context
		return this.originalContext.secrets.get(key)
	}

	async storeSecret(key: string, value?: string): Promise<void> {
		if (this.disposed) {
			throw new Error("Cannot store secret on disposed context")
		}
		logger.debug(`ContextProxy: buffering secret update for key "${key}"`)
		this.pendingSecretChanges.set(key, value)
	}

	// Save pending changes to actual context
	async saveChanges(): Promise<void> {
		if (this.disposed) {
			throw new Error("Cannot save changes on disposed context")
		}

		// Apply state changes
		if (this.pendingStateChanges.size > 0) {
			logger.debug(`ContextProxy: applying ${this.pendingStateChanges.size} buffered state changes`)
			for (const [key, value] of this.pendingStateChanges.entries()) {
				await this.originalContext.globalState.update(key, value)
			}
			this.pendingStateChanges.clear()
		}

		// Apply secret changes
		if (this.pendingSecretChanges.size > 0) {
			logger.debug(`ContextProxy: applying ${this.pendingSecretChanges.size} buffered secret changes`)
			for (const [key, value] of this.pendingSecretChanges.entries()) {
				if (value === undefined) {
					await this.originalContext.secrets.delete(key)
				} else {
					await this.originalContext.secrets.store(key, value)
				}
			}
			this.pendingSecretChanges.clear()
		}
	}

	// Called when the provider is disposing
	async dispose(): Promise<void> {
		if (!this.disposed) {
			logger.debug("ContextProxy: disposing and saving pending changes")
			await this.saveChanges()
			this.disposed = true
		}
	}

	// Method to check if there are pending changes
	hasPendingChanges(): boolean {
		return this.pendingStateChanges.size > 0 || this.pendingSecretChanges.size > 0
	}
}
