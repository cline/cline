import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "fs"
import os from "os"
import path from "path"
import type { Extension, ExtensionContext } from "vscode"
import { ExtensionKind, ExtensionMode } from "vscode"
import { URI } from "vscode-uri"
import { ClineStorage } from "@/core/storage/ClineStorage"
import { CredentialStorage } from "@/core/storage/credential"
import { FileBasedStorage } from "@/core/storage/file"
import { secretStorage } from "@/core/storage/secrets"
import { ExtensionRegistryInfo } from "@/registry"
import { log } from "./utils"
import { DelegatingSecretStore, EnvironmentVariableCollection, MementoStore, readJson, SecretStore } from "./vscode-context-utils"

log("Running standalone cline", ExtensionRegistryInfo.version)
log(`CLINE_ENVIRONMENT: ${process.env.CLINE_ENVIRONMENT}`)
// WE WILL HAVE TO MIGRATE THIS FROM DATA TO v1 LATER
const SETTINGS_SUBFOLDER = "data"

// Module-level vars used by migration/helpers
let STANDALONE_DEPS_WARNING: string | undefined
let SECRETS_FILE: string
let standaloneBackend: ClineStorage | null = null

export function initializeContext(clineDir?: string) {
	const CLINE_DIR = clineDir || process.env.CLINE_DIR || `${os.homedir()}/.cline`
	const DATA_DIR = path.join(CLINE_DIR, SETTINGS_SUBFOLDER)
	const INSTALL_DIR = process.env.INSTALL_DIR || __dirname
	const WORKSPACE_STORAGE_DIR = process.env.WORKSPACE_STORAGE_DIR || path.join(DATA_DIR, "workspace")

	mkdirSync(DATA_DIR, { recursive: true })
	mkdirSync(WORKSPACE_STORAGE_DIR, { recursive: true })
	log("Using settings dir:", DATA_DIR)

	// Initialize the unified secret storage backend for standalone
	SECRETS_FILE = path.join(DATA_DIR, "secrets.json")
	standaloneBackend = selectStandaloneSecrets(DATA_DIR)
	secretStorage.init(standaloneBackend)

	const EXTENSION_DIR = path.join(INSTALL_DIR, "extension")
	const EXTENSION_MODE = process.env.IS_DEV === "true" ? ExtensionMode.Development : ExtensionMode.Production

	// In minimal contexts (e.g., migration tests), the packaged extension assets may not exist.
	// Read package.json best-effort to avoid crashing during migrate-only runs.
	let extensionPackageJson: any
	try {
		const pkgPath = path.join(EXTENSION_DIR, "package.json")
		extensionPackageJson = existsSync(pkgPath) ? readJson(pkgPath) : { name: "cline-standalone", version: "0.0.0" }
	} catch {
		extensionPackageJson = { name: "cline-standalone", version: "0.0.0" }
	}

	const extension: Extension<void> = {
		id: ExtensionRegistryInfo.id,
		isActive: true,
		extensionPath: EXTENSION_DIR,
		extensionUri: URI.file(EXTENSION_DIR),
		packageJSON: extensionPackageJson,
		exports: undefined, // There are no API exports in the standalone version.
		activate: async () => {},
		extensionKind: ExtensionKind.UI,
	}

	const extensionContext: ExtensionContext = {
		extension: extension,
		extensionMode: EXTENSION_MODE,

		// Set up KV stores.
		globalState: new MementoStore(path.join(DATA_DIR, "globalState.json")),
		// Note: core reads/writes secrets via the singleton; context.secrets remains for compatibility
		secrets:
			standaloneBackend instanceof CredentialStorage
				? new DelegatingSecretStore(secretStorage)
				: new SecretStore(SECRETS_FILE),

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

// Select the best standalone secret storage backend
// For now: macOS -> OS keychain; Linux/Windows -> legacy file-based storage
function selectStandaloneSecrets(dataDir: string) {
	try {
		if (process.platform === "darwin") {
			if (hasCommand("security")) {
				return new CredentialStorage()
			} else {
				STANDALONE_DEPS_WARNING = "macOS 'security' tool not available; using file-based secrets"
				return new FileBasedStorage(path.join(dataDir, "secrets.json"))
			}
		}
	} catch (error) {
		log(`Credential backend selection error; falling back to file store: ${String(error)}`)
	}
	// Default: legacy file-based storage on non-macOS
	return new FileBasedStorage(path.join(dataDir, "secrets.json"))
}

function hasCommand(cmd: string): boolean {
	if (process.platform === "win32") {
		return true
	}
	const result = spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" })
	return result.status === 0
}

// Migrate legacy secrets.json to OS credential storage atomically
async function migrateFileSecretsToOS(filePath: string): Promise<void> {
	try {
		const fs = await import("fs")
		if (!fs.existsSync(filePath)) {
			return
		}
		const raw = fs.readFileSync(filePath, "utf-8")
		const data = raw ? (JSON.parse(raw) as Record<string, string>) : {}
		const entries = Object.entries(data).filter(([, v]) => typeof v === "string" && v.length > 0)
		if (entries.length === 0) {
			return fs.unlinkSync(filePath)
		}

		// Parallel pre-check: determine which entries already exist in OS storage
		const existingValues = await Promise.all(entries.map(([key]) => secretStorage.get(key)))
		const preexisting = new Set<string>()
		const toWrite: Array<[string, string]> = []
		for (let i = 0; i < entries.length; i++) {
			const [key, value] = entries[i]
			const existing = existingValues[i]
			if (typeof existing === "string" && existing.length > 0) {
				preexisting.add(key)
			} else {
				toWrite.push([key, value])
			}
		}

		if (toWrite.length === 0) {
			// Everything already present in OS; remove legacy file
			fs.unlinkSync(filePath)
			log("Secrets migration: all entries already present; removed secrets.json")
			return
		}

		// Attempt to write all pending entries atomically: on any failure, roll back successful writes
		const written: string[] = []
		try {
			for (const [key, value] of toWrite) {
				await secretStorage.store(key, value)
				written.push(key)
			}
			// Success: delete legacy file entirely
			fs.unlinkSync(filePath)
			log(`Secrets migration: migrated ${written.length + preexisting.size} entries; removed secrets.json`)
		} catch (error) {
			// Roll back only entries we wrote in this attempt; keep legacy file intact
			for (const key of written) {
				try {
					await secretStorage.delete(key)
				} catch {}
			}
			log(`Secrets migration aborted and rolled back; reason: ${String(error)}`)
		}
	} catch (error) {
		log(`Migration from secrets.json failed or partial (non-fatal): ${String(error)}`)
	}
}

export async function runLegacySecretsMigrationIfNeeded(): Promise<void> {
	try {
		if (process.platform === "darwin" && standaloneBackend instanceof CredentialStorage) {
			log("Starting legacy secrets migration to OS keychain...")
			await migrateFileSecretsToOS(SECRETS_FILE)
			log("Legacy secrets migration completed.")
		} else {
			// Graceful fallback to file-based storage; no migration needed
			log("OS keychain unavailable; using file-based secrets. Skipping migration.")
		}
	} catch (error) {
		log(`Legacy secrets migration error: ${String(error)}`)
	}
}

// Test-only export to directly invoke migration logic without starting services
export const __test_migrateFileSecretsToOS = migrateFileSecretsToOS

// Expose any dependency warning to be shown by the host after initialization
export function getStandaloneDepsWarning(): string | undefined {
	return STANDALONE_DEPS_WARNING
}
