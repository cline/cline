import { TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import { GlobalState, Settings } from "@shared/storage/state-keys"
import { fileExistsAtPath, isDirectory } from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import type { BedrockCoderStorageMessage } from "@/shared/messages/content"
import { Logger } from "@/shared/services/Logger"
import { StateManager } from "./StateManager"

export { getDocumentsPath } from "./documents-path"

export { getSkillsDirectoriesForScan, type SkillsScanDirectory } from "./skill-directories"

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	mcpSettings: "mcp_settings.json",
	bedrockCoderRules: ".bedrock-coder",
	workflows: ".bedrock-coder/workflows",
	hooksDir: ".bedrock-coder/hooks",
	bedrockCoderruleSkillsDir: ".bedrock-coder/skills",
	bedrockCoderSkillsDir: ".bedrock-coder/skills",
	claudeSkillsDir: ".claude/skills",
	agentsSkillsDir: ".agents/skills",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	agentsRulesFile: "AGENTS.md",
	taskMetadata: "task_metadata.json",
}

/**
 * Returns the cross-platform path to the BedrockCoder home directory (~/.bedrock-coder).
 * This works on macOS, Linux, and Windows:
 * - macOS: /Users/username/.bedrock-coder
 * - Linux: /home/username/.bedrock-coder
 * - Windows: C:\Users\username\.bedrock-coder
 *
 */
function getBedrockCoderHomePath(): string {
	return path.join(os.homedir(), ".bedrock-coder")
}

export async function ensureTaskDirectoryExists(taskId: string): Promise<string> {
	return getGlobalStorageDir("tasks", taskId)
}

export async function ensureRulesDirectoryExists(): Promise<string> {
	const bedrockCoderRulesDir = path.join(getBedrockCoderHomePath(), "rules")
	try {
		await fs.mkdir(bedrockCoderRulesDir, { recursive: true })
	} catch (_error) {
		return bedrockCoderRulesDir
	}
	return bedrockCoderRulesDir
}

export async function ensureWorkflowsDirectoryExists(): Promise<string> {
	const bedrockCoderWorkflowsDir = path.join(getBedrockCoderHomePath(), "workflows")
	try {
		await fs.mkdir(bedrockCoderWorkflowsDir, { recursive: true })
	} catch (_error) {
		return bedrockCoderWorkflowsDir
	}
	return bedrockCoderWorkflowsDir
}

export async function ensureMcpServersDirectoryExists(): Promise<string> {
	const mcpServersDir = path.join(getBedrockCoderHomePath(), "mcp")
	try {
		await fs.mkdir(mcpServersDir, { recursive: true })
	} catch (_error) {
		return mcpServersDir
	}
	return mcpServersDir
}

export async function ensureHooksDirectoryExists(): Promise<string> {
	const bedrockCoderHooksDir = path.join(getBedrockCoderHomePath(), "hooks")
	try {
		await fs.mkdir(bedrockCoderHooksDir, { recursive: true })
	} catch (_error) {
		return bedrockCoderHooksDir
	}
	return bedrockCoderHooksDir
}

/**
 * Returns the global skills directory path (~/.bedrock-coder/skills) without creating it.
 */
function getBedrockCoderSkillsDirectoryPath(): string {
	return path.join(getBedrockCoderHomePath(), "skills")
}

function getAgentSkillsDirectoryPath(): string {
	return path.join(os.homedir(), ".agents", "skills")
}

/**
 * Returns the global agent skills directory path (~/.agents/skills).
 * Creates the directory if it doesn't exist.
 * This is the opinionated location for new global skills.
 */
export async function ensureAgentSkillsDirectoryExists(options: { isGlobal: boolean; workspacePath?: string }): Promise<string> {
	const agentSkillsDir = options.isGlobal
		? getAgentSkillsDirectoryPath()
		: path.join(options.workspacePath ?? "", GlobalFileNames.agentsSkillsDir)
	try {
		await fs.mkdir(agentSkillsDir, { recursive: true })
	} catch (_error) {
		// Fallback - return the path even if mkdir fails, we'll fail gracefully later
		return agentSkillsDir
	}
	return agentSkillsDir
}

export async function ensureSettingsDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("settings")
}

/**
 * Gets the path to the MCP settings file, creating it if it doesn't exist
 * @param settingsDirectoryPath Path to the settings directory
 * @returns Path to the MCP settings file
 */
export async function getMcpSettingsFilePath(settingsDirectoryPath: string): Promise<string> {
	const mcpSettingsFilePath = path.join(settingsDirectoryPath, GlobalFileNames.mcpSettings)
	const tempPath = `${mcpSettingsFilePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`
	try {
		await fs.writeFile(tempPath, JSON.stringify({ mcpServers: {} }, null, 2), { encoding: "utf8", flag: "wx" })
		// Hard-linking publishes the fully-written temp file without overwriting an
		// existing settings file. EEXIST means another process won the create race.
		await fs.link(tempPath, mcpSettingsFilePath)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error
		}
	} finally {
		await fs.unlink(tempPath).catch(() => {})
	}
	return mcpSettingsFilePath
}

export async function getSavedApiConversationHistory(taskId: string): Promise<BedrockCoderStorageMessage[]> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.apiConversationHistory)
	const fileExists = await fileExistsAtPath(filePath)
	if (fileExists) {
		return JSON.parse(await fs.readFile(filePath, "utf8"))
	}
	return []
}

export async function getTaskMetadata(taskId: string): Promise<TaskMetadata> {
	const filePath = path.join(await ensureTaskDirectoryExists(taskId), GlobalFileNames.taskMetadata)
	try {
		if (await fileExistsAtPath(filePath)) {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		}
	} catch (error) {
		Logger.error("Failed to read task metadata:", error)
	}
	return { files_in_context: [], model_usage: [], environment_history: [] }
}

export async function saveTaskMetadata(taskId: string, metadata: TaskMetadata) {
	try {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		const filePath = path.join(taskDir, GlobalFileNames.taskMetadata)
		await fs.writeFile(filePath, JSON.stringify(metadata, null, 2))
	} catch (error) {
		Logger.error("Failed to save task metadata:", error)
	}
}

export async function ensureCacheDirectoryExists(): Promise<string> {
	return getGlobalStorageDir("cache")
}

async function getGlobalStorageDir(...subdirs: string[]) {
	const fullPath = path.resolve(HostProvider.get().globalStorageFsPath, ...subdirs)
	await fs.mkdir(fullPath, { recursive: true })
	return fullPath
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
		Logger.error("[Disk] Failed to read task settings:", error)
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
		Logger.error("[Disk] Failed to write task settings:", error)
		throw error
	}
}

/**
 * Gets the path to the global hooks directory if it exists.
 * Returns undefined if the directory doesn't exist.
 */
async function getGlobalHooksDir(): Promise<string | undefined> {
	const globalHooksDir = await ensureHooksDirectoryExists()
	return (await isDirectory(globalHooksDir)) ? globalHooksDir : undefined
}

let runtimeHooksDir: string | undefined

/**
 * Sets a runtime hooks directory, typically passed via the --hooks-dir CLI flag.
 * This directory is included alongside global and workspace hooks directories
 * when discovering hooks.
 */
export function setRuntimeHooksDir(dir: string | undefined): void {
	runtimeHooksDir = dir
}

/**
 * Gets the paths to all hooks directories to search for hooks, including:
 * 1. The runtime hooks directory (if set via --hooks-dir CLI flag)
 * 2. The global hooks directory (if it exists)
 * 3. Each workspace root's .bedrock-coder/hooks directory (if they exist)
 *
 * Note: Hooks from different directories may be executed concurrently.
 * No execution order is guaranteed between hooks from different directories.
 * A workspace may not use hooks, and the resulting array will be empty. A
 * multi-root workspace may have multiple hooks directories.
 */
export async function getAllHooksDirs(): Promise<string[]> {
	const hooksDirs: string[] = []

	// Add runtime hooks directory (set by --hooks-dir CLI flag)
	if (runtimeHooksDir && (await isDirectory(runtimeHooksDir))) {
		hooksDirs.push(runtimeHooksDir)
	}

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
 * Gets the paths to the workspace's .bedrock-coder/hooks directories to search for
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
				// Look for a .bedrock-coder/hooks folder in this workspace root.
				const candidate = path.join(workspaceRootPath, GlobalFileNames.hooksDir)
				return (await isDirectory(candidate)) ? candidate : undefined
			}),
		)
	).filter((path): path is string => Boolean(path))
}
