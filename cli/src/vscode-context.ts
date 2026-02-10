/**
 * VSCode context stub for CLI mode
 * Provides mock implementations of VSCode extension context.
 */

import { fileURLToPath } from "node:url"
import os from "os"
import path from "path"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineExtensionContext } from "@/shared/cline"
import type { ClineFileStorage } from "@/shared/storage"
import type { ClineMemento, ClineSecretStore } from "@/shared/storage/ClineStorage"
import { createStorageContext, type StorageContext } from "@/shared/storage/storage-context"
import { EnvironmentVariableCollection, ExtensionKind, ExtensionMode, readJson, URI } from "./vscode-shim"

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
 * Memento adapter that wraps a ClineFileStorage with optional key overrides.
 * Used for globalState where CLI needs to inject hardcoded overrides.
 */
class MementoAdapter implements ClineMemento {
	constructor(
		private readonly store: ClineFileStorage,
		private readonly overrides: Record<string, any> = {},
	) {}

	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	get<T>(key: string, defaultValue?: T): T | undefined {
		if (key in this.overrides) {
			return this.overrides[key] as T
		}
		const value = this.store.get<T>(key)
		return value !== undefined ? value : defaultValue
	}

	update(key: string, value: any): Thenable<void> {
		if (key in this.overrides) {
			return Promise.resolve()
		}
		this.store.set(key, value)
		return Promise.resolve()
	}

	keys(): readonly string[] {
		return this.store.keys()
	}

	setKeysForSync(_keys: readonly string[]): void {
		// No-op for CLI
	}
}

/**
 * SecretStorage adapter that wraps a ClineFileStorage<string> to satisfy
 * the ClineSecretStore (async) interface expected by ClineExtensionContext.
 */
class SecretStoreAdapter implements ClineSecretStore {
	onDidChange = () => ({ dispose: () => {} })

	constructor(private readonly _storage: ClineFileStorage<string>) {}

	get(key: string): Thenable<string | undefined> {
		return Promise.resolve(this._storage.get(key))
	}

	store(key: string, value: string): Thenable<void> {
		this._storage.set(key, value)
		return Promise.resolve()
	}

	delete(key: string): Thenable<void> {
		this._storage.delete(key)
		return Promise.resolve()
	}
}

export interface CliContextConfig {
	clineDir?: string
	/** The workspace directory being worked in (used to compute workspace storage hash) */
	workspaceDir?: string
}

export interface CliContextResult {
	extensionContext: ClineExtensionContext
	storageContext: StorageContext
	DATA_DIR: string
	EXTENSION_DIR: string
	WORKSPACE_STORAGE_DIR: string
}

/**
 * Initialize the VSCode-like context for CLI mode.
 *
 * Creates a shared StorageContext (the single source of truth for all storage)
 * and wraps it in a ClineExtensionContext shell for legacy APIs that still
 * expect the VSCode ExtensionContext shape.
 */
export function initializeCliContext(config: CliContextConfig = {}): CliContextResult {
	const CLINE_DIR = config.clineDir || process.env.CLINE_DIR || path.join(os.homedir(), ".cline")

	// Create the shared StorageContext — this owns all ClineFileStorage instances.
	// CLI, JetBrains, and VSCode all share this same file-backed implementation.
	const storageContext = createStorageContext({
		clineDir: CLINE_DIR,
		workspacePath: config.workspaceDir || process.cwd(),
		workspaceStorageDir: process.env.WORKSPACE_STORAGE_DIR || undefined,
	})

	const DATA_DIR = storageContext.dataDir
	const WORKSPACE_STORAGE_DIR = storageContext.workspaceStoragePath

	// For CLI, extension dir is the package root (one level up from dist/)
	const EXTENSION_DIR = path.resolve(__dirname, "..")
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

	// Build the ClineExtensionContext shell. All storage delegates to storageContext —
	// there are NO separate ClineFileStorage instances here.
	const extensionContext: ClineExtensionContext = {
		extension: extension,
		extensionMode: EXTENSION_MODE,

		// Storage — delegates to storageContext stores (with CLI overrides for globalState)
		globalState: new MementoAdapter(storageContext.globalState, CLI_STATE_OVERRIDES),
		secrets: new SecretStoreAdapter(storageContext.secrets),
		workspaceState: new MementoAdapter(storageContext.workspaceState),

		// URIs / paths
		storageUri: URI.file(WORKSPACE_STORAGE_DIR),
		storagePath: WORKSPACE_STORAGE_DIR,
		globalStorageUri: URI.file(DATA_DIR),
		globalStoragePath: DATA_DIR,
		logUri: URI.file(DATA_DIR),
		logPath: DATA_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		extensionPath: EXTENSION_DIR,
		asAbsolutePath: (relPath: string) => path.join(EXTENSION_DIR, relPath),

		subscriptions: [],
		environmentVariableCollection: new EnvironmentVariableCollection() as any,
	}

	return {
		extensionContext,
		storageContext,
		DATA_DIR,
		EXTENSION_DIR,
		WORKSPACE_STORAGE_DIR,
	}
}
