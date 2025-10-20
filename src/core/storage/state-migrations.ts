import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"
import { HistoryItem } from "@/shared/HistoryItem"
import {
	ensureRulesDirectoryExists,
	getTaskHistoryStateFilePath,
	readTaskHistoryFromState,
	taskHistoryStateFileExists,
	writeTaskHistoryToState,
} from "./disk"
import { populateWorkspaceIds } from "./migrations/populateWorkspaceIds"

export async function migrateWorkspaceToGlobalStorage(context: vscode.ExtensionContext) {
	// Keys to migrate from workspace storage back to global storage
	const keysToMigrate = [
		// Core settings
		"apiProvider",
		"apiModelId",
		"thinkingBudgetTokens",
		"reasoningEffort",
		"vsCodeLmModelSelector",

		// Provider-specific model keys
		"awsBedrockCustomSelected",
		"awsBedrockCustomModelBaseId",
		"openRouterModelId",
		"openRouterModelInfo",
		"openAiModelId",
		"openAiModelInfo",
		"ollamaModelId",
		"lmStudioModelId",
		"liteLlmModelId",
		"liteLlmModelInfo",
		"requestyModelId",
		"requestyModelInfo",
		"togetherModelId",
		"fireworksModelId",
		"sapAiCoreModelId",
		"groqModelId",
		"groqModelInfo",
		"huggingFaceModelId",
		"huggingFaceModelInfo",

		// Previous mode settings
		"previousModeApiProvider",
		"previousModeModelId",
		"previousModeModelInfo",
		"previousModeVsCodeLmModelSelector",
		"previousModeThinkingBudgetTokens",
		"previousModeReasoningEffort",
		"previousModeAwsBedrockCustomSelected",
		"previousModeAwsBedrockCustomModelBaseId",
		"previousModeSapAiCoreModelId",
	]

	for (const key of keysToMigrate) {
		// Use raw workspace state since these keys shouldn't be in workspace storage
		const workspaceValue = await context.workspaceState.get(key)
		const globalValue = await context.globalState.get(key)

		if (workspaceValue !== undefined && globalValue === undefined) {
			console.log(`[Storage Migration] migrating key: ${key} to global storage. Current value: ${workspaceValue}`)

			// Move to global storage using raw VSCode method to avoid type errors
			await context.globalState.update(key, workspaceValue)
			// Remove from workspace storage
			await context.workspaceState.update(key, undefined)
			const newWorkspaceValue = await context.workspaceState.get(key)

			console.log(`[Storage Migration] migrated key: ${key} to global storage. Current value: ${newWorkspaceValue}`)
		}
	}
}

export async function migrateTaskHistoryToFile(context: vscode.ExtensionContext) {
	try {
		// Get data from old location
		const vscodeGlobalStateTaskHistory = context.globalState.get<HistoryItem[] | undefined>("taskHistory")

		// Normalize old location data to array (empty array if undefined/null/not-array)
		const oldLocationData = Array.isArray(vscodeGlobalStateTaskHistory) ? vscodeGlobalStateTaskHistory : []

		// Early return if no migration needed
		if (oldLocationData.length === 0) {
			console.log("[Storage Migration] No task history to migrate")
			return
		}

		let finalData: HistoryItem[]
		let migrationAction: string

		const newLocationData = await readTaskHistoryFromState()

		if (newLocationData.length === 0) {
			// Move old data to new location
			finalData = oldLocationData
			migrationAction = "Migrated task history from old location to new location"
		} else {
			// Merge old data (more recent) with new data
			finalData = [...newLocationData, ...oldLocationData]
			migrationAction = "Merged task history from old and new locations"
		}

		// Perform migration operations sequentially - only clear old data if write succeeds
		await writeTaskHistoryToState(finalData)

		const successfullyWrittenData = await readTaskHistoryFromState()

		if (!Array.isArray(successfullyWrittenData)) {
			console.error("[Storage Migration] Failed to write taskHistory to file: Written data is not an array")
			return
		}

		if (successfullyWrittenData.length !== finalData.length) {
			console.error(
				"[Storage Migration] Failed to write taskHistory to file: Written data does not match the old location data",
			)
			return
		}

		await context.globalState.update("taskHistory", undefined)

		console.log(`[Storage Migration] ${migrationAction}`)
	} catch (error) {
		console.error("[Storage Migration] Failed to migrate task history to file:", error)
	}
}

export async function migrateMcpMarketplaceEnableSetting(mcpMarketplaceEnabledRaw: boolean | undefined): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("cline")
	const mcpMarketplaceEnabled = config.get<boolean>("mcpMarketplace.enabled")
	if (mcpMarketplaceEnabled !== undefined) {
		// Remove from VSCode configuration
		await config.update("mcpMarketplace.enabled", undefined, true)

		return !mcpMarketplaceEnabled
	}
	return mcpMarketplaceEnabledRaw ?? true
}

export async function migrateEnableCheckpointsSetting(enableCheckpointsSettingRaw: boolean | undefined): Promise<boolean> {
	const config = vscode.workspace.getConfiguration("cline")
	const enableCheckpoints = config.get<boolean>("enableCheckpoints")
	if (enableCheckpoints !== undefined) {
		// Remove from VSCode configuration
		await config.update("enableCheckpoints", undefined, true)
		return enableCheckpoints
	}
	return enableCheckpointsSettingRaw ?? true
}

export async function migrateCustomInstructionsToGlobalRules(context: vscode.ExtensionContext) {
	try {
		const customInstructions = (await context.globalState.get("customInstructions")) as string | undefined

		if (customInstructions?.trim()) {
			console.log("Migrating custom instructions to global Cline rules...")

			// Create global .clinerules directory if it doesn't exist
			const globalRulesDir = await ensureRulesDirectoryExists()

			// Use a fixed filename for custom instructions
			const migrationFileName = "custom_instructions.md"
			const migrationFilePath = path.join(globalRulesDir, migrationFileName)

			try {
				// Check if file already exists to determine if we should append
				let existingContent = ""
				try {
					existingContent = await fs.readFile(migrationFilePath, "utf8")
				} catch (_readError) {
					// File doesn't exist, which is fine
				}

				// Append or create the file with custom instructions
				const contentToWrite = existingContent
					? `${existingContent}\n\n---\n\n${customInstructions.trim()}`
					: customInstructions.trim()

				await fs.writeFile(migrationFilePath, contentToWrite)
				console.log(`Successfully ${existingContent ? "appended to" : "created"} migration file: ${migrationFilePath}`)
			} catch (fileError) {
				console.error("Failed to write migration file:", fileError)
				return
			}

			// Remove customInstructions from global state only after successful file creation
			await context.globalState.update("customInstructions", undefined)
			console.log("Successfully migrated custom instructions to global Cline rules")
		}
	} catch (error) {
		console.error("Failed to migrate custom instructions to global rules:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function migrateWelcomeViewCompleted(context: vscode.ExtensionContext) {
	try {
		// Check if welcomeViewCompleted is already set
		const welcomeViewCompleted = context.globalState.get("welcomeViewCompleted")

		if (welcomeViewCompleted === undefined) {
			console.log("Migrating welcomeViewCompleted setting...")

			// Fetch API keys directly from secrets
			const apiKey = await context.secrets.get("apiKey")
			const openRouterApiKey = await context.secrets.get("openRouterApiKey")
			const clineAccountId = await context.secrets.get("clineAccountId")
			const openAiApiKey = await context.secrets.get("openAiApiKey")
			const ollamaApiKey = await context.secrets.get("ollamaApiKey")
			const liteLlmApiKey = await context.secrets.get("liteLlmApiKey")
			const geminiApiKey = await context.secrets.get("geminiApiKey")
			const openAiNativeApiKey = await context.secrets.get("openAiNativeApiKey")
			const deepSeekApiKey = await context.secrets.get("deepSeekApiKey")
			const requestyApiKey = await context.secrets.get("requestyApiKey")
			const togetherApiKey = await context.secrets.get("togetherApiKey")
			const qwenApiKey = await context.secrets.get("qwenApiKey")
			const doubaoApiKey = await context.secrets.get("doubaoApiKey")
			const mistralApiKey = await context.secrets.get("mistralApiKey")
			const asksageApiKey = await context.secrets.get("asksageApiKey")
			const xaiApiKey = await context.secrets.get("xaiApiKey")
			const sambanovaApiKey = await context.secrets.get("sambanovaApiKey")
			const sapAiCoreClientId = await context.secrets.get("sapAiCoreClientId")
			const difyApiKey = await context.secrets.get("difyApiKey")

			// Fetch configuration values from global state
			const awsRegion = context.globalState.get("awsRegion")
			const vertexProjectId = context.globalState.get("vertexProjectId")
			const planModeOllamaModelId = context.globalState.get("planModeOllamaModelId")
			const planModeLmStudioModelId = context.globalState.get("planModeLmStudioModelId")
			const actModeOllamaModelId = context.globalState.get("actModeOllamaModelId")
			const actModeLmStudioModelId = context.globalState.get("actModeLmStudioModelId")
			const planModeVsCodeLmModelSelector = context.globalState.get("planModeVsCodeLmModelSelector")
			const actModeVsCodeLmModelSelector = context.globalState.get("actModeVsCodeLmModelSelector")

			// This is the original logic used for checking if the welcome view should be shown
			// It was located in the ExtensionStateContextProvider
			const hasKey = [
				apiKey,
				openRouterApiKey,
				awsRegion,
				vertexProjectId,
				openAiApiKey,
				ollamaApiKey,
				planModeOllamaModelId,
				planModeLmStudioModelId,
				actModeOllamaModelId,
				actModeLmStudioModelId,
				liteLlmApiKey,
				geminiApiKey,
				openAiNativeApiKey,
				deepSeekApiKey,
				requestyApiKey,
				togetherApiKey,
				qwenApiKey,
				doubaoApiKey,
				mistralApiKey,
				planModeVsCodeLmModelSelector,
				actModeVsCodeLmModelSelector,
				clineAccountId,
				asksageApiKey,
				xaiApiKey,
				sambanovaApiKey,
				sapAiCoreClientId,
				difyApiKey,
			].some((key) => key !== undefined)

			// Set welcomeViewCompleted based on whether user has keys
			await context.globalState.update("welcomeViewCompleted", hasKey)

			console.log(`Migration: Set welcomeViewCompleted to ${hasKey} based on existing API keys`)
		}
	} catch (error) {
		console.error("Failed to migrate welcomeViewCompleted:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

export async function cleanupMcpMarketplaceCatalogFromGlobalState(context: vscode.ExtensionContext) {
	try {
		// Check if mcpMarketplaceCatalog exists in global state
		const mcpMarketplaceCatalog = await context.globalState.get("mcpMarketplaceCatalog")

		if (mcpMarketplaceCatalog !== undefined) {
			console.log("Cleaning up mcpMarketplaceCatalog from global state...")

			// Delete it from global state
			await context.globalState.update("mcpMarketplaceCatalog", undefined)

			console.log("Successfully removed mcpMarketplaceCatalog from global state")
		}
	} catch (error) {
		console.error("Failed to cleanup mcpMarketplaceCatalog from global state:", error)
		// Continue execution - cleanup failure shouldn't break extension startup
	}
}

// ============================================================================
// USER'S WORKSPACE ISOLATION MIGRATION
// ============================================================================

const MIGRATION_VERSION_KEY = "taskHistoryMigrationVersion"
const CURRENT_MIGRATION_VERSION = 2

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
async function performPreMigrationCheck(context: vscode.ExtensionContext): Promise<{
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
			const _testValue = context.workspaceState.get<any>("__migration_test__")
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
export async function migrateTaskHistoryToWorkspaceState(context: vscode.ExtensionContext): Promise<void> {
	const migrationVersion = context.globalState.get<number>(MIGRATION_VERSION_KEY, 0)

	// Always check if workspaceIds need to be populated, regardless of version
	// This ensures migration completes even if version was set but data wasn't migrated
	try {
		const taskHistory = await readTaskHistoryFromState()
		const tasksWithoutWorkspaceIds = taskHistory.filter((t) => !t.workspaceIds || t.workspaceIds.length === 0)

		if (tasksWithoutWorkspaceIds.length > 0) {
			console.log(
				`[Migration] Found ${tasksWithoutWorkspaceIds.length} tasks without workspaceIds, running populateWorkspaceIds migration...`,
			)
			await populateWorkspaceIds()
		} else {
			console.log("[Migration] All tasks have workspaceIds, skipping populateWorkspaceIds migration")
		}
	} catch (error) {
		console.error("[Migration] Failed to check workspaceIds status:", error)
		// Fall back to running migration if check fails
		console.log("[Migration] Running populateWorkspaceIds migration due to check failure...")
		await populateWorkspaceIds()
	}

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
 * Migrate workspaceMetadata from existing task history
 * Backfills workspace metadata by extracting unique workspace paths from all tasks
 * Idempotent - safe to re-run
 */
export async function migrateWorkspaceMetadata(stateManager: any): Promise<void> {
	try {
		const existingMetadata = stateManager.getGlobalStateKey("workspaceMetadata") || {}

		// If already populated, skip migration
		if (Object.keys(existingMetadata).length > 0) {
			console.log("[Migration] workspaceMetadata already populated, skipping migration")
			return
		}

		// Read all tasks from taskHistory.json
		const taskHistory = await readTaskHistoryFromState()

		if (taskHistory.length === 0) {
			console.log("[Migration] No task history found, skipping workspaceMetadata migration")
			return
		}

		// Extract unique workspace paths
		const workspacePaths = new Set<string>()
		for (const task of taskHistory) {
			if (task.workspaceIds && task.workspaceIds.length > 0) {
				task.workspaceIds.forEach((path: string) => workspacePaths.add(path))
			}
			// Fallback to legacy fields
			if (task.cwdOnTaskInitialization) {
				workspacePaths.add(task.cwdOnTaskInitialization)
			}
			if (task.shadowGitConfigWorkTree) {
				workspacePaths.add(task.shadowGitConfigWorkTree)
			}
		}

		if (workspacePaths.size === 0) {
			console.log("[Migration] No workspace paths found in task history, skipping workspaceMetadata migration")
			return
		}

		// Create metadata entries
		const metadata: Record<string, any> = {}
		for (const workspacePath of workspacePaths) {
			const name = workspacePath.split("/").pop() || workspacePath
			metadata[workspacePath] = {
				path: workspacePath,
				name,
				lastOpened: Date.now(),
			}
		}

		// Save to global state
		stateManager.setGlobalState("workspaceMetadata", metadata)
		console.log(`[Migration] Populated workspaceMetadata with ${Object.keys(metadata).length} workspaces`)
	} catch (error) {
		console.error("[Migration] Failed to migrate workspaceMetadata:", error)
		// Continue execution - migration failure shouldn't break extension startup
	}
}

/**
 * Export validation function for testing
 */
export { validateTaskHistory }
