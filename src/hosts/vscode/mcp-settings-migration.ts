/**
 * Forked from vscode-to-file-migration.ts to allow independent versioning and re-running of
 * MCP settings migration without affecting global/workspace state migration.
 *
 * One-time migration of MCP settings from VSCode's host-specific storage path
 * to the shared ~/.cline/data/settings/ directory.
 *
 * This runs independently of the global/workspace state migration in
 * vscode-to-file-migration.ts, using its own sentinel key so it can be
 * version-bumped and re-triggered independently.
 */

import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import * as path from "path"
import type * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import type { StorageContext } from "@/shared/storage/storage-context"

/** Bump this to re-run MCP settings migration for all users. */
export const CURRENT_MCP_SETTINGS_MIGRATION_VERSION = 1

/** Sentinel key stored in globalState to track MCP settings migration. */
export const MCP_SETTINGS_MIGRATION_VERSION_KEY = "__mcpSettingsMigrationVersion"

/**
 * Migrate MCP settings file from the old VSCode-specific path to ~/.cline/data/settings/.
 *
 * Safe to call on every startup — checks a version sentinel and returns immediately
 * if migration has already been completed at the current version.
 *
 * @param vscodeContext The VSCode ExtensionContext (provides globalStorageUri for source path)
 * @param storage The file-backed StorageContext (provides dataDir and globalState for sentinel)
 * @returns true if migration was performed, false if skipped.
 */
export async function migrateMcpSettings(vscodeContext: vscode.ExtensionContext, storage: StorageContext): Promise<boolean> {
	const mcpSettingsVersion = storage.globalState.get<number>(MCP_SETTINGS_MIGRATION_VERSION_KEY)
	const needMigration = mcpSettingsVersion === undefined || mcpSettingsVersion < CURRENT_MCP_SETTINGS_MIGRATION_VERSION

	if (!needMigration) {
		return false
	}

	try {
		const srcPath = path.join(vscodeContext.globalStorageUri.fsPath, "settings", "cline_mcp_settings.json")
		const destDir = path.join(storage.dataDir, "settings")
		const destPath = path.join(destDir, "cline_mcp_settings.json")

		// Skip if source and destination are the same path (CLI case)
		const isSamePath = path.resolve(srcPath) === path.resolve(destPath)
		const sourceExists = !isSamePath && (await fileExistsAtPath(srcPath))

		if (sourceExists) {
			// Check if destination already has servers (destination wins)
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
	return true
}

/** Returns true if the file exists and contains at least one MCP server entry. */
export async function mcpFileHasServers(filePath: string): Promise<boolean> {
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
