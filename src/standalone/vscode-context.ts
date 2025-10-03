import * as fs from "node:fs"
import os from "os"
import path from "path"
import type { Extension, ExtensionContext } from "vscode"
import { ExtensionKind, ExtensionMode } from "vscode"
import { URI } from "vscode-uri"
import { ExtensionRegistryInfo } from "@/registry"
import { log } from "./utils"
import { EnvironmentVariableCollection, MementoStore, SecretStore } from "./vscode-context-utils"

log("Running standalone cline", ExtensionRegistryInfo.version)
log(`CLINE_ENVIRONMENT: ${process.env.CLINE_ENVIRONMENT}`)

// WE WILL HAVE TO MIGRATE THIS FROM DATA TO v1 LATER
const SETTINGS_SUBFOLDER = "data"

/**
 * TEMPORARY WORKAROUND: Load package.json with fallback to bundled metadata
 *
 * This is a temporary hack to allow cline-core to start without requiring the full
 * extension directory to be present. This is needed because:
 * 1. The CLI runs cline-core directly from dist-standalone/
 * 2. The extension/ directory is only available in the packaged standalone.zip
 * 3. For development/testing, we don't want to extract the zip every time
 *
 * TODO: Remove this once we have proper packaging for the CLI release.
 * The proper solution is to either:
 * - Have the CLI extract/install from standalone.zip before running
 * - Or restructure the standalone build to not require the extension/ directory
 */
function loadPackageJsonWithFallback(extensionDir: string): any {
	const packageJsonPath = path.join(extensionDir, "package.json")

	try {
		return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
	} catch (error) {
		log(`Warning: Could not read extension package.json from ${packageJsonPath}, using bundled metadata`)
		log(`Error: ${error}`)

		// Fallback to minimal package.json constructed from bundled ExtensionRegistryInfo
		return {
			name: ExtensionRegistryInfo.name,
			version: ExtensionRegistryInfo.version,
			publisher: ExtensionRegistryInfo.publisher,
			displayName: "Cline",
			description: "Autonomous coding agent",
			contributes: {
				commands: Object.values(ExtensionRegistryInfo.commands).map((id) => ({ command: id })),
				views: ExtensionRegistryInfo.views,
			},
		}
	}
}

export function initializeContext(clineDir?: string) {
	const CLINE_DIR = clineDir || process.env.CLINE_DIR || `${os.homedir()}/.cline`
	const DATA_DIR = path.join(CLINE_DIR, SETTINGS_SUBFOLDER)
	const INSTALL_DIR = process.env.INSTALL_DIR || __dirname
	const WORKSPACE_STORAGE_DIR = process.env.WORKSPACE_STORAGE_DIR || path.join(DATA_DIR, "workspace")

	fs.mkdirSync(DATA_DIR, { recursive: true })
	fs.mkdirSync(WORKSPACE_STORAGE_DIR, { recursive: true })
	log("Using settings dir:", DATA_DIR)

	const EXTENSION_DIR = path.join(INSTALL_DIR, "extension")
	const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

	const extension: Extension<void> = {
		id: ExtensionRegistryInfo.id,
		isActive: true,
		extensionPath: EXTENSION_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		packageJSON: loadPackageJsonWithFallback(EXTENSION_DIR),
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
		storageUri: URI.file(WORKSPACE_STORAGE_DIR),
		storagePath: WORKSPACE_STORAGE_DIR, // Deprecated, not used in cline.
		globalStorageUri: URI.file(DATA_DIR),
		globalStoragePath: DATA_DIR, // Deprecated, not used in cline.

		// Logs are global per extension, not per workspace.
		logUri: URI.file(DATA_DIR),
		logPath: DATA_DIR, // Deprecated, not used in cline.

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
		extensionContext,
		DATA_DIR,
		EXTENSION_DIR,
	}
}
