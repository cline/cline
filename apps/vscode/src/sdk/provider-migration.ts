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
import type { StateManager } from "@/core/storage/StateManager"
import { resolveDataDir } from "./legacy-state-reader"

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

// ---------------------------------------------------------------------------
// OpenAI Compatible base URL /v1 migration
// ---------------------------------------------------------------------------

function withV1Path(baseUrl: string | undefined): string | undefined {
	const trimmed = baseUrl?.trim()
	if (!trimmed || !URL.canParse(trimmed)) {
		return undefined
	}
	const url = new URL(trimmed)
	if (url.pathname !== "/") {
		return undefined
	}
	url.pathname = "/v1"
	return url.toString().replace(/\/$/, "")
}

/**
 * Earlier extension builds sent requests for a host-only OpenAI Compatible
 * base URL (`https://example.com`) to `<host>/v1`; the URL is now used as
 * entered. Rewrite saved host-only URLs to `/v1` once, so existing setups keep
 * reaching the endpoint they always have. Runs once so a user can still save a
 * host-only URL afterwards.
 *
 * Only the value the extension resolves is rewritten: the legacy state field
 * when set, otherwise providers.json. providers.json is shared with the CLI,
 * which has always used the URL verbatim.
 */
export function migrateOpenAiCompatibleBaseUrlToV1(stateManager: StateManager, dataDir?: string): void {
	if (stateManager.getGlobalStateKey("openAiBaseUrlV1Migrated")) {
		return
	}
	try {
		const stateBaseUrl = stateManager.getGlobalSettingsKey("openAiBaseUrl")
		if (stateBaseUrl?.trim()) {
			const migrated = withV1Path(stateBaseUrl)
			if (migrated) {
				stateManager.setGlobalState("openAiBaseUrl", migrated)
				Logger.log(`[ProviderMigration] OpenAI Compatible base URL ${stateBaseUrl} -> ${migrated}`)
			}
		} else {
			const manager = getProviderSettingsManager(dataDir)
			const settings = manager.getProviderSettings("openai-compatible")
			const migrated = withV1Path(settings?.baseUrl)
			if (settings && migrated) {
				manager.saveProviderSettings({ ...settings, baseUrl: migrated }, { setLastUsed: false })
				Logger.log(`[ProviderMigration] OpenAI Compatible base URL ${settings.baseUrl} -> ${migrated}`)
			}
		}
		stateManager.setGlobalState("openAiBaseUrlV1Migrated", true)
	} catch (error) {
		Logger.error("[ProviderMigration] Failed to migrate OpenAI Compatible base URL:", error)
	}
}
