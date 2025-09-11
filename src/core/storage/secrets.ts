import type { SecretStorage as VSCodeSecretStorage } from "vscode"
import { ClineStorage } from "./stateless"

export type ClineSecretStorageType = ClineSecretStorage

class ClineSecretStorage extends ClineStorage {
	private _store: VSCodeSecretStorage | null = null

	public get storage(): VSCodeSecretStorage {
		if (!this._store) {
			console.error("[ClineSecretStorage]", "SecretStorage not initialized")
			throw new Error("SecretStorage not initialized")
		}
		return this._store
	}

	public setStorage(storage: VSCodeSecretStorage): void {
		if (!this._store) {
			this._store = storage
			console.info("[ClineSecretStorage]", "set")
		}
	}

	override async get(key: string): Promise<string | undefined> {
		try {
			if (key) {
				console.info("[ClineSecretStorage]", "get", key)
				return await this.storage.get(key)
			}
		} catch (error) {
			console.error("[ClineSecretStorage]", error)
		}
		return undefined
	}

	override async store(key: string, value: string): Promise<void> {
		try {
			if (value?.length > 0) {
				await this.storage.store(key, value)
			}
		} catch (error) {
			console.error("[ClineSecretStorage]", error)
		}
	}

	override async delete(key: string): Promise<void> {
		await this.storage.delete(key)
	}
}

export const secretStorage = new ClineSecretStorage()
