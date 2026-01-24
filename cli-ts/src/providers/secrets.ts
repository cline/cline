import keytar from "keytar"
import { ClineStorage } from "@/shared/storage"

export class ClineCredentialStorage extends ClineStorage {
	private cache: Map<string, string> = new Map()

	constructor(private readonly service: string) {
		super()
	}

	public static async ok(): Promise<boolean> {
		try {
			// Test connection to keytar service
			await keytar.findPassword("cline-test-random")
			return true
		} catch {
			// Cannot connect to keytar service
			return false
		}
	}

	override async _get(key: string): Promise<string | undefined> {
		try {
			if (this.cache.has(key)) {
				return this.cache.get(key)
			}

			const secret = await keytar.getPassword(this.service, key)
			if (secret) {
				this.cache.set(key, secret)
			}

			return secret || undefined
		} catch (error) {
			throw error
		}
	}

	override async _store(key: string, value: string): Promise<void> {
		if (!value) {
			this.delete(key)
		}
		try {
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
			await keytar.deletePassword(this.service, key)
			this.cache.delete(key)
		} catch (error) {
			throw error
		}
	}
}
