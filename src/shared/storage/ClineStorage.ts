export interface ClineStorageChangeEvent {
	readonly key: string
}

export type StorageEventListener = (event: ClineStorageChangeEvent) => Promise<void>

/**
 * An abstract storage class that provides a template for storage operations.
 * Implements a Memento-like interface compatible with VS Code's storage API.
 * Subclasses must implement the protected abstract methods to define their storage logic.
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
	 * Fire storage change event to all subscribers.
	 */
	protected async fire(key: string): Promise<void> {
		await Promise.all(this.subscribers.map((subscriber) => subscriber({ key })))
	}

	/**
	 * Returns the stored keys.
	 * Subclasses must implement _keys() to provide their key list.
	 */
	public keys(): readonly string[] {
		try {
			return this._keys()
		} catch (error) {
			console.error(`[${this.name}] failed to get keys:`, error)
			return []
		}
	}

	/**
	 * Return a value.
	 *
	 * @param key A string.
	 * @param defaultValue A value that should be returned when there is no value with the given key.
	 * @returns The stored value, the defaultValue, or undefined.
	 */
	public get<T>(key: string): T | undefined
	public get<T>(key: string, defaultValue: T): T
	public get<T>(key: string, defaultValue?: T): T | undefined {
		try {
			const rawValue = this._getSync(key)
			if (rawValue === undefined) {
				return defaultValue
			}
			// Parse JSON if it looks like a JSON string
			try {
				return JSON.parse(rawValue) as T
			} catch {
				// If parsing fails, return as-is (for plain strings)
				return rawValue as T
			}
		} catch (error) {
			console.error(`[${this.name}] failed to get '${key}':`, error)
			return defaultValue
		}
	}

	/**
	 * Store a value. The value must be JSON-stringifyable.
	 *
	 * Note that using `undefined` as value removes the key from the underlying storage.
	 *
	 * @param key A string.
	 * @param value A value. MUST not contain cyclic references.
	 */
	public async update(key: string, value: any): Promise<void> {
		try {
			if (value === undefined) {
				await this._delete(key)
			} else {
				// Stringify non-string values
				const stringValue = typeof value === "string" ? value : JSON.stringify(value)
				await this._store(key, stringValue)
			}
			await this.fire(key)
		} catch (error) {
			console.error(`[${this.name}] failed to update '${key}':`, error)
		}
	}

	// Legacy methods for backward compatibility

	/**
	 * @deprecated Use get() instead for Memento compatibility
	 */
	public async getString(key: string): Promise<string | undefined> {
		try {
			return await this._get(key)
		} catch (error) {
			console.error(`[${this.name}] failed to get '${key}':`, error)
			return undefined
		}
	}

	/**
	 * @deprecated Use update() instead for Memento compatibility
	 */
	public async store(key: string, value?: string): Promise<void> {
		try {
			if (value) {
				await this._store(key, value)
			} else {
				await this._delete(key)
			}
			await this.fire(key)
		} catch (error) {
			console.error(`[${this.name}] failed to store '${key}':`, error)
		}
	}

	/**
	 * @deprecated Use update(key, undefined) instead for Memento compatibility
	 */
	public async delete(key: string): Promise<void> {
		try {
			await this._delete(key)
			await this.fire(key)
		} catch (error) {
			console.error(`[${this.name}] failed to delete '${key}':`, error)
		}
	}

	/**
	 * Abstract method that subclasses must implement to return all stored keys.
	 */
	protected abstract _keys(): readonly string[]

	/**
	 * Synchronous method to get a value.
	 */
	protected _getSync(key: string): string | undefined {
		return this.get(key)
	}

	/**
	 * Abstract method that subclasses must implement to asynchronously retrieve values.
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

/**
 * A simple in-memory implementation of ClineStorage using a Map.
 */
export class InMemoryClineStorage extends ClineStorage {
	/**
	 * A simple in-memory cache to store key-value pairs.
	 */
	private readonly _cache = new Map<string, string>()

	protected _keys(): readonly string[] {
		return Array.from(this._cache.keys())
	}

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
