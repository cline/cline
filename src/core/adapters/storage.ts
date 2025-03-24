export interface StorageAdapter {
	get<T>(key: string, defaultValue?: T, scope?: string): Promise<T | undefined>
	set<T>(key: string, value: T, scope?: string): Promise<void>
	delete(key: string, scope?: string): Promise<void>
}
