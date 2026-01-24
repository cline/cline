import { Logger } from "../services/Logger"
import { ClineStorage } from "./ClineStorage"

export type SecretStores = VSCodeSecretStorage | ClineStorage

/**
 * Wrapper around VSCode Secret Storage or any other storage type for managing secrets.
 */
export class ClineSecretStorage extends ClineStorage {
	override readonly name = "ClineSecretStorage"
	private static store: ClineSecretStorage | null = null
	static get instance(): ClineSecretStorage {
		if (!ClineSecretStorage.store) {
			ClineSecretStorage.store = new ClineSecretStorage()
		}
		return ClineSecretStorage.store
	}

	private secretStorage: SecretStores | null = null

	public get storage(): SecretStores {
		if (!this.secretStorage) {
			throw new Error("[ClineSecretStorage] init not called")
		}
		return this.secretStorage
	}

	public init(store: SecretStores) {
		if (!this.secretStorage) {
			this.secretStorage = store
			Logger.info("[ClineSecretStorage] initialized")
		}
		return this.secretStorage
	}

	protected async _get(key: string): Promise<string | undefined> {
		try {
			return key ? await this.storage.get(key) : undefined
		} catch {
			return undefined
		}
	}

	/**
	 * [SECURITY] Avoid logging secrets values.
	 */
	protected async _store(key: string, value: string): Promise<void> {
		try {
			if (value && value.length > 0) {
				await this.storage.store(key, value)
			}
		} catch (error) {
			Logger.error("[ClineSecretStorage] Failed to store", error)
		}
	}

	protected async _delete(key: string): Promise<void> {
		await this.storage.delete(key)
	}
}

interface VSCodeSecretStorage {
	get(key: string): Thenable<string | undefined>

	store(key: string, value: string): Thenable<void>

	delete(key: string): Thenable<void>

	onDidChange: any
}

/**
 * Singleton instance of ClineSecretStorage
 */
export const secretStorage = ClineSecretStorage.instance
