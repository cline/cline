/**
 * One-time migration from VSCode's ExtensionContext storage to file-backed stores.
 *
 * VSCode historically stored global state, workspace state, and secrets via the
 * ExtensionContext API (backed by SQLite under ~/.vscode/). This module migrates
 * that data to the shared file-backed stores in ~/.cline/data/ so all platforms
 * (VSCode, CLI, JetBrains) share the same persistence layer.
 *
 * ## Migration semantics
 *
 * - **Two independent sentinels** control migration:
 *   - `__migrationVersion` in the file-backed `globalState` gates global state + secrets.
 *   - `__migrationVersion` in the file-backed `workspaceState` gates per-workspace state.
 *   This ensures that when a new workspace is opened for the first time, its workspace
 *   state is still migrated even though globals+secrets were already exported previously.
 *
 * - **Merge strategy: file-backed store wins.** If a key already exists in the
 *   file store (e.g. because CLI or JetBrains wrote it), we do NOT overwrite.
 *   This prevents the migration from clobbering newer data written by another client.
 *
 * - VSCode storage is NOT cleared after migration. This ensures safe downgrade:
 *   if the user rolls back to an older extension version that doesn't know about
 *   file-backed stores, the old code path still works.
 *
 * - taskHistory is NOT migrated here. It uses its own file-based storage
 *   at {globalStorageFsPath}/state/taskHistory.json. Note that for VSCode,
 *   globalStorageFsPath is still the VSCode-managed path (not ~/.cline/data/),
 *   so task history is NOT yet shared across clients.
 *
 *   TODO: Migrate taskHistory.json and task data files ({globalStorageFsPath}/tasks/)
 *   to ~/.cline/data/ so that tasks created in VSCode are visible in CLI/JetBrains
 *   and vice versa. See also: checkpoints at {globalStorageFsPath}/checkpoints/.
 */

import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import type * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { GlobalStateAndSettingKeys, LocalStateKeys, SecretKeys } from "@/shared/storage/state-keys"
import type { StorageContext } from "@/shared/storage/storage-context"

/** Bump this when adding new migration steps. */
const CURRENT_MIGRATION_VERSION = 1

/** Sentinel key written to both globalState and workspaceState to track migration independently. */
const MIGRATION_VERSION_KEY = "__vscodeMigrationVersion"

/** Bump this when MCP settings migration logic changes. Independent of general migration version. */
const CURRENT_MCP_SETTINGS_MIGRATION_VERSION = 1

/** Sentinel key for MCP settings migration */
export const MCP_SETTINGS_MIGRATION_VERSION_KEY = "__mcpSettingsMigrationVersion"

/**
 * Keys that should NOT be migrated from VSCode storage.
 * These are either:
 * - async/computed (taskHistory has its own file)
 * - ephemeral/transient
 */
const SKIP_GLOBAL_STATE_KEYS = new Set<string>([
	"taskHistory", // Already file-based in tasks/taskHistory.json
])

export interface MigrationResult {
	migrated: boolean
	globalStateCount: number
	secretsCount: number
	workspaceStateCount: number
	skippedExisting: number
}

/**
 * Run the one-time migration from VSCode ExtensionContext storage to file-backed stores.
 *
 * Safe to call on every startup — it checks sentinels and returns immediately
 * if migration has already been completed at the current version.
 *
 * Global state and secrets share one sentinel (in globalState file store).
 * Workspace state has its own sentinel (in workspaceState file store) so that
 * each new workspace gets migrated independently.
 *
 * @param vscodeContext The VSCode ExtensionContext (source of truth for legacy data)
 * @param storage The file-backed StorageContext (destination)
 * @returns Summary of what was migrated
 */
export async function exportVSCodeStorageToSharedFiles(
	vscodeContext: vscode.ExtensionContext,
	storage: StorageContext,
): Promise<MigrationResult> {
	const result: MigrationResult = {
		migrated: false,
		globalStateCount: 0,
		secretsCount: 0,
		workspaceStateCount: 0,
		skippedExisting: 0,
	}

	// Check sentinels independently
	const globalVersion = storage.globalState.get<number>(MIGRATION_VERSION_KEY)
	const workspaceVersion = storage.workspaceState.get<number>(MIGRATION_VERSION_KEY)
	const mcpSettingsVersion = storage.globalState.get<number>(MCP_SETTINGS_MIGRATION_VERSION_KEY)

	const needGlobalMigration = globalVersion === undefined || globalVersion < CURRENT_MIGRATION_VERSION
	const needWorkspaceMigration = workspaceVersion === undefined || workspaceVersion < CURRENT_MIGRATION_VERSION
	const needMcpSettingsMigration =
		mcpSettingsVersion === undefined || mcpSettingsVersion < CURRENT_MCP_SETTINGS_MIGRATION_VERSION

	if (!needGlobalMigration && !needWorkspaceMigration && !needMcpSettingsMigration) {
		Logger.info(
			`[Migration] File-backed stores already current (global: v${globalVersion}, workspace: v${workspaceVersion}, mcpSettings: v${mcpSettingsVersion}), skipping.`,
		)
		return result
	}

	Logger.info(
		`[Migration] Starting VSCode → file-backed migration (global: ${globalVersion ?? "none"}, workspace: ${workspaceVersion ?? "none"}, target: ${CURRENT_MIGRATION_VERSION})`,
	)

	try {
		// ─── 1. Migrate global state + secrets (if needed) ─────────────
		if (needGlobalMigration) {
			// Batch global state keys
			const globalStateBatch: Record<string, any> = {}
			for (const key of GlobalStateAndSettingKeys) {
				if (SKIP_GLOBAL_STATE_KEYS.has(key)) {
					continue
				}

				const vscodeValue = vscodeContext.globalState.get(key)
				if (vscodeValue === undefined) {
					continue
				}

				const existingFileValue = storage.globalState.get(key)
				if (existingFileValue !== undefined) {
					result.skippedExisting++
					continue
				}

				globalStateBatch[key] = vscodeValue
				result.globalStateCount++
			}

			// Add sentinel to batch
			globalStateBatch[MIGRATION_VERSION_KEY] = CURRENT_MIGRATION_VERSION

			// Write all global state in one operation
			storage.globalState.setBatch(globalStateBatch)

			// Batch secrets
			const secretsBatch: Record<string, string> = {}
			for (const key of SecretKeys) {
				try {
					const vscodeValue = await vscodeContext.secrets.get(key)
					if (vscodeValue === undefined || vscodeValue === "") {
						continue
					}

					const existingFileValue = storage.secrets.get(key)
					if (existingFileValue !== undefined && existingFileValue !== "") {
						result.skippedExisting++
						continue
					}

					secretsBatch[key] = vscodeValue
					result.secretsCount++
				} catch (error) {
					Logger.error(`[Migration] Failed to read secret '${key}' from VSCode:`, error)
				}
			}

			// Write all secrets in one operation
			storage.secrets.setBatch(secretsBatch)
		}

		// ─── 2. Migrate workspace state (if needed) ────────────────────
		if (needWorkspaceMigration) {
			// Batch workspace state keys
			const workspaceStateBatch: Record<string, any> = {}
			for (const key of LocalStateKeys) {
				const vscodeValue = vscodeContext.workspaceState.get(key)
				if (vscodeValue === undefined) {
					continue
				}

				const existingFileValue = storage.workspaceState.get(key)
				if (existingFileValue !== undefined) {
					result.skippedExisting++
					continue
				}

				workspaceStateBatch[key] = vscodeValue
				result.workspaceStateCount++
			}

			// Add sentinel to batch
			workspaceStateBatch[MIGRATION_VERSION_KEY] = CURRENT_MIGRATION_VERSION

			// Write all workspace state in one operation
			storage.workspaceState.setBatch(workspaceStateBatch)
		}

		// ─── 3. Migrate MCP settings file (if needed) ───────────────────
		if (needMcpSettingsMigration) {
			try {
				const srcPath = path.join(vscodeContext.globalStorageUri.fsPath, "settings", "cline_mcp_settings.json")
				const destDir = path.join(storage.dataDir, "settings")
				const destPath = path.join(destDir, "cline_mcp_settings.json")

				// Skip if source and destination are the same path (CLI case)
				const isSamePath = path.resolve(srcPath) === path.resolve(destPath)
				const sourceExists = !isSamePath && (await fileExistsAtPath(srcPath))

				if (sourceExists) {
					// Check if destination already has servers
					const destHasServers = await mcpFileHasServers(destPath)

					if (!destHasServers) {
						await fs.mkdir(destDir, { recursive: true })
						await fs.copyFile(srcPath, destPath)
						Logger.info(`[McpMigration] Migrated MCP settings from ${srcPath} to ${destPath}`)
					} else {
						Logger.info("[McpMigration] Shared MCP settings already has servers configured, skipping.")
					}
				}
			} catch (error) {
				// Non-fatal — MCP settings will start fresh if migration fails.
				Logger.error("[McpMigration] Failed to migrate MCP settings file:", error)
			}

			storage.globalState.update(MCP_SETTINGS_MIGRATION_VERSION_KEY, CURRENT_MCP_SETTINGS_MIGRATION_VERSION)
		}

		result.migrated = true

		Logger.info(
			`[Migration] Complete: ${result.globalStateCount} global state keys, ` +
				`${result.secretsCount} secrets, ${result.workspaceStateCount} workspace state keys migrated. ` +
				`${result.skippedExisting} keys skipped (already in file store).`,
		)
	} catch (error) {
		Logger.error("[Migration] Fatal error during VSCode → file-backed migration:", error)
		// Don't write sentinel on failure — migration will retry next startup
		throw error
	}

	return result
}

/** Returns true if the file exists and contains at least one MCP server entry. */
async function mcpFileHasServers(filePath: string): Promise<boolean> {
	try {
		if (!(await fileExistsAtPath(filePath))) {
			return false
		}
		const data = JSON.parse(await fs.readFile(filePath, "utf8"))
		return !!(data?.mcpServers && Object.keys(data.mcpServers).length > 0)
	} catch (error) {
		Logger.error("[McpMigration] Failed to parse MCP settings file, treating as empty:", error)
		return false
	}
}
