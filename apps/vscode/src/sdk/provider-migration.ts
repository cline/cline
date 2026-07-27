// Replaces classic provider credential management (see origin/main)
//
// Uses the SDK's ProviderSettingsManager and migrateLegacyProviderSettings
// to migrate existing on-disk credentials from globalState.json + secrets.json
// to the SDK's providers.json format.
//
// The SDK handles:
// - Reading globalState.json and secrets.json
// - Mapping 30+ provider fields to SDK format
// - Never overwriting existing entries
// - Tagging migrated entries with tokenSource: "migration"
// - Auto-migration on ProviderSettingsManager construction

import path from "node:path"
import { ProviderSettingsManager } from "@cline/core"
import { Logger } from "@shared/services/Logger"
import { resolveDataDir } from "./legacy-state-reader"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of the provider migration process */
export interface ProviderMigrationResult {
	/** Whether any providers were migrated */
	migrated: boolean
	/** Total number of providers after migration */
	providerCount: number
	/** The last-used provider ID */
	lastUsedProvider?: string
}

// ---------------------------------------------------------------------------
// Provider migration
// ---------------------------------------------------------------------------

/**
 * Run provider migration using the SDK's ProviderSettingsManager.
 *
 * The SDK's constructor automatically calls migrateLegacyProviderSettings()
 * when a dataDir is provided or can be inferred. This function wraps that
 * process and returns a typed result.
 *
 * Migration is idempotent — calling it multiple times is safe because the SDK
 * never overwrites existing provider entries.
 *
 * @param dataDir Override for the Cline data directory. Defaults to
 *   resolveDataDir() which checks CLINE_DATA_DIR, CLINE_DIR, then ~/.cline/data.
 * @returns Migration result indicating what happened
 */
export function migrateProviders(dataDir?: string): ProviderMigrationResult {
	const resolvedDataDir = dataDir ?? resolveDataDir()

	try {
		// ProviderSettingsManager auto-migrates on construction when dataDir
		// is provided or can be inferred from the filePath.
		// The migration reads globalState.json + secrets.json and writes
		// providers.json, never overwriting existing entries.
		// We must set filePath explicitly so the manager reads/writes within
		// the correct dataDir, not the default ~/.cline/data.
		const filePath = path.join(resolvedDataDir, "settings", "providers.json")
		const manager = new ProviderSettingsManager({ filePath, dataDir: resolvedDataDir })

		const state = manager.read()
		const lastUsed = manager.getLastUsedProviderSettings()

		const result: ProviderMigrationResult = {
			migrated: Object.values(state.providers).some((p) => p.tokenSource === "migration"),
			providerCount: Object.keys(state.providers).length,
			lastUsedProvider: state.lastUsedProvider ?? lastUsed?.provider,
		}

		Logger.log(
			`[ProviderMigration] Migration complete: ${result.providerCount} providers, lastUsed=${result.lastUsedProvider ?? "none"}, migrated=${result.migrated}`,
		)

		return result
	} catch (error) {
		Logger.error("[ProviderMigration] Failed to migrate providers:", error)
		return {
			migrated: false,
			providerCount: 0,
		}
	}
}

// ---------------------------------------------------------------------------
// Provider settings access (cached singleton)
// ---------------------------------------------------------------------------

let _cachedManager: ProviderSettingsManager | null = null
let _cachedDataDir: string | null = null

/**
 * Get the ProviderSettingsManager singleton for the given data directory.
 *
 * Construction triggers auto-migration if needed, so this is the primary
 * way to access provider settings throughout the SDK adapter layer.
 *
 * The instance is cached so all callers share the same in-memory state.
 * Pass a different dataDir to force a new instance (e.g. in tests).
 */
export function getProviderSettingsManager(dataDir?: string): ProviderSettingsManager {
	const resolvedDataDir = dataDir ?? resolveDataDir()
	if (_cachedManager && _cachedDataDir === resolvedDataDir) {
		return _cachedManager
	}
	const filePath = path.join(resolvedDataDir, "settings", "providers.json")
	_cachedManager = new ProviderSettingsManager({ filePath, dataDir: resolvedDataDir })
	_cachedDataDir = resolvedDataDir
	return _cachedManager
}

/**
 * Record the given provider as `lastUsedProvider` in providers.json.
 *
 * The extension's active provider lives in StateManager (globalState.json);
 * providers.json is the SDK-side store shared with the CLI and other hosts.
 * Nothing else reconciles the two, so provider switches and session starts
 * must call this to keep providers.json from going stale — a stale
 * lastUsedProvider is what the session-factory fallback (and fresh CLI
 * sessions) silently run on.
 *
 * Accepts either the extension's legacy spelling (e.g. `openai`) or the SDK
 * spelling (e.g. `openai-compatible`). Best-effort: failures are logged and
 * never propagate into caller flows.
 */
export function setLastUsedProvider(providerId: string, dataDir?: string): void {
	const sdkProviderId = toSdkProviderId(providerId).trim()
	if (!sdkProviderId) {
		return
	}
	try {
		const manager = getProviderSettingsManager(dataDir)
		const state = manager.read()
		if (state.lastUsedProvider === sdkProviderId) {
			return
		}
		manager.write({ ...state, lastUsedProvider: sdkProviderId })
	} catch (error) {
		Logger.warn(`[ProviderMigration] Failed to record last-used provider ${providerId}:`, error)
	}
}
