import { Logger } from "../services/Logger"
import { BeadsmithStorage } from "./BeadsmithStorage"

export type SecretStores = VSCodeSecretStorage | BeadsmithStorage

/**
 * Wrapper around VSCode Secret Storage or any other storage type for managing secrets.
 */
export class BeadsmithSecretStorage extends BeadsmithStorage {
	override readonly name = "BeadsmithSecretStorage"
	private static store: BeadsmithSecretStorage | null = null
	static get instance(): BeadsmithSecretStorage {
		if (!BeadsmithSecretStorage.store) {
			BeadsmithSecretStorage.store = new BeadsmithSecretStorage()
		}
		return BeadsmithSecretStorage.store
	}

	private secretStorage: SecretStores | null = null

	public get storage(): SecretStores {
		if (!this.secretStorage) {
			throw new Error("[BeadsmithSecretStorage] init not called")
		}
		return this.secretStorage
	}

	public init(store: SecretStores) {
		if (!this.secretStorage) {
			this.secretStorage = store
			Logger.info("[BeadsmithSecretStorage] initialized")
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
			Logger.error("[BeadsmithSecretStorage] Failed to store", error)
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
 * Singleton instance of BeadsmithSecretStorage
 */
export const secretStorage = BeadsmithSecretStorage.instance
