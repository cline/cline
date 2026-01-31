/**
 * VSCode context stub for CLI mode
 * Provides mock implementations of VSCode extension context
 */

import { mkdirSync } from "node:fs"
import os from "os"
import path from "path"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineExtensionContext } from "@/shared/cline"
import { ClineFileStorage } from "@/shared/storage"
import { EnvironmentVariableCollection, ExtensionKind, ExtensionMode, readJson, URI } from "./vscode-shim"

const SETTINGS_SUBFOLDER = "data"

/**
 * CLI-specific state overrides.
 * These values are always returned regardless of what's stored,
 * and writes to these keys are silently ignored.
 */
const CLI_STATE_OVERRIDES: Record<string, any> = {
	// CLI always uses background execution, not VSCode terminal
	vscodeTerminalExecutionMode: "backgroundExec",
	backgroundEditEnabled: true,
	multiRootEnabled: false,
	enableCheckpointsSetting: false,
	browserSettings: {
		disableToolUse: true,
	},
}

/**
 * File-based Memento store with optional key overrides.
 * Implements VSCode's Memento interface using SyncJsonFileStorage.
 */
class MementoStore extends ClineFileStorage {
	private overrides: Record<string, any>

	constructor(filePath: string, overrides: Record<string, any> = {}) {
		super(filePath, "MementoStore")
		this.overrides = overrides
	}

	// VSCode Memento interface - override base class get() with overload support
	override get<T>(key: string): T | undefined
	override get<T>(key: string, defaultValue: T): T
	override get<T>(key: string, defaultValue?: T): T | undefined {
		if (key in this.overrides) {
			return this.overrides[key] as T
		}
		const value = super.get<T>(key)
		return value !== undefined ? value : defaultValue
	}

	override async update(key: string, value: any): Promise<void> {
		if (key in this.overrides) {
			return
		}
		this.set(key, value)
	}

	setKeysForSync(_keys: readonly string[]): void {
		// No-op for CLI
	}
}

/**
 * File-based secret storage implementing VSCode's SecretStorage interface.
 * Uses sync storage internally but exposes async API for VSCode compatibility.
 */
class SecretStore {
	private storage: ClineFileStorage<string>
	private onDidChangeEmitter = {
		event: () => ({ dispose: () => {} }),
		fire: (_e: any) => {},
		dispose: () => {},
	}

	onDidChange = this.onDidChangeEmitter.event

	constructor(filePath: string) {
		this.storage = new ClineFileStorage<string>(filePath, "SecretStore")
	}

	get(key: string): Promise<string | undefined> {
		return Promise.resolve(this.storage.get(key))
	}

	store(key: string, value: string): Promise<void> {
		this.storage.set(key, value)
		return Promise.resolve()
	}

	delete(key: string): Promise<void> {
		this.storage.delete(key)
		return Promise.resolve()
	}
}

export interface CliContextConfig {
	clineDir?: string
	/** The workspace directory being worked in (for hashing into storage path) */
	workspaceDir?: string
}

/**
 * Create a short hash of a string for use in directory names
 */
function hashString(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = (hash << 5) - hash + char
		hash = hash & hash // Convert to 32bit integer
	}
	return Math.abs(hash).toString(16).substring(0, 8)
}

export interface CliContextResult {
	extensionContext: ClineExtensionContext
	DATA_DIR: string
	EXTENSION_DIR: string
	WORKSPACE_STORAGE_DIR: string
}

/**
 * Initialize the VSCode-like context for CLI mode
 */
export function initializeCliContext(config: CliContextConfig = {}): CliContextResult {
	const CLINE_DIR = config.clineDir || process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
	const DATA_DIR = path.join(CLINE_DIR, SETTINGS_SUBFOLDER)

	// Workspace storage should always be under ~/.cline/data/workspaces/<hash>/
	// where hash is derived from the workspace path to keep workspaces isolated
	const workspacePath = config.workspaceDir || process.cwd()
	const workspaceHash = hashString(workspacePath)
	const WORKSPACE_STORAGE_DIR = process.env.WORKSPACE_STORAGE_DIR || path.join(DATA_DIR, "workspaces", workspaceHash)

	// Ensure directories exist
	mkdirSync(DATA_DIR, { recursive: true })
	mkdirSync(WORKSPACE_STORAGE_DIR, { recursive: true })

	// For CLI, extension dir is the root of the project (parent of cli)
	const EXTENSION_DIR = path.resolve(__dirname, "..", "..")
	const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

	const extension: ClineExtensionContext["extension"] = {
		id: ExtensionRegistryInfo.id,
		isActive: true,
		extensionPath: EXTENSION_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		packageJSON: readJson(path.join(EXTENSION_DIR, "package.json")),
		exports: undefined,
		activate: async () => {},
		extensionKind: ExtensionKind.UI,
	}

	const extensionContext: ClineExtensionContext = {
		extension: extension,
		extensionMode: EXTENSION_MODE,

		// Set up KV stores (globalState has CLI-specific overrides)
		globalState: new MementoStore(path.join(DATA_DIR, "globalState.json"), CLI_STATE_OVERRIDES),
		secrets: new SecretStore(path.join(DATA_DIR, "secrets.json")),

		// Set up URIs
		storageUri: URI.file(WORKSPACE_STORAGE_DIR),
		storagePath: WORKSPACE_STORAGE_DIR,
		globalStorageUri: URI.file(DATA_DIR),
		globalStoragePath: DATA_DIR,

		// Logs
		logUri: URI.file(DATA_DIR),
		logPath: DATA_DIR,

		extensionUri: URI.file(EXTENSION_DIR),
		extensionPath: EXTENSION_DIR,
		asAbsolutePath: (relPath: string) => path.join(EXTENSION_DIR, relPath),

		subscriptions: [],

		environmentVariableCollection: new EnvironmentVariableCollection() as any,

		// Workspace state
		workspaceState: new MementoStore(path.join(WORKSPACE_STORAGE_DIR, "workspaceState.json")),
	}

	return {
		extensionContext,
		DATA_DIR,
		EXTENSION_DIR,
		WORKSPACE_STORAGE_DIR,
	}
}
