/**
 * VSCode context stub for CLI mode
 * Provides mock implementations of VSCode extension context
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "os"
import path from "path"
import type { Memento, SecretStorage } from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { ClineClient, ClineExtensionContext } from "@/shared/clients"
import { globalStorage } from "@/shared/storage"
import { ExtensionKind, ExtensionMode, URI } from "./vscode-shim"

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
 * Simple file-based Memento store for persisting state
 */
class MementoStore implements Memento {
	private data: Record<string, any> = {}
	private filePath: string

	constructor(filePath: string) {
		this.filePath = filePath
		this.load()
	}

	private load() {
		try {
			if (existsSync(this.filePath)) {
				const content = readFileSync(this.filePath, "utf8")
				this.data = JSON.parse(content)
			}
		} catch (error) {
			console.error(`Failed to load state from ${this.filePath}:`, error)
			this.data = {}
		}
	}

	private save() {
		try {
			mkdirSync(path.dirname(this.filePath), { recursive: true })
			writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
		} catch (error) {
			console.error(`Failed to save state to ${this.filePath}:`, error)
		}
	}

	keys(): readonly string[] {
		return Object.keys(this.data)
	}

	get<T>(key: string): T | undefined
	get<T>(key: string, defaultValue: T): T
	get<T>(key: string, defaultValue?: T): T | undefined {
		// Return CLI overrides for locked keys
		if (key in CLI_STATE_OVERRIDES) {
			return CLI_STATE_OVERRIDES[key] as T
		}
		const value = this.data[key]
		return value !== undefined ? value : defaultValue
	}

	async update(key: string, value: any): Promise<void> {
		// Silently ignore writes to CLI-locked keys
		if (key in CLI_STATE_OVERRIDES) {
			return
		}
		if (value === undefined) {
			delete this.data[key]
		} else {
			this.data[key] = value
		}
		this.save()
	}

	setKeysForSync(_keys: readonly string[]): void {
		// No-op for CLI
	}
}

/**
 * Simple file-based secret storage
 */
class SecretStore implements SecretStorage {
	private data: Record<string, string> = {}
	private filePath: string
	private onDidChangeEmitter = {
		event: () => ({ dispose: () => {} }),
		fire: (_e: any) => {},
		dispose: () => {},
	}

	onDidChange = this.onDidChangeEmitter.event

	constructor(filePath: string) {
		this.filePath = filePath
		this.load()
	}

	private load() {
		try {
			if (existsSync(this.filePath)) {
				const content = readFileSync(this.filePath, "utf8")
				this.data = JSON.parse(content)
			}
		} catch {
			this.data = {}
		}
	}

	private save() {
		try {
			mkdirSync(path.dirname(this.filePath), { recursive: true })
			writeFileSync(this.filePath, JSON.stringify(this.data, null, 2))
		} catch (error) {
			console.error(`Failed to save secrets:`, error)
		}
	}

	async get(key: string): Promise<string | undefined> {
		return this.data[key]
	}

	async store(key: string, value: string): Promise<void> {
		this.data[key] = value
		this.save()
	}

	async delete(key: string): Promise<void> {
		delete this.data[key]
		this.save()
	}
}

/**
 * Mock environment variable collection
 */
class EnvironmentVariableCollection {
	private variables: Map<string, any> = new Map()
	persistent = true
	description = "CLI Environment Variables"

	entries(): IterableIterator<[string, any]> {
		return this.variables.entries()
	}

	replace(variable: string, value: string) {
		this.variables.set(variable, { value, type: "replace" })
	}

	append(variable: string, value: string) {
		this.variables.set(variable, { value, type: "append" })
	}

	prepend(variable: string, value: string) {
		this.variables.set(variable, { value, type: "prepend" })
	}

	get(variable: string) {
		return this.variables.get(variable)
	}

	forEach(callback: (variable: string, mutator: any, collection: any) => void) {
		this.variables.forEach((mutator, variable) => {
			callback(variable, mutator, this)
		})
	}

	delete(variable: string) {
		return this.variables.delete(variable)
	}

	clear() {
		this.variables.clear()
	}

	getScoped(_scope: any) {
		return this
	}
}

function readJson(filePath: string): any {
	try {
		if (existsSync(filePath)) {
			return JSON.parse(readFileSync(filePath, "utf8"))
		}
	} catch {
		// Return empty object if file doesn't exist
	}
	return {}
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

/**
 * Initialize the VSCode-like context for CLI mode
 */
export function initializeCliContext(config: CliContextConfig = {}) {
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

	console.log(`[CLI] Using data directory: ${DATA_DIR}`)

	// For CLI, extension dir is the root of the project (parent of cli-ts)
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
		name: ClineClient.Cli,

		extension: extension,
		extensionMode: EXTENSION_MODE,

		// Set up KV stores
		globalState: (globalStorage.init("cli") as any) || new MementoStore(path.join(DATA_DIR, "globalState.json")),
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
