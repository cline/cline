import { Anthropic } from "@anthropic-ai/sdk"
import { TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import { execa } from "@packages/execa"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { RemoteConfig } from "@shared/remote-config/schema"
import { GlobalState, Settings } from "@shared/storage/state-keys"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import { randomUUID } from "crypto"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { McpMarketplaceCatalog } from "@/shared/mcp"
import { StateManager } from "./StateManager"

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	openRouterModels: "openrouter_models.json",
	vercelAiGatewayModels: "vercel_ai_gateway_models.json",
	groqModels: "groq_models.json",
	basetenModels: "baseten_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
	workflows: ".clinerules/workflows",
	hooksDir: ".clinerules/hooks",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	taskMetadata: "task_metadata.json",
	mcpMarketplaceCatalog: "mcp_marketplace_catalog.json",
	remoteConfig: (orgId: string) => `remote_config_${orgId}.json`,
}

/**
 * Atomic write: Write to temp file, then rename
 * Prevents corruption from partial writes and concurrent access
 */
async function atomicWriteFile(filePath: string, content: string): Promise<void> {
	const tempPath = `${filePath}.${randomUUID()}.tmp`
	try {
		// Write to temp file
		await fs.writeFile(tempPath, content, "utf8")
		// Atomic rename (overwrites target if exists)
		await fs.rename(tempPath, filePath)
	} catch (error) {
		// Clean up temp file if it exists
		try {
			await fs.unlink(tempPath)
		} catch {}
		throw error
	}
}

export async function getDocumentsPath(): Promise<string> {
	if (process.platform === "win32") {
		try {
			const { stdout: docsPath } = await execa("powershell", [
				"-NoProfile", // Ignore user's PowerShell profile(s)
				"-Command",
				"[System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::MyDocuments)",
			])
			const trimmedPath = docsPath.trim()
			if (trimmedPath) {
				return trimmedPath
			}
		} catch (_err) {
			console.error("Failed to retrieve Windows Documents path. Falling back to homedir/Documents.")
		}
	} else if (process.platform === "linux") {
		try {
			// First check if xdg-user-dir exists
			await execa("which", ["xdg-user-dir"])

			// If it exists, try to get XDG documents path
			const { stdout } = await execa("xdg-user-dir", ["DOCUMENTS"])
			const trimmedPath = stdout.trim()
			if (trimmedPath) {
				return trimmedPath
			}
		} catch {
			// Log error but continue to fallback
			console.error("Failed to retrieve XDG Documents path. Falling back to homedir/Documents.")
		}
	}

	// Default fallback for all platforms
	return path.join(os.homedir(), "Documents")
}

export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	return getGlobalStorageDir("tasks", taskId)
}

export async function ensureRulesDirectoryExists(): Promise<string> {
	const userDocumentsPath = await getDocumentsPath()
	const clineRulesDir = path.join(userDocumentsPath, "Cline", "Rules")
	try {
		await fs.mkdir(clineRulesDir, { recursive: true })
	} catch (_error) {
		return path.join(os.homedir(), "Documents", "Cline", "Rules") // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine because we will fail gracefully with a path that does not exist
	}
	return clineRulesDir
}

export async function ensureWorkflowsDirectoryExists(): Promise<string> {
	const userDocumentsPath = await getDocumentsPath()
	const clineWorkflowsDir = path.join(userDocumentsPath, "Cline", "Workflows")
	try {
		await fs.mkdir(clineWorkflowsDir, { recursive: true })
	} catch (_error) {
		return path.join(os.homedir(), "Documents", "Cline", "Workflows") // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine because we will fail gracefully with a path that does not exist
	}
	return clineWorkflowsDir
}

export async function ensureMcpServersDirectoryExists(): Promise<string> {
	const userDocumentsPath = await getDocumentsPath()
	const mcpServersDir = path.join(userDocumentsPath, "Cline", "MCP")
	try {
		await fs.mkdir(mcpServersDir, { recursive: true })
	} catch (_error) {
		return path.join(os.homedir(), "Documents", "Cline", "MCP") // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine since this path is only ever used in the system prompt
	}
	return mcpServersDir
}

export async function ensureHooksDirectoryExists(): Promise<string> {
	const rulesDir = await ensureRulesDirectoryExists()
	const clineHooksDir = path.join(rulesDir, "Hooks")
	try {
		await fs.mkdir(clineHooksDir, { recursive: true })
		return clineHooksDir
	} catch (_error) {
		// If mkdir fails, return a fallback path based on the Rules directory fallback
		// This matches the pattern of other ensure*DirectoryExists functions
		return path.join(rulesDir, "Hooks")
	}
}

export async function ensureSettingsDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("settings")
}

export async function getSavedApiConversationHistory(taskId: string): Promise<Anthropic.MessageParam[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
	const fileExists = await fileExistsAtPath(filePath)
	if (fileExists) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	}
	return []
}

export async function saveApiConversationHistory(taskId: string, apiConversationHistory: Anthropic.MessageParam[]) {
	try {
		const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
		await atomicWriteFile(filePath, JSON.stringify(apiConversationHistory))
	} catch (error) {
		// in the off chance this fails, we don't want to stop the task
		console.error("Failed to save API conversation history:", error)
	}
}

export async function getSavedClineMessages(taskId: string): Promise<ClineMessage[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.uiMessages)
	if (await fileExistsAtPath(filePath)) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	} else {
		// check old location
		const oldPath = path.join(await ensureTaskDirectoryExists(taskId), "claude_messages.json")
		if (await fileExistsAtPath(oldPath)) {
			const data = JSON.parse(await fs.readFile(oldPath, "utf8"))
			await fs.unlink(oldPath) // remove old file
			return data
		}
	}
	return []
}

export async function saveClineMessages(taskId: string, uiMessages: ClineMessage[]) {
	try {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		const filePath = path.join(taskDir, GlobalFileNames.uiMessages)
		await atomicWriteFile(filePath, JSON.stringify(uiMessages))
	} catch (error) {
		console.error("Failed to save ui messages:", error)
	}
}

export async function getTaskMetadata(taskId: string): Promise<TaskMetadata> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskMetadata)
	try {
		if (await fileExistsAtPath(filePath)) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
	} catch (error) {
		console.error("Failed to read task metadata:", error)
	}
	return { files_in_context: [], model_usage: [] }
}

export async function saveTaskMetadata(taskId: string, metadata: TaskMetadata) {
	try {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		await atomicWriteFile(filePath, JSON.stringify(metadata, null, 2))
	} catch (error) {
		console.error("Failed to save task metadata:", error)
	}
}

export async function ensureStateDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("state")
}

export async function ensureCacheDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("cache")
}

export async function readMcpMarketplaceCatalogFromCache(): Promise<McpMarketplaceCatalog | undefined> {
	try {
		const mcpMarketplaceCatalogFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.mcpMarketplaceCatalog)
		const fileExists = await fileExistsAtPath(mcpMarketplaceCatalogFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(mcpMarketplaceCatalogFilePath, "utf8")
			return JSON.parse(fileContents)
		}
		return undefined
	} catch (error) {
		console.error("Failed to read MCP marketplace catalog from cache:", error)
		return undefined
	}
}

export async function writeMcpMarketplaceCatalogToCache(catalog: McpMarketplaceCatalog): Promise<void> {
	try {
		const mcpMarketplaceCatalogFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.mcpMarketplaceCatalog)
		await fs.writeFile(mcpMarketplaceCatalogFilePath, JSON.stringify(catalog))
	} catch (error) {
		console.error("Failed to write MCP marketplace catalog to cache:", error)
	}
}

async function getGlobalStorageDir(...subdirs: string[]) {
	const fullPath = path.resolve(HostProvider.get().globalStorageFsPath, ...subdirs)
	await fs.mkdir(fullPath, { recursive: true })
	return fullPath
}

export async function getTaskHistoryStateFilePath(): Promise<string> {
	return path.join(await ensureStateDirectoryExists(), "taskHistory.json")
}

export async function taskHistoryStateFileExists(): Promise<boolean> {
	const filePath = await getTaskHistoryStateFilePath()
	return fileExistsAtPath(filePath)
}

/**
 * Validates task history data before writing to disk.
 * Ensures data integrity and prevents accidental data loss from malformed writes.
 *
 * @param items - The task history data to validate
 * @returns Validation result with any errors found
 */
function validateTaskHistory(items: any): { valid: boolean; errors: string[] } {
	const errors: string[] = []

	if (!Array.isArray(items)) {
		errors.push("Task history must be an array")
		return { valid: false, errors }
	}

	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		if (!item.id) {
			errors.push(`Item ${i} missing 'id' field`)
		}
		if (!item.ts || typeof item.ts !== "number") {
			errors.push(`Item ${i} missing or invalid 'ts' field`)
		}
	}

	return { valid: errors.length === 0, errors }
}

/**
 * Cleans up old backup files, keeping only the 5 most recent.
 * Prevents unlimited backup file accumulation and disk space issues.
 *
 * @param originalPath - Path to the original file whose backups should be cleaned
 */
async function cleanupOldBackups(originalPath: string): Promise<void> {
	try {
		const dir = path.dirname(originalPath)
		const basename = path.basename(originalPath)
		const files = await fs.readdir(dir)

		// Find all backup files for this original file
		const backupPattern = new RegExp(`^${basename}\\.backup-(.+)$`)
		const backups = files
			.filter((file) => backupPattern.test(file))
			.map((file) => ({
				name: file,
				path: path.join(dir, file),
				match: file.match(backupPattern),
			}))
			.filter((backup) => backup.match !== null)
			.sort((a, b) => {
				// Sort by timestamp in filename (ISO format sorts lexicographically)
				return b.match![1].localeCompare(a.match![1])
			})

		// Keep only the 5 most recent backups
		const backupsToDelete = backups.slice(5)
		for (const backup of backupsToDelete) {
			try {
				await fs.unlink(backup.path)
			} catch (error) {
				console.error(`[Disk] Failed to delete old backup ${backup.name}:`, error)
			}
		}
	} catch (error) {
		console.error("[Disk] Failed to cleanup old backups:", error)
	}
}

/**
 * Creates a timestamped backup of the task history file before modifications.
 * Enables recovery in case of write failures or corruption.
 * Maintains up to 5 recent backups to balance safety and disk space.
 *
 * @returns The path to the created backup file, or null if backup failed
 */
async function createTaskHistoryBackup(): Promise<string | null> {
	try {
		const originalPath = await getTaskHistoryStateFilePath()
		if (!(await fileExistsAtPath(originalPath))) {
			return null
		}

		const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "")
		const backupPath = `${originalPath}.backup-${timestamp}`

		await fs.copyFile(originalPath, backupPath)

		// Keep only last 5 backups
		await cleanupOldBackups(originalPath)

		return backupPath
	} catch (error) {
		console.error("[Disk] Failed to create backup:", error)
		return null
	}
}

/**
 * Reads task history from disk with corruption recovery.
 *
 * CRITICAL: This function must NEVER return an empty array on corruption,
 * as that empty array could be written back to disk, causing permanent data loss.
 * Instead, it attempts backup recovery and throws an error if all recovery fails.
 *
 * Recovery strategy:
 * 1. Try to read and parse the main file
 * 2. On parse failure, try to read from the most recent backup
 * 3. If all recovery fails, throw error to prevent empty array write-back
 *
 * @returns Task history array from either main file or backup
 * @throws Error if file is corrupted and no valid backup exists
 */
export async function readTaskHistoryFromState(): Promise<HistoryItem[]> {
	try {
		const filePath = await getTaskHistoryStateFilePath()
		if (await fileExistsAtPath(filePath)) {
			const contents = await fs.readFile(filePath, "utf8")
			try {
				const parsed = JSON.parse(contents)
				return parsed
			} catch (parseError) {
				console.error("[Disk] Failed to parse task history from main file:", parseError)
				console.error("[Disk] Corrupted content length:", contents.length, "bytes")
				console.error("[Disk] First 100 chars:", contents.substring(0, 100))

				// CRITICAL: Try to recover from backup instead of returning empty array
				console.warn("[Disk] Attempting recovery from backup files...")

				try {
					const dir = path.dirname(filePath)
					const basename = path.basename(filePath)
					const files = await fs.readdir(dir)

					// Find all backup files
					const backupPattern = new RegExp(`^${basename}\\.backup-(.+)$`)
					const backups = files
						.filter((file) => backupPattern.test(file))
						.map((file) => ({
							name: file,
							path: path.join(dir, file),
							match: file.match(backupPattern),
						}))
						.filter((backup) => backup.match !== null)
						.sort((a, b) => {
							// Sort by timestamp (most recent first)
							return b.match![1].localeCompare(a.match![1])
						})

					// Try each backup in order (most recent first)
					for (const backup of backups) {
						try {
							console.log("[Disk] Trying backup:", backup.name)
							const backupContents = await fs.readFile(backup.path, "utf8")
							const parsed = JSON.parse(backupContents)
							console.log("[Disk] Successfully recovered from backup:", backup.name)
							console.warn("[Disk] IMPORTANT: Main file is corrupted. Consider restoring from backup.")
							return parsed
						} catch (backupError) {
							console.error(`[Disk] Backup ${backup.name} also corrupted:`, backupError)
							// Continue to next backup
						}
					}

					// All backups failed
					console.error("[Disk] CRITICAL: All backup recovery attempts failed!")
					throw new Error("Task history file is corrupted and no valid backups exist. Data recovery required.")
				} catch (recoveryError) {
					console.error("[Disk] Backup recovery process failed:", recoveryError)
					throw new Error(`Task history corrupted and recovery failed: ${recoveryError}`)
				}
			}
		}
		return []
	} catch (error) {
		console.error("[Disk] Failed to read task history:", error)
		throw error
	}
}

/**
 * Writes task history to disk with atomic write protection and validation.
 *
 * CRITICAL FIX: This function uses atomic writes to prevent corruption from:
 * - Interrupted writes (process crashes, system shutdown)
 * - Concurrent writes from multiple extension instances
 * - Partial writes that leave the file in an invalid state
 *
 * Safety mechanisms:
 * 1. Validates data structure before writing
 * 2. Creates backup before overwriting existing file
 * 3. Uses atomic write (temp file + rename) to ensure consistency
 * 4. Warns if attempting to write empty array to non-empty file
 *
 * @param items - Task history items to write
 * @throws Error if validation fails or write operation fails
 */
export async function writeTaskHistoryToState(items: HistoryItem[]): Promise<void> {
	try {
		const filePath = await getTaskHistoryStateFilePath()

		// STEP 1: Validate data structure
		const validation = validateTaskHistory(items)
		if (!validation.valid) {
			console.error("[Disk] Task history validation failed:", validation.errors)
			throw new Error(`Invalid task history data: ${validation.errors.join(", ")}`)
		}

		// STEP 2: Check if writing empty array to non-empty file (potential data loss)
		if (items.length === 0 && (await fileExistsAtPath(filePath))) {
			try {
				const existingContents = await fs.readFile(filePath, "utf8")
				const existingItems = JSON.parse(existingContents)
				if (Array.isArray(existingItems) && existingItems.length > 0) {
					console.warn("[Disk] WARNING: Attempting to write empty array to file with", existingItems.length, "items")
					console.warn("[Disk] This could indicate accidental data loss. Creating backup before proceeding...")
					// Continue with write after warning - empty array might be intentional (e.g., deleteAllTaskHistory)
				}
			} catch (readError) {
				// If we can't read existing file, it might be corrupted, so proceeding with write is OK
				console.log("[Disk] Could not read existing file for empty array check:", readError)
			}
		}

		// STEP 3: Create backup before overwriting
		const backupPath = await createTaskHistoryBackup()
		if (backupPath) {
			console.log("[Disk] Created backup before write:", path.basename(backupPath))
		}

		// STEP 4: Use atomic write to prevent corruption
		// This is the CRITICAL FIX - replaces fs.writeFile with atomicWriteFile
		await atomicWriteFile(filePath, JSON.stringify(items))

		console.log("[Disk] Successfully wrote", items.length, "items to task history")
	} catch (error) {
		console.error("[Disk] Failed to write task history:", error)
		throw error
	}
}

export async function readTaskSettingsFromStorage(taskId: string): Promise<Partial<GlobalState>> {
	try {
		const taskDirectoryFilePath = await ensureTaskDirectoryExists(taskId)
		const settingsFilePath = path.join(taskDirectoryFilePath, "settings.json")

		if (await fileExistsAtPath(settingsFilePath)) {
			const settingsContent = await fs.readFile(settingsFilePath, "utf8")
			return JSON.parse(settingsContent)
		}

		// Return empty object if settings file doesn't exist (new task)
		return {}
	} catch (error) {
		console.error("[Disk] Failed to read task settings:", error)
		throw error
	}
}

export async function writeTaskSettingsToStorage(taskId: string, settings: Partial<Settings>) {
	try {
		const taskDirectoryFilePath = await ensureTaskDirectoryExists(taskId)
		const settingsFilePath = path.join(taskDirectoryFilePath, "settings.json")

		let existingSettings = {}
		if (await fileExistsAtPath(settingsFilePath)) {
			const existingSettingsContent = await fs.readFile(settingsFilePath, "utf8")
			existingSettings = JSON.parse(existingSettingsContent)
		}

		const updatedSettings = { ...existingSettings, ...settings }
		await atomicWriteFile(settingsFilePath, JSON.stringify(updatedSettings, null, 2))
	} catch (error) {
		console.error("[Disk] Failed to write task settings:", error)
		throw error
	}
}

export async function readRemoteConfigFromCache(organizationId: string): Promise<RemoteConfig | undefined> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		const fileExists = await fileExistsAtPath(remoteConfigFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(remoteConfigFilePath, "utf8")
			return JSON.parse(fileContents)
		}
		return undefined
	} catch (error) {
		console.error("Failed to read remote config from cache:", error)
		return undefined
	}
}

export async function writeRemoteConfigToCache(organizationId: string, config: RemoteConfig): Promise<void> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		await fs.writeFile(remoteConfigFilePath, JSON.stringify(config))
	} catch (error) {
		console.error("Failed to write remote config to cache:", error)
	}
}

export async function deleteRemoteConfigFromCache(organizationId: string): Promise<void> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		const fileExists = await fileExistsAtPath(remoteConfigFilePath)
		if (fileExists) {
			await fs.unlink(remoteConfigFilePath)
		}
	} catch (error) {
		console.error("Failed to delete remote config from cache:", error)
	}
}

/**
 * Gets the path to the global hooks directory if it exists.
 * Returns undefined if the directory doesn't exist.
 */
export async function getGlobalHooksDir(): Promise<string | undefined> {
	const globalHooksDir = await ensureHooksDirectoryExists()
	return (await isDirectory(globalHooksDir)) ? globalHooksDir : undefined
}

/**
 * Gets the paths to all hooks directories to search for hooks, including:
 * 1. The global hooks directory (if it exists)
 * 2. Each workspace root's .clinerules/hooks directory (if they exist)
 *
 * Note: Hooks from different directories may be executed concurrently.
 * No execution order is guaranteed between hooks from different directories.
 * A workspace may not use hooks, and the resulting array will be empty. A
 * multi-root workspace may have multiple hooks directories.
 */
export async function getAllHooksDirs(): Promise<string[]> {
	const hooksDirs: string[] = []

	// Add global hooks directory (if it exists)
	const globalHooksDir = await getGlobalHooksDir()
	if (globalHooksDir) {
		hooksDirs.push(globalHooksDir)
	}

	// Add workspace hooks directories
	const workspaceHooksDirs = await getWorkspaceHooksDirs()
	hooksDirs.push(...workspaceHooksDirs)

	return hooksDirs
}

/**
 * Gets the paths to the workspace's .clinerules/hooks directories to search for
 * hooks. A workspace may not use hooks, and the resulting array will be empty. A
 * multi-root workspace may have multiple hooks directories.
 */
export async function getWorkspaceHooksDirs(): Promise<string[]> {
	const workspaceRootPaths =
		StateManager.get()
			.getGlobalStateKey("workspaceRoots")
			?.map((root) => root.path) || []

	return (
		await Promise.all(
			workspaceRootPaths.map(async (workspaceRootPath) => {
				// Look for a .clinerules/hooks folder in this workspace root.
				const candidate = path.join(workspaceRootPath, GlobalFileNames.hooksDir)
				return (await isDirectory(candidate)) ? candidate : undefined
			}),
		)
	).filter((path): path is string => Boolean(path))
}
