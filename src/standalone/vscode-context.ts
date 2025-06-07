import { URI } from "vscode-uri"

import path from "path"
import { mkdirSync } from "fs"
import type { Extension, ExtensionContext } from "vscode"
import { ExtensionKind, ExtensionMode } from "vscode"
import { outputChannel, postMessage } from "./vscode-context-stubs"
import { EnvironmentVariableCollection, MementoStore, readJson, SecretStore } from "./vscode-context-utils"
import { log } from "./utils"

if (!process.env.CLINE_DIR) {
	console.warn("Environment variable CLINE_DIR was not set.")
	process.exit(1)
}
const DATA_DIR = path.join(process.env.CLINE_DIR, "data")
mkdirSync(DATA_DIR, { recursive: true })
log("Using settings dir:", DATA_DIR)

const EXTENSION_DIR = path.join(process.env.CLINE_DIR, "core")
const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

const extension: Extension<void> = {
	id: "saoudrizwan.claude-dev",
	isActive: true,
	extensionPath: EXTENSION_DIR,
	extensionUri: URI.file(EXTENSION_DIR),
	packageJSON: readJson(path.join(EXTENSION_DIR, "package.json")),
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

console.log("Finished loading vscode context...")

export { extensionContext, outputChannel, postMessage }
