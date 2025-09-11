import { Disposable } from "vscode"
import { StorageEventListener } from "./utils/types"

/**
 * A storage implementation that uses an in-memory map to store key-value pairs.
 */
export class ClineStorage {
	private readonly _cache = new Map<string, string>()

	private readonly subscribers: Array<StorageEventListener> = []

	public get(key: string): Promise<string | undefined> {
		return Promise.resolve(this._cache.get(key))
	}

	public store(key: string, value: string): Promise<void> {
		this._cache.set(key, value)
		return Promise.resolve()
	}

	public delete(key: string): Promise<void> {
		this._cache.delete(key)
		return Promise.resolve()
	}

	public onDidChange(callback: StorageEventListener): Disposable {
		this.subscribers.push(callback)
		return new Disposable(() => {
			const callbackIndex = this.subscribers.indexOf(callback)
			this.subscribers.splice(callbackIndex, 1)
		})
	}
}
