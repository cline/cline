import { Logger } from "../services/Logger"

export interface BeadsmithStorageChangeEvent {
	readonly key: string
}

export type StorageEventListener = (event: BeadsmithStorageChangeEvent) => Promise<void>

/**
 * An abstract storage class that provides a template for storage operations.
 * Subclasses must implement the protected abstract methods to define their storage logic.
 * The public methods (get, store, delete) are final and cannot be overridden.
 */
export abstract class BeadsmithStorage {
	/**
	 * The name of the storage, used for logging purposes.
	 */
	protected name = "BeadsmithStorage"
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

	/**
	 * Store a value in storage. This method is final and cannot be overridden.
	 * Subclasses should implement _store() to define their storage logic.
	 * This method automatically fires change events after storing.
	 */
	public async store(key: string, value: string): Promise<void> {
		try {
			await this._store(key, value)
			await this.fire(key)
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
			await this.fire(key)
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

/**
 * A simple in-memory implementation of BeadsmithStorage using a Map.
 */
export class InMemoryBeadsmithStorage extends BeadsmithStorage {
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
