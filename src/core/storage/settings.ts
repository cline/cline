export interface SettingsStore {
	get<T>(key: string): Promise<T | undefined>
	put<T>(key: string, value: T): Promise<void>
	keys(): readonly string[]
	delete(key: string): Promise<void>
}

export interface SecretStore {
	get(key: string): Promise<string | undefined>
	put(key: string, value: string): Promise<void>
	delete(key: string): Promise<void>
}

export interface Settings {
	globalSettings: SettingsStore
	workspaceSettings: SettingsStore
	secrets: SecretStore
}
