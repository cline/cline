import * as vscode from "vscode"
import { SecretStore, Settings, SettingsStore, SettingsStoreWithKeys } from "@/core/storage/settings"

/**
 * VSCode-specific implementation of the Settings interface.
 * Provides a wrapper around VSCode's underlying settings and secrets storage mechanisms:
 * - WorkspaceSettings: Uses VSCode's workspace configuration API
 * - GlobalSettings: Uses VSCode's global state (Memento) API
 * - Secrets: Uses VSCode's secure secrets storage API
 */
export class VscodeSettingsStore implements Settings {
	globalSettings: SettingsStoreWithKeys
	workspaceSettings: SettingsStore
	secrets: SecretStore
	constructor(context: vscode.ExtensionContext) {
		this.globalSettings = new GlobalSettings(context)
		this.workspaceSettings = new WorkspaceSettings()
		this.secrets = new Secrets(context)
	}
}

class GlobalSettings implements SettingsStoreWithKeys {
	globalState: vscode.Memento

	constructor(context: vscode.ExtensionContext) {
		this.globalState = context.globalState
	}
	get<T>(key: string): Promise<T | undefined> {
		return Promise.resolve(this.globalState.get<T>(key))
	}
	put<T>(key: string, value: T): Promise<void> {
		return Promise.resolve(this.globalState.update(key, value))
	}
	keys(): readonly string[] {
		return this.globalState.keys()
	}
	delete(key: string): Promise<void> {
		return Promise.resolve(this.globalState.update(key, undefined))
	}
}

class WorkspaceSettings implements SettingsStore {
	config: vscode.WorkspaceConfiguration

	constructor() {
		this.config = vscode.workspace.getConfiguration("cline")
	}
	get<T>(key: string): Promise<T | undefined> {
		return Promise.resolve(this.config.get(key))
	}
	put<T>(key: string, value: T): Promise<void> {
		return Promise.resolve(this.config.update(key, value))
	}
	delete(key: string): Promise<void> {
		return Promise.resolve(this.config.update(key, undefined))
	}
}

class Secrets implements SecretStore {
	secrets: vscode.SecretStorage

	constructor(context: vscode.ExtensionContext) {
		this.secrets = context.secrets
	}
	get(key: string): Promise<string | undefined> {
		return Promise.resolve(this.secrets.get(key))
	}
	put(key: string, value: string): Promise<void> {
		return Promise.resolve(this.secrets.store(key, value))
	}
	delete(key: string): Promise<void> {
		return Promise.resolve(this.secrets.delete(key))
	}
}
