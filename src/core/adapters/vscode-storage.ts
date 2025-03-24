import * as vscode from "vscode"
import { StorageAdapter } from "./storage"

type StorageScope = "global" | "workspace" | "secret"

export class VSCodeStorageAdapter implements StorageAdapter {
	constructor(readonly context: vscode.ExtensionContext) {}

	async get<T>(key: string, defaultValue?: T, scope: StorageScope = "global"): Promise<T | undefined> {
		switch (scope) {
			case "global":
				return this.getGlobalState<T>(key, defaultValue)
			case "workspace":
				return this.getWorkspaceState<T>(key, defaultValue)
			case "secret":
				const value = await this.getSecret(key)
				return value as unknown as T
			default:
				throw new Error(`Unsupported storage scope: ${scope}`)
		}
	}

	async set<T>(key: string, value: T, scope: StorageScope = "global"): Promise<void> {
		switch (scope) {
			case "global":
				return this.updateGlobalState(key, value)
			case "workspace":
				return this.updateWorkspaceState(key, value)
			case "secret":
				return this.storeSecret(key, value as unknown as string)
			default:
				throw new Error(`Unsupported storage scope: ${scope}`)
		}
	}

	async delete(key: string, scope: StorageScope = "global"): Promise<void> {
		return this.set(key, undefined, scope)
	}

	async updateExisting<T extends { id: string }>(key: string, item: T, scope: StorageScope = "global"): Promise<T[]> {
		const existing = (await this.get<T[]>(key, [], scope)) || []
		const existingItemIndex = existing.findIndex((h) => h.id === item.id)

		if (existingItemIndex !== -1) {
			existing[existingItemIndex] = item
		} else {
			existing.push(item)
		}

		await this.set(key, existing, scope)
		return existing
	}

	async clearAll(): Promise<void> {
		const globalKeys = this.context.globalState.keys()
		const workspaceKeys = this.context.workspaceState.keys()

		await Promise.all([
			...globalKeys.map((key) => this.context.globalState.update(key, undefined)),
			...workspaceKeys.map((key) => this.context.workspaceState.update(key, undefined)),
		])
	}

	private async getGlobalState<T>(key: string, defaultValue?: T): Promise<T | undefined> {
		const value = await this.context.globalState.get<T>(key)
		return value === undefined ? defaultValue : value
	}

	private async updateGlobalState<T>(key: string, value: T): Promise<void> {
		return this.context.globalState.update(key, value)
	}

	private async getWorkspaceState<T>(key: string, defaultValue?: T): Promise<T | undefined> {
		const value = await this.context.workspaceState.get<T>(key)
		return value === undefined ? defaultValue : value
	}

	private async updateWorkspaceState<T>(key: string, value: T): Promise<void> {
		return this.context.workspaceState.update(key, value)
	}

	private async storeSecret(key: string, value?: string): Promise<void> {
		if (value) {
			await this.context.secrets.store(key, value)
		} else {
			await this.context.secrets.delete(key)
		}
	}

	private async getSecret(key: string): Promise<string | undefined> {
		return await this.context.secrets.get(key)
	}
}
