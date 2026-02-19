import { Logger } from "../services/Logger"

export interface ClineStorageChangeEvent {
	readonly key: string
}

export type StorageEventListener = (event: ClineStorageChangeEvent) => Promise<void>

// ============================================================================
// Interfaces for VSCode compatibility (removes vscode import dependency)
// ============================================================================

/**
 * Memento-compatible interface for sync key-value storage.
 * VSCode's Memento and ClineSyncStorage both satisfy this interface.
 */
export interface ClineMemento {
	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	update(key: string, value: any): Thenable<void>
	keys(): readonly string[]
	/**
	 * Set multiple keys in a single operation.
	 * More efficient than calling update() for each key individually.
	 */
	setBatch(entries: Record<string, any>): Thenable<void>
}

/**
 * An abstract storage class that provides a template for storage operations.
 * Subclasses must implement the protected abstract methods to define their storage logic.
 * The public methods (get, store, delete) are final and cannot be overridden.
 */
export abstract class ClineStorage {
	/**
	 * The name of the storage, used for logging purposes.
	 */
	protected name = "ClineStorage"
	/**
	 * List of subscribers to storage change events.
	 */
	private readonly subscribers: Array<StorageEventListener> = []

	/**
	 * Subscribe to storage change events.
	 */
	public onDidChange(callback: StorageEventListener): () => void {
		this.subscribers.push(callback)
		return () => {
			const callbackIndex = this.subscribers.indexOf(callback)
			if (callbackIndex >= 0) {
				this.subscribers.splice(callbackIndex, 1)
			}
		}
	}

	/**
	 * Get a value from storage. This method is final and cannot be overridden.
	 * Subclasses should implement _get() to define their storage retrieval logic.
	 */
	public async get(key: string): Promise<string | undefined> {
		try {
			return await this._get(key)
		} catch {
			return undefined
		}
	}

	async _dangerousStore(key: string, value: string): Promise<void> {
		await this._store(key, value)
	}

	/**
	 * Store a value in storage. This method is final and cannot be overridden.
	 * Subclasses should implement _store() to define their storage logic.
	 * This method automatically fires change events after storing.
	 */
	public async store(key: string, value: string): Promise<void> {
		try {
			await this._dangerousStore(key, value)
		} catch (error) {
			Logger.error(`[${this.name}] failed to store '${key}':`, error)
		}
	}

	/**
	 * Delete a value from storage. This method is final and cannot be overridden.
	 * Subclasses should implement _delete() to define their deletion logic.
	 * This method automatically fires change events after deletion.
	 */
	public async delete(key: string): Promise<void> {
		try {
			await this._delete(key)
		} catch {
			// Silently fail on delete errors
		}
	}

	/**
	 * Abstract method that subclasses must implement to retrieve values from their storage.
	 */
	protected abstract _get(key: string): Promise<string | undefined>

	/**
	 * Abstract method that subclasses must implement to store values in their storage.
	 */
	protected abstract _store(key: string, value: string): Promise<void>

	/**
	 * Abstract method that subclasses must implement to delete values from their storage.
	 */
	protected abstract _delete(key: string): Promise<void>
}

// ============================================================================
// Sync Storage - for environments requiring synchronous access (e.g., CLI)
// ============================================================================

/**
 * Abstract base class for synchronous JSON storage.
 * Unlike ClineStorage (string key-value, async), this stores any JSON-serializable
 * values and provides synchronous access - required for VSCode Memento compatibility.
 */

export type SyncStorageEventListener = (event: ClineStorageChangeEvent) => void

export abstract class ClineSyncStorage<T = any> {
	protected abstract name: string

	/**
	 * List of subscribers to storage change events.
	 */
	private readonly changeSubscribers: Array<SyncStorageEventListener> = []

	/**
	 * Subscribe to storage change events. Returns an unsubscribe function.
	 */
	public onDidChange(callback: SyncStorageEventListener): () => void {
		this.changeSubscribers.push(callback)
		return () => {
			const idx = this.changeSubscribers.indexOf(callback)
			if (idx >= 0) {
				this.changeSubscribers.splice(idx, 1)
			}
		}
	}

	/**
	 * Notify all subscribers of a key change.
	 */
	protected fireChange(key: string): void {
		for (const subscriber of this.changeSubscribers) {
			try {
				subscriber({ key })
			} catch (error) {
				Logger.error(`[${this.name}] change subscriber error for '${key}':`, error)
			}
		}
	}

	public get<V = T>(key: string): V | undefined
	public get<V = T>(key: string, defaultValue: V): V
	public get<V = T>(key: string, defaultValue?: V): V | undefined {
		try {
			const value = this._get(key) as V | undefined
			return value !== undefined ? value : defaultValue
		} catch (error) {
			Logger.error(`[${this.name}] failed to get '${key}':`, error)
			return defaultValue
		}
	}

	/**
	 * Memento-compatible update method. Calls set() internally.
	 */
	public update(key: string, value: any): Thenable<void> {
		this.set(key, value)
		return Promise.resolve()
	}

	public set(key: string, value: T | undefined): void {
		try {
			this._set(key, value)
			this.fireChange(key)
		} catch (error) {
			Logger.error(`[${this.name}] failed to set '${key}':`, error)
		}
	}

	public delete(key: string): void {
		try {
			this._delete(key)
			this.fireChange(key)
		} catch (error) {
			Logger.error(`[${this.name}] failed to delete '${key}':`, error)
		}
	}

	public keys(): readonly string[] {
		try {
			return this._keys()
		} catch (error) {
			Logger.error(`[${this.name}] failed to get keys:`, error)
			return []
		}
	}

	protected abstract _get(key: string): T | undefined
	protected abstract _set(key: string, value: T | undefined): void
	protected abstract _delete(key: string): void
	protected abstract _keys(): readonly string[]
}

/**
 * A simple in-memory implementation of ClineStorage using a Map.
 */
export class ClineInMemoryStorage extends ClineStorage {
	/**
	 * A simple in-memory cache to store key-value pairs.
	 */
	private readonly _cache = new Map<string, string>()

	protected async _get(key: string): Promise<string | undefined> {
		return this._cache.get(key)
	}

	protected async _store(key: string, value: string): Promise<void> {
		this._cache.set(key, value)
	}

	protected async _delete(key: string): Promise<void> {
		this._cache.delete(key)
	}
}
