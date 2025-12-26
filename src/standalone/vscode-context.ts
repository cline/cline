import { mkdirSync } from "node:fs"
import os from "os"
import path from "path"
import type { Extension, ExtensionContext } from "vscode"
import { ExtensionKind, ExtensionMode } from "vscode"
import { URI } from "vscode-uri"
import { ExtensionRegistryInfo } from "@/registry"
import { log } from "./utils"
import { EnvironmentVariableCollection, MementoStore, readJson, SecretStore } from "./vscode-context-utils"

log("Running standalone cline", ExtensionRegistryInfo.version)
log(`CLINE_ENVIRONMENT: ${process.env.CLINE_ENVIRONMENT}`)

export type ClineDirs = {
	SETTINGS_DIR: string
	WORKSPACE_STORAGE_DIR: string
	GLOBAL_STORAGE_DIR: string
	EXTENSION_DIR: string
	context: any
}

export function initializeContext(clineDir?: string): ClineDirs {
	const CLINE_DIR = clineDir || process.env.CLINE_DIR || `${os.homedir()}/.cline`
	const SETTINGS_DIR = path.join(CLINE_DIR, "data")
	const WORKSPACE_STORAGE_DIR = process.env.WORKSPACE_STORAGE_DIR || path.join(SETTINGS_DIR, "workspace")
	const GLOBAL_STORAGE_DIR = SETTINGS_DIR
	const EXTENSION_DIR = path.join(process.env.INSTALL_DIR || __dirname, "extension")

	mkdirSync(SETTINGS_DIR, { recursive: true })
	mkdirSync(WORKSPACE_STORAGE_DIR, { recursive: true })
	log("Using settings dir:", SETTINGS_DIR)

	const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

	const extension: Extension<void> = {
		id: ExtensionRegistryInfo.id,
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
		globalState: new MementoStore(path.join(SETTINGS_DIR, "globalState.json")),
		secrets: new SecretStore(path.join(SETTINGS_DIR, "secrets.json")),

		// Set up URIs.
		storageUri: URI.file(WORKSPACE_STORAGE_DIR),
		storagePath: WORKSPACE_STORAGE_DIR, // Deprecated, not used in cline.
		globalStorageUri: URI.file(SETTINGS_DIR),
		globalStoragePath: SETTINGS_DIR, // Deprecated, not used in cline.

		// Logs are global per extension, not per workspace.
		logUri: URI.file(SETTINGS_DIR),
		logPath: SETTINGS_DIR, // Deprecated, not used in cline.

		extensionUri: URI.file(EXTENSION_DIR),
		extensionPath: EXTENSION_DIR, // Deprecated, not used in cline.
		asAbsolutePath: (relPath: string) => path.join(EXTENSION_DIR, relPath),

		subscriptions: [], // These need to be destroyed when the extension is deactivated.

		environmentVariableCollection: new EnvironmentVariableCollection(),

		// Workspace state is per project/workspace when WORKSPACE_STORAGE_DIR is provided by the host.
		workspaceState: new MementoStore(path.join(WORKSPACE_STORAGE_DIR, "workspaceState.json")),
	}

	log("Finished loading vscode context...")

	return {
		context: extensionContext,
		SETTINGS_DIR,
		WORKSPACE_STORAGE_DIR,
		GLOBAL_STORAGE_DIR,
		EXTENSION_DIR,
	}
}
