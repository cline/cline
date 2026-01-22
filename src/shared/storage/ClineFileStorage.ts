import * as fs from "node:fs"
import * as path from "node:path"
import { ClineStorage } from "./ClineStorage"

/**
 * A storage implementation that uses the filesystem to store key-value pairs.
 */
export class ClineFileStorage extends ClineStorage {
	override name = "FileBasedStorage"

	private readonly cache = new Map<string, string>()

	constructor(private fsPath: string) {
		super()
		this.read()
	}

	override async _get(key: string): Promise<string | undefined> {
		try {
			return this.cache.get(key) || undefined
		} catch (error) {
			throw error
		}
	}

	override async _store(key: string, value: string): Promise<void> {
		try {
			this.cache.set(key, value)
			await this.write()
		} catch (error) {
			throw error
		}
	}

	override async _delete(key: string): Promise<void> {
		try {
			this.cache.delete(key)
			await this.write()
		} catch (error) {
			console.error("FileBasedStorage", error)
		}
	}

	private async read(): Promise<void> {
		try {
			const fileContent = await fs.promises.readFile(this.fsPath, "utf-8")
			const json = JSON.parse(fileContent) as Record<string, string>
			this.cache.clear() // Clear existing cache
			for (const [key, value] of Object.entries(json)) {
				if (key && value) {
					this.cache.set(key, value)
				}
			}
		} catch (error) {
			throw error
		}
	}

	private async write(): Promise<void> {
		try {
			// Ensure directory exists
			const dir = path.dirname(this.fsPath)
			await fs.promises.mkdir(dir, { recursive: true })

			// Convert map to object and save
			const json = Object.fromEntries(this.cache)
			await fs.promises.writeFile(this.fsPath, JSON.stringify(json, null, 2), "utf-8")
		} catch (error) {
			console.error("FileBasedStorage", error)
		}
	}
}
