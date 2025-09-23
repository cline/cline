import { mkdirSync } from "fs"
import path from "path"
import type { Extension, ExtensionContext } from "vscode"
import { ExtensionKind, ExtensionMode } from "vscode"
import { URI } from "vscode-uri"
// @ts-ignore
import { StandaloneTerminalManager } from "../../standalone/runtime-files/vscode/enhanced-terminal"
import { log } from "./utils"
import { EnvironmentVariableCollection, MementoStore, SecretStore } from "./vscode-context-utils"

function getPackageVersion(): string {
	// Use build-time injected version (only method)
	return process.env.CLINE_VERSION || "unknown"
}

const VERSION = getPackageVersion()
log("Running standalone cline ", VERSION)

function createExtensionContext(clineDir: string): ExtensionContext {
	const DATA_DIR = path.join(clineDir, "data")
	const INSTALL_DIR = process.env.INSTALL_DIR || path.join(clineDir, "core", VERSION)
	mkdirSync(DATA_DIR, { recursive: true })
	log("Using settings dir:", DATA_DIR)

	const EXTENSION_DIR = path.join(INSTALL_DIR, "extension")
	const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

	// Static package.json data for extension context (no filesystem reading)
	function getExtensionPackageJson(): any {
		return {
			name: "claude-dev",
			displayName: "Cline",
			version: VERSION,
			publisher: "saoudrizwan",
		}
	}

	const extension: Extension<void> = {
		id: "saoudrizwan.claude-dev",
		isActive: true,
		extensionPath: EXTENSION_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		packageJSON: getExtensionPackageJson(),
		exports: undefined, // There are no API exports in the standalone version.
		activate: async () => {},
		extensionKind: ExtensionKind.UI,
	}

	const extensionContext: ExtensionContext = {
		extension: extension,
		extensionMode: EXTENSION_MODE,

		// Set up KV stores.
		globalState: new MementoStore(path.join(DATA_DIR, "globalState.json")),
		secrets: new SecretStore(path.join(DATA_DIR, "secrets.json")),

		// Set up URIs.
		storageUri: URI.file(DATA_DIR),
		storagePath: DATA_DIR, // Deprecated, not used in cline.
		globalStorageUri: URI.file(DATA_DIR),
		globalStoragePath: DATA_DIR, // Deprecated, not used in cline.

		logUri: URI.file(DATA_DIR),
		logPath: DATA_DIR, // Deprecated, not used in cline.

		extensionUri: URI.file(EXTENSION_DIR),
		extensionPath: EXTENSION_DIR, // Deprecated, not used in cline.
		asAbsolutePath: (relPath: string) => path.join(EXTENSION_DIR, relPath),

		subscriptions: [], // These need to be destroyed when the extension is deactivated.

		environmentVariableCollection: new EnvironmentVariableCollection(),

		// TODO(sjf): Workspace state needs to be per project/workspace.
		workspaceState: new MementoStore(path.join(DATA_DIR, "workspaceState.json")),
	}

	return extensionContext
}

// Initialize the standalone terminal manager for use by Task instances
const standaloneTerminalManager = new StandaloneTerminalManager()

// Set it as a global so Task constructor can access it
;(global as any).standaloneTerminalManager = standaloneTerminalManager

console.log("Finished loading vscode context...")

export { createExtensionContext }
