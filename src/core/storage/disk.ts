import { Anthropic } from "@anthropic-ai/sdk"
import { EnvironmentMetadataEntry, TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import { execa } from "@packages/execa"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { RemoteConfig } from "@shared/remote-config/schema"
import { GlobalState, Settings } from "@shared/storage/state-keys"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ExtensionRegistryInfo } from "@/registry"
import { telemetryService } from "@/services/telemetry"
import { McpMarketplaceCatalog } from "@/shared/mcp"
import { reconstructTaskHistory } from "../commands/reconstructTaskHistory"
import { StateManager } from "./StateManager"

/**
 * Atomically write data to a file using temp file + rename pattern.
 * This prevents readers from seeing partial/incomplete data by writing to a temporary
 * file first, then renaming it to the target location. The rename operation is atomic
 * in most cases on modern systems, though behavior may vary across platforms and filesystems.
 *
 * @param filePath - The target file path
 * @param data - The data to write
 */
async function atomicWriteFile(filePath: string, data: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
	try {
		// Write to temporary file first
		await fs.writeFile(tmpPath, data, "utf8")
		// Rename temp file to target (atomic in most cases)
		await fs.rename(tmpPath, filePath)
	} catch (error) {
		// Clean up temp file if it exists
		fs.unlink(tmpPath).catch(() => {})
		throw error
	}
}

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	openRouterModels: "openrouter_models.json",
	vercelAiGatewayModels: "vercel_ai_gateway_models.json",
	groqModels: "groq_models.json",
	basetenModels: "baseten_models.json",
	hicapModels: "hicap_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
	workflows: ".clinerules/workflows",
	hooksDir: ".clinerules/hooks",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	agentsRulesFile: "AGENTS.md",
	taskMetadata: "task_metadata.json",
	mcpMarketplaceCatalog: "mcp_marketplace_catalog.json",
	remoteConfig: (orgId: string) => `remote_config_${orgId}.json`,
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
	const userDocumentsPath = await getDocumentsPath()
	const clineHooksDir = path.join(userDocumentsPath, "Cline", "Hooks")
	try {
		await fs.mkdir(clineHooksDir, { recursive: true })
	} catch (_error) {
		return path.join(os.homedir(), "Documents", "Cline", "Hooks") // in case creating a directory in documents fails for whatever reason (e.g. permissions) - this is fine because we will fail gracefully with a path that does not exist
	}
	return clineHooksDir
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

/**
 * Collects environment metadata for the current system and host.
 * This information is used for debugging and task portability.
 * Returns metadata without timestamp - timestamp is added by EnvironmentContextTracker.
 */
export async function collectEnvironmentMetadata(): Promise<Omit<EnvironmentMetadataEntry, "ts">> {
	try {
		const hostVersion = await HostProvider.env.getHostVersion({})

		return {
			os_name: os.platform(),
			os_version: os.release(),
			os_arch: os.arch(),
			host_name: hostVersion.platform || "Unknown",
			host_version: hostVersion.version || "Unknown",
			cline_version: ExtensionRegistryInfo.version,
		}
	} catch (error) {
		console.error("Failed to collect environment metadata:", error)
		// Return fallback values if collection fails
		return {
			os_name: os.platform(),
			os_version: os.release(),
			os_arch: os.arch(),
			host_name: "Unknown",
			host_version: "Unknown",
			cline_version: "Unknown",
		}
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
	return { files_in_context: [], model_usage: [], environment_history: [] }
}

export async function saveTaskMetadata(taskId: string, metadata: TaskMetadata) {
	try {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		await fs.writeFile(filePath, JSON.stringify(metadata, null, 2))
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

export async function readTaskHistoryFromState(): Promise<HistoryItem[]> {
	try {
		const filePath = await getTaskHistoryStateFilePath()
		if (!(await fileExistsAtPath(filePath))) {
			return []
		}

		const contents = await fs.readFile(filePath, "utf8")

		try {
			return JSON.parse(contents)
		} catch (parseError) {
			telemetryService.captureExtensionStorageError(parseError, "parseError_attemptingRecovery")

			const result = await reconstructTaskHistory(false)
			if (result && result.reconstructedTasks > 0) {
				// Read the reconstructed file
				const newContents = await fs.readFile(filePath, "utf8")
				return JSON.parse(newContents)
			}

			// Recovery failed, all we can do is return an empty array or throw an error, thus preventing the app from starting up
			// This will wipe out the taskHistory
			return []
		}
	} catch (error) {
		// Filesystem or other errors - throw them for the caller to handle
		telemetryService.captureExtensionStorageError(error, "readTaskHistoryFromState")
		throw error
	}
}

export async function writeTaskHistoryToState(items: HistoryItem[]): Promise<void> {
	try {
		const filePath = await getTaskHistoryStateFilePath()
		await atomicWriteFile(filePath, JSON.stringify(items))
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
		await fs.writeFile(settingsFilePath, JSON.stringify(updatedSettings, null, 2))
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

/**
 * Writes the conversation history to a temporary JSON file for PreCompact hook consumption.
 * The file is created in the task's directory with a unique timestamp-based name.
 * Returns the absolute path to the created file.
 *
 * @param taskId The task ID
 * @param apiConversationHistory The conversation history to write
 * @param timestamp Optional timestamp to use for the filename (defaults to Date.now())
 * @returns The absolute path to the temporary file
 */
export async function writeConversationHistoryJson(
	taskId: string,
	apiConversationHistory: Anthropic.MessageParam[],
	timestamp?: number,
): Promise<string> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const fileTimestamp = timestamp ?? Date.now()
	const tempFileName = `conversation_history_${fileTimestamp}.json`
	const tempFilePath = path.join(taskDir, tempFileName)

	try {
		await atomicWriteFile(tempFilePath, JSON.stringify(apiConversationHistory, null, 2))
		return tempFilePath
	} catch (error) {
		console.error("Failed to write conversation history JSON for hook:", error)
		throw error
	}
}

/**
 * Cleans up a temporary conversation history file created for hook execution.
 * Silently handles errors (file already deleted, permissions, etc.)
 *
 * @param filePath The path to the temporary file to delete
 */
export async function cleanupConversationHistoryFile(filePath: string): Promise<void> {
	try {
		if (await fileExistsAtPath(filePath)) {
			await fs.unlink(filePath)
		}
	} catch (error) {
		// Silently handle errors - this is cleanup, not critical
		console.debug("Failed to cleanup conversation history file:", filePath, error)
	}
}

/**
 * Writes the conversation history in human-readable text format to a temporary file for PreCompact hook consumption.
 * This formats the conversation history (user and assistant messages) in a readable text format,
 * making it easy to analyze the conversation flow without parsing JSON.
 *
 * @param taskId The task ID
 * @param conversationHistory The conversation history messages
 * @param timestamp Optional timestamp to use for the filename (defaults to Date.now())
 * @returns The absolute path to the temporary file
 */
export async function writeConversationHistoryText(
	taskId: string,
	conversationHistory: Anthropic.MessageParam[],
	timestamp?: number,
): Promise<string> {
	const taskDir = await ensureTaskDirectoryExists(taskId)
	const fileTimestamp = timestamp ?? Date.now()
	const tempFileName = `conversation_history_${fileTimestamp}.txt`
	const tempFilePath = path.join(taskDir, tempFileName)

	try {
		// Build the formatted conversation history (excluding system prompt)
		let fullContext = "=== CONVERSATION HISTORY ===\n\n"

		// Format each message in the conversation
		for (let i = 0; i < conversationHistory.length; i++) {
			const message = conversationHistory[i]
			fullContext += `--- Message ${i + 1} (${message.role.toUpperCase()}) ---\n`

			// Handle content which can be a string or array
			if (typeof message.content === "string") {
				fullContext += message.content
			} else if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "text") {
						fullContext += block.text
					} else if (block.type === "image") {
						fullContext += `[IMAGE: ${block.source?.type || "unknown"}]`
					} else if (block.type === "tool_use") {
						fullContext += `[TOOL USE: ${block.name}]\n`
						fullContext += `Input: ${JSON.stringify(block.input, null, 2)}`
					} else if (block.type === "tool_result") {
						fullContext += `[TOOL RESULT: ${block.tool_use_id}]\n`
						if (typeof block.content === "string") {
							fullContext += block.content
						} else if (Array.isArray(block.content)) {
							for (const resultBlock of block.content) {
								if (resultBlock.type === "text") {
									fullContext += resultBlock.text
								} else if (resultBlock.type === "image") {
									fullContext += `[IMAGE]`
								}
							}
						}
					}
					fullContext += "\n\n"
				}
			}

			fullContext += "\n"
		}

		fullContext += "=== END OF CONTEXT ===\n"

		await atomicWriteFile(tempFilePath, fullContext)
		return tempFilePath
	} catch (error) {
		console.error("Failed to write conversation history text for hook:", error)
		throw error
	}
}
