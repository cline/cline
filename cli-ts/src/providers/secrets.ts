import keytar from "keytar"
import path from "path"
import { ClineFileStorage, ClineStorage } from "@/shared/storage"
import { printInfo } from "../utils/display"

export class ClineCredentialStorage extends ClineStorage {
	private cache: Map<string, string> = new Map()
	private backupStorage: ClineStorage | null = null

	constructor(
		private readonly service: string,
		private readonly backupDir: string,
	) {
		super()

		keytar
			.findCredentials(service)
			.then((c) => {
				printInfo(`[ClineCredentialStorage] Loaded ${JSON.stringify(c)} credentials from system store`)
				c.forEach((cred) => {
					this.cache.set(cred.account, cred.password)
				})
			})
			.catch(() => {
				this.backupStorage = new ClineFileStorage(path.join(this.backupDir, "auth.json"))
			})
	}

	override async _get(key: string): Promise<string | undefined> {
		try {
			if (this.backupStorage) {
				return await this.backupStorage.get(key)
			}
			return this.cache.get(key) || undefined
		} catch (error) {
			throw error
		}
	}

	override async _store(key: string, value: string): Promise<void> {
		if (!value) {
			this.delete(key)
		}
		try {
			if (this.backupStorage) {
				await this.backupStorage.store(key, value)
				return
			}

			await keytar.setPassword(this.service, key, value)
			this.cache.set(key, value)
		} catch (error) {
			throw error
		}
	}

	override async _delete(key: string): Promise<void> {
		try {
			if (!this.cache.has(key)) {
				return
			}

			if (this.backupStorage) {
				await this.backupStorage.delete(key)
				return
			}

			await keytar.deletePassword(this.service, key)
			this.cache.delete(key)
		} catch (error) {
			throw error
		}
	}
}
