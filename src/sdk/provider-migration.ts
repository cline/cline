/**
 * Provider Migration
 *
 * Wraps the SDK's `ProviderSettingsManager` constructor (which auto-runs
 * the SDK migration for provider data written by earlier Cline versions) with:
 *  - Sentinel file to skip repeated migration attempts
 *  - Error recovery (corrupt files don't crash startup)
 *  - Versioned sentinel for future re-migrations
 *
 * On first launch after the SDK migration, constructing the manager reads
 * the existing `globalState.json` + `secrets.json` and writes provider
 * credentials to `~/.cline/data/settings/providers.json` in the SDK's format.
 *
 * Existing entries in providers.json are never overwritten.
 */

import * as fs from "node:fs"
import * as path from "node:path"

import { ProviderSettingsManager } from "@clinebot/core"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProviderMigrationOptions {
	/** The data directory (~/.cline/data). Required. */
	dataDir: string
	/** Override the providers.json output path. Defaults to <dataDir>/settings/providers.json */
	providersFilePath?: string
}

export interface ProviderMigrationResult {
	/** Whether migration actually ran (false = skipped due to sentinel or no data) */
	ran: boolean
	/** The ProviderSettingsManager instance (always returned, even if migration was skipped) */
	manager: ProviderSettingsManager
	/** If migration was skipped, the reason why */
	skipReason?: "sentinel" | "no-pre-sdk-provider-data" | "error"
	/** Error message if migration failed */
	error?: string
	/** Number of providers found after migration */
	providerCount?: number
	/** Last used provider ID */
	lastUsedProvider?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENTINEL_FILE = "provider-migration-sentinel.json"
const CURRENT_MIGRATION_VERSION = 1

interface SentinelData {
	version: number
	migratedAt: string
	providerCount: number
	lastUsedProvider?: string
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Run the provider migration if it hasn't been done already.
 *
 * This is safe to call multiple times — the sentinel file prevents
 * re-migration. It's also safe if files are missing or corrupt.
 *
 * The SDK's ProviderSettingsManager constructor auto-runs its built-in
 * migration for provider data written by earlier Cline versions when it
 * receives a dataDir.
 * We wrap this with a sentinel to avoid unnecessary work on repeat launches.
 */
export function runProviderMigration(opts: ProviderMigrationOptions): ProviderMigrationResult {
	const { dataDir } = opts
	const providersFilePath = opts.providersFilePath ?? path.join(dataDir, "settings", "providers.json")

	try {
		// Check sentinel — if already migrated, construct manager WITHOUT dataDir
		// so it doesn't re-run the (idempotent but unnecessary) migration
		const sentinel = readSentinel(dataDir)
		if (sentinel && sentinel.version >= CURRENT_MIGRATION_VERSION) {
			fs.mkdirSync(path.dirname(providersFilePath), { recursive: true })
			const manager = new ProviderSettingsManager({ filePath: providersFilePath })
			return { ran: false, manager, skipReason: "sentinel" }
		}

		// Check if there's any provider data written by earlier Cline versions
		// that still needs to be migrated
		const globalStatePath = path.join(dataDir, "globalState.json")
		const secretsPath = path.join(dataDir, "secrets.json")
		if (!fs.existsSync(globalStatePath) && !fs.existsSync(secretsPath)) {
			fs.mkdirSync(path.dirname(providersFilePath), { recursive: true })
			const manager = new ProviderSettingsManager({ filePath: providersFilePath })
			return { ran: false, manager, skipReason: "no-pre-sdk-provider-data" }
		}

		// Ensure the settings directory exists
		fs.mkdirSync(path.dirname(providersFilePath), { recursive: true })

		// Construct ProviderSettingsManager WITH dataDir.
		// The constructor auto-runs the built-in migration for provider data written by
		// earlier Cline versions, which
		// reads globalState.json + secrets.json and writes to providers.json.
		const manager = new ProviderSettingsManager({ filePath: providersFilePath, dataDir })

		// Read back the result to populate our sentinel
		const stored = manager.read()
		const providerIds = Object.keys(stored.providers || {})
		const lastUsed = stored.lastUsedProvider ?? undefined

		// Write sentinel on success
		writeSentinel(dataDir, {
			version: CURRENT_MIGRATION_VERSION,
			migratedAt: new Date().toISOString(),
			providerCount: providerIds.length,
			lastUsedProvider: lastUsed,
		})

		return {
			ran: providerIds.length > 0,
			manager,
			providerCount: providerIds.length,
			lastUsedProvider: lastUsed,
		}
	} catch (err) {
		// Migration failure must NEVER prevent extension startup
		const message = err instanceof Error ? err.message : String(err)
		// Still try to construct a working manager
		try {
			fs.mkdirSync(path.dirname(providersFilePath), { recursive: true })
			const manager = new ProviderSettingsManager({ filePath: providersFilePath })
			return { ran: false, manager, skipReason: "error", error: message }
		} catch {
			// Last resort: create with defaults
			const manager = new ProviderSettingsManager({ filePath: providersFilePath })
			return { ran: false, manager, skipReason: "error", error: message }
		}
	}
}

// ---------------------------------------------------------------------------
// Sentinel helpers
// ---------------------------------------------------------------------------

function getSentinelPath(dataDir: string): string {
	return path.join(dataDir, SENTINEL_FILE)
}

function readSentinel(dataDir: string): SentinelData | null {
	try {
		const sentinelPath = getSentinelPath(dataDir)
		if (!fs.existsSync(sentinelPath)) {
			return null
		}
		const raw = fs.readFileSync(sentinelPath, "utf-8")
		const data = JSON.parse(raw)
		if (typeof data.version === "number") {
			return data as SentinelData
		}
		return null
	} catch {
		return null
	}
}

function writeSentinel(dataDir: string, data: SentinelData): void {
	try {
		const sentinelPath = getSentinelPath(dataDir)
		fs.mkdirSync(path.dirname(sentinelPath), { recursive: true })
		fs.writeFileSync(sentinelPath, JSON.stringify(data, null, 2), "utf-8")
	} catch {
		// Non-fatal: sentinel write failure means migration will re-run next time
		// which is safe because the SDK migration is idempotent (never overwrites)
	}
}

/**
 * Clear the migration sentinel. Useful for testing or forcing re-migration.
 */
export function clearMigrationSentinel(dataDir: string): void {
	try {
		const sentinelPath = getSentinelPath(dataDir)
		if (fs.existsSync(sentinelPath)) {
			fs.unlinkSync(sentinelPath)
		}
	} catch {
		// ignore
	}
}
