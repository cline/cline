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

import type * as vscode from "vscode"
import { type AutoApprovalSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { Logger } from "@/shared/services/Logger"
import { GlobalStateAndSettingKeys, LocalStateKeys, SecretKeys } from "@/shared/storage/state-keys"
import type { StorageContext } from "@/shared/storage/storage-context"
import { migrateLegacyMcpSettings } from "./mcp-settings-legacy-migration"

/** Version 1 exported VSCode memento/secrets/workspace state to file-backed stores. */
const FILE_BACKED_STORAGE_EXPORT_VERSION = 1

/** Version 2 imports legacy MCP settings files into the shared SDK/CLI settings path. */
const MCP_SETTINGS_MIGRATION_VERSION = 2

/**
 * Version 3 folds the removed "YOLO mode" / "auto-approve all" toggles into the
 * auto-approval settings: users who ran unattended keep running unattended.
 */
const YOLO_MODE_MIGRATION_VERSION = 3

/** Bump this when adding new migration steps. */
const CURRENT_MIGRATION_VERSION = YOLO_MODE_MIGRATION_VERSION

/** Sentinel key written to both globalState and workspaceState to track migration independently. */
const MIGRATION_VERSION_KEY = "__vscodeMigrationVersion"

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
	mcpServersAdded: number
	mcpServersSkippedExisting: number
	/** True when a legacy YOLO / auto-approve-all toggle was folded into autoApprovalSettings. */
	yoloModeMigrated: boolean
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
		mcpServersAdded: 0,
		mcpServersSkippedExisting: 0,
		yoloModeMigrated: false,
	}

	// Check sentinels independently
	const globalVersion = storage.globalState.get<number>(MIGRATION_VERSION_KEY)
	const workspaceVersion = storage.workspaceState.get<number>(MIGRATION_VERSION_KEY)

	const needGlobalMigration = globalVersion === undefined || globalVersion < FILE_BACKED_STORAGE_EXPORT_VERSION
	const needWorkspaceMigration = workspaceVersion === undefined || workspaceVersion < FILE_BACKED_STORAGE_EXPORT_VERSION
	const needMcpSettingsMigration = globalVersion === undefined || globalVersion < MCP_SETTINGS_MIGRATION_VERSION
	const needYoloModeMigration = globalVersion === undefined || globalVersion < YOLO_MODE_MIGRATION_VERSION

	if (!needGlobalMigration && !needWorkspaceMigration && !needMcpSettingsMigration && !needYoloModeMigration) {
		Logger.info(
			`[Migration] File-backed stores already current (global: v${globalVersion}, workspace: v${workspaceVersion}), skipping.`,
		)
		return result
	}

	Logger.info(
		`[Migration] Starting VSCode → file-backed migration (global: ${globalVersion ?? "none"}, workspace: ${workspaceVersion ?? "none"}, target: ${CURRENT_MIGRATION_VERSION})`,
	)

	try {
		// ─── 0. Migrate legacy MCP settings files (if needed) ───────────
		if (needMcpSettingsMigration) {
			const mcpMigration = await migrateLegacyMcpSettings(vscodeContext, storage)
			result.mcpServersAdded = mcpMigration.serversAdded
			result.mcpServersSkippedExisting = mcpMigration.serversSkippedExisting
		}

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

			// Add sentinel to batch. This advances straight to CURRENT because the
			// v2 MCP migration already ran above when needed.
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

		// ─── 1b. Fold removed YOLO / auto-approve-all toggles into
		//         autoApprovalSettings (if needed) ───────────────────────
		if (needYoloModeMigration) {
			result.yoloModeMigrated = migrateYoloModeToAutoApprovalSettings(vscodeContext, storage)
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

			// Add sentinel to batch. This advances straight to CURRENT because any
			// global v2-only migrations already ran above when needed.
			workspaceStateBatch[MIGRATION_VERSION_KEY] = CURRENT_MIGRATION_VERSION

			// Write all workspace state in one operation
			storage.workspaceState.setBatch(workspaceStateBatch)
		}

		// If the original v1 export was already complete, still advance sentinels
		// for this workspace after the v2/v3 migration attempts so future startups
		// don't re-run them. New workspaces still have no workspace sentinel and will
		// get their v1 workspace-state export when first opened.
		if (!needGlobalMigration && (needMcpSettingsMigration || needYoloModeMigration)) {
			storage.globalState.update(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION)
		}
		if (!needWorkspaceMigration && (needMcpSettingsMigration || needYoloModeMigration)) {
			storage.workspaceState.set(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION)
		}

		result.migrated =
			needGlobalMigration ||
			needWorkspaceMigration ||
			needMcpSettingsMigration ||
			needYoloModeMigration ||
			result.mcpServersAdded > 0

		Logger.info(
			`[Migration] Complete: ${result.globalStateCount} global state keys, ` +
				`${result.secretsCount} secrets, ${result.workspaceStateCount} workspace state keys migrated. ` +
				`${result.skippedExisting} keys skipped (already in file store). ` +
				`Legacy MCP migration added ${result.mcpServersAdded} server(s), skipped ${result.mcpServersSkippedExisting} existing server(s).`,
		)
	} catch (error) {
		Logger.error("[Migration] Fatal error during VSCode → file-backed migration:", error)
		// Don't write sentinel on failure — migration will retry next startup
		throw error
	}

	return result
}

/**
 * The "YOLO mode" and "auto-approve all" toggles were removed: both were blanket
 * "run without asking" switches that bypassed the per-action auto-approval
 * settings. To keep previously-unattended setups unattended, a user who had
 * either toggle enabled gets every auto-approval action enabled instead.
 *
 * Reads consider both stores: the file store wins when it has an explicit value
 * (matching the export's merge semantics — e.g. a user who turned YOLO off in
 * the SDK extension must not be re-migrated from a stale VSCode `true`), and the
 * VSCode memento covers legacy-extension users whose value was never exported
 * (the keys are no longer part of GlobalStateAndSettingKeys).
 *
 * The dead keys are intentionally left in place: current builds no longer read
 * them (the state loader only visits known keys), and the file store is shared
 * with older builds that still do — deleting the value would flip YOLO off for
 * a user who downgrades. Same downgrade-safety rule as the v1 export.
 *
 * @returns true when the toggles were folded into autoApprovalSettings
 */
function migrateYoloModeToAutoApprovalSettings(vscodeContext: vscode.ExtensionContext, storage: StorageContext): boolean {
	const readRemovedToggle = (key: string): boolean => {
		const fileValue = storage.globalState.get(key)
		const effective = fileValue !== undefined ? fileValue : vscodeContext.globalState.get(key)
		return effective === true
	}

	const shouldEnableAllActions = readRemovedToggle("yoloModeToggled") || readRemovedToggle("autoApproveAllToggled")

	if (shouldEnableAllActions) {
		const existing = storage.globalState.get<AutoApprovalSettings>("autoApprovalSettings") ?? DEFAULT_AUTO_APPROVAL_SETTINGS
		const migrated: AutoApprovalSettings = {
			...existing,
			version: (existing.version ?? 1) + 1,
			actions: {
				...existing.actions,
				readFiles: true,
				readFilesExternally: true,
				editFiles: true,
				editFilesExternally: true,
				executeSafeCommands: true,
				executeAllCommands: true,
				useBrowser: true,
				useMcp: true,
			},
		}
		storage.globalState.update("autoApprovalSettings", migrated)
		Logger.info("[Migration] Legacy YOLO/auto-approve-all toggle detected — enabled all auto-approval actions")
	}

	return shouldEnableAllActions
}
