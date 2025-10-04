/**
 * State migrations for Cline extension
 * Handles migration of data structures between versions
 */

import { HistoryItem } from "@shared/HistoryItem"
import fs from "fs/promises"
import path from "path"
import { ExtensionContext } from "vscode"
import { getTaskHistoryStateFilePath, readTaskHistoryFromState, taskHistoryStateFileExists } from "./disk"

const MIGRATION_VERSION_KEY = "taskHistoryMigrationVersion"
const CURRENT_MIGRATION_VERSION = 1

/**
 * Validate that task history data is well-formed
 */
function validateTaskHistory(data: any[]): boolean {
	if (!Array.isArray(data)) {
		return false
	}

	// Check if each item has required fields
	for (const item of data) {
		if (!item.id || !item.ts || typeof item.ts !== "number") {
			return false
		}
	}

	return true
}

/**
 * Create a backup of the taskHistory file before migration
 */
async function backupTaskHistoryFile(): Promise<string | null> {
	try {
		const originalPath = await getTaskHistoryStateFilePath()
		const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "")
		const backupPath = `${originalPath}.backup-${timestamp}`

		await fs.copyFile(originalPath, backupPath)
		console.log(`[Migration] Created backup at: ${backupPath}`)
		return backupPath
	} catch (error) {
		console.error("[Migration] Failed to create backup:", error)
		return null
	}
}

/**
 * Pre-check: Validate migration can proceed safely
 */
async function performPreMigrationCheck(context: ExtensionContext): Promise<{
	canProceed: boolean
	oldFileExists: boolean
	oldTaskHistory: HistoryItem[]
	validationErrors: string[]
}> {
	const result = {
		canProceed: false,
		oldFileExists: false,
		oldTaskHistory: [] as HistoryItem[],
		validationErrors: [] as string[],
	}

	try {
		// Check if old file exists
		result.oldFileExists = await taskHistoryStateFileExists()

		if (!result.oldFileExists) {
			result.canProceed = true // No data to migrate, safe to proceed
			return result
		}

		// Read and validate old data
		const oldData = await readTaskHistoryFromState()

		if (!validateTaskHistory(oldData)) {
			result.validationErrors.push("Old taskHistory file contains invalid data structure")
			return result
		}

		result.oldTaskHistory = oldData

		// Validate workspace state is accessible
		try {
			const testValue = context.workspaceState.get<any>("__migration_test__")
			await context.workspaceState.update("__migration_test__", null)
		} catch (error) {
			result.validationErrors.push(`Workspace state is not accessible: ${error}`)
			return result
		}

		// All checks passed
		result.canProceed = true
		return result
	} catch (error) {
		result.validationErrors.push(`Pre-check failed: ${error}`)
		return result
	}
}

/**
 * Migrate taskHistory from global file-based storage to VSCode workspace state
 * This fixes the conversation history loss issue by properly isolating task history per workspace
 *
 * Includes:
 * - Pre-migration validation
 * - Automatic backup before migration
 * - Safe merge strategy (no data loss)
 * - Idempotent (safe to re-run)
 * - Comprehensive error handling
 *
 * @param context VSCode extension context
 */
export async function migrateTaskHistoryToWorkspaceState(context: ExtensionContext): Promise<void> {
	const migrationVersion = context.globalState.get<number>(MIGRATION_VERSION_KEY, 0)

	if (migrationVersion >= CURRENT_MIGRATION_VERSION) {
		// Already migrated
		console.log("[Migration] taskHistory migration already completed (v" + migrationVersion + ")")
		return
	}

	console.log("[Migration] Starting taskHistory migration to workspace state...")
	console.log("[Migration] Current migration version: " + migrationVersion)
	console.log("[Migration] Target migration version: " + CURRENT_MIGRATION_VERSION)

	try {
		// Step 1: Pre-migration check
		console.log("[Migration] Step 1: Running pre-migration checks...")
		const preCheck = await performPreMigrationCheck(context)

		if (!preCheck.canProceed) {
			console.error("[Migration] Pre-migration check failed:", preCheck.validationErrors)
			console.error("[Migration] Migration aborted. Extension will continue with current state.")
			// Don't mark as migrated so we can try again later
			return
		}

		if (!preCheck.oldFileExists) {
			// No old data to migrate, mark as complete
			await context.globalState.update(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION)
			console.log("[Migration] No old taskHistory file found, migration complete")
			return
		}

		const oldTaskHistory = preCheck.oldTaskHistory

		if (oldTaskHistory.length === 0) {
			// Empty history, nothing to migrate
			await context.globalState.update(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION)
			console.log("[Migration] Old taskHistory was empty, migration complete")
			return
		}

		console.log(`[Migration] Found ${oldTaskHistory.length} tasks in old format`)

		// Step 2: Create backup
		console.log("[Migration] Step 2: Creating backup...")
		const backupPath = await backupTaskHistoryFile()

		if (!backupPath) {
			console.warn("[Migration] Failed to create backup, but continuing with migration")
			console.warn("[Migration] Original file will be preserved in place")
		}

		// Step 3: Read current workspace state
		console.log("[Migration] Step 3: Reading current workspace state...")
		const currentWorkspaceHistory = context.workspaceState.get<HistoryItem[]>("taskHistory", [])
		console.log(`[Migration] Current workspace has ${currentWorkspaceHistory.length} tasks`)

		// Step 4: Merge data
		console.log("[Migration] Step 4: Merging task histories...")
		const mergedHistory = [...currentWorkspaceHistory]
		const existingIds = new Set(currentWorkspaceHistory.map((item) => item.id))
		let addedCount = 0

		for (const item of oldTaskHistory) {
			if (!existingIds.has(item.id)) {
				mergedHistory.push(item)
				addedCount++
			}
		}

		console.log(`[Migration] Added ${addedCount} new tasks from global history`)
		console.log(`[Migration] Total tasks after merge: ${mergedHistory.length}`)

		// Sort by timestamp (most recent first)
		mergedHistory.sort((a, b) => b.ts - a.ts)

		// Step 5: Write to workspace state
		console.log("[Migration] Step 5: Writing to workspace state...")
		await context.workspaceState.update("taskHistory", mergedHistory)
		console.log("[Migration] Successfully wrote to workspace state")

		// Step 6: Mark migration as complete
		console.log("[Migration] Step 6: Marking migration as complete...")
		await context.globalState.update(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION)

		console.log("[Migration] ✅ Migration completed successfully!")
		console.log("[Migration] Summary:")
		console.log(`[Migration]   - Old global tasks: ${oldTaskHistory.length}`)
		console.log(`[Migration]   - Workspace tasks: ${currentWorkspaceHistory.length}`)
		console.log(`[Migration]   - Tasks added: ${addedCount}`)
		console.log(`[Migration]   - Total after merge: ${mergedHistory.length}`)
		if (backupPath) {
			console.log(`[Migration]   - Backup created: ${path.basename(backupPath)}`)
		}
		console.log("[Migration]   - Original file preserved for rollback")
	} catch (error) {
		console.error("[Migration] ❌ Migration failed with error:", error)
		console.error("[Migration] Extension will continue with current state")
		console.error("[Migration] If you see this error repeatedly, please report it as a bug")
		console.error("[Migration] Your data is safe - original files are preserved")
		// Don't throw - allow extension to continue
		// Don't mark as migrated so we can try again on next activation
	}
}

/**
 * Export validation function for testing
 */
export { validateTaskHistory }
