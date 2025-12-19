import * as fs from "fs/promises"
import path from "path"
import { Settings, SettingsStore } from "@/core/storage/settings"

/**
 * VSCode-specific implementation of the Settings interface.
 * Provides a wrapper around VSCode's underlying settings and secrets storage mechanisms:
 * - WorkspaceSettings: Uses VSCode's workspace configuration API
 * - GlobalSettings: Uses VSCode's global state (Memento) API
 * - Secrets: Uses VSCode's secure secrets storage API
 */
export class ExternalSettingsStore implements Settings {
	globalSettings!: SettingsStore
	workspaceSettings!: SettingsStore
	secrets!: SettingsStore
	static async initialize(settingsDir: string, workspaceDir: string) {
		const store = new ExternalSettingsStore()
		store.globalSettings = await JsonKeyValueStore.initialize(path.join(settingsDir, "secrets.json"))
		store.workspaceSettings = await JsonKeyValueStore.initialize(path.join(settingsDir, "globalState.json"))
		store.secrets = await JsonKeyValueStore.initialize(path.join(workspaceDir, "workspaceState.json"))
		return store
	}
	private constructor() {}
}

/** A simple key-value store for secrets backed by a JSON file. This is not secure, and it is not thread-safe. */
export class JsonKeyValueStore implements SettingsStore {
	private data = new Map<string, any>()
	private filePath: string

	static initialize(filePath: string): Promise<JsonKeyValueStore> {
		const store = new JsonKeyValueStore(filePath)
		return store.load()
	}

	private constructor(filePath: string) {
		this.filePath = filePath
	}

	get<T>(key: string): Promise<T | undefined> {
		return Promise.resolve(this.data.get(key))
	}

	put<T>(key: string, value: T): Promise<void> {
		this.data.set(key, value)
		return this.save()
	}

	keys(): readonly string[] {
		return Array.from(this.data.keys())
	}

	delete(key: string): Promise<void> {
		this.data.delete(key)
		return this.save()
	}

	private async load(): Promise<JsonKeyValueStore> {
		try {
			const data = JSON.parse(await fs.readFile(this.filePath, "utf-8"))
			Object.entries(data).forEach(([k, v]) => {
				this.data.set(k, v as string)
			})
		} catch (_error) {
			// File doesn't exist or can't be read, start with empty data
		}
		return this
	}
	private async save(): Promise<void> {
		// Use mode 0o600 to restrict file permissions to owner read/write only (fixes #7778)
		await fs.writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.data), null, 2), { mode: 0o600 })
	}
}
