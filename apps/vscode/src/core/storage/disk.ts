import { Anthropic } from "@anthropic-ai/sdk"
import { TaskMetadata } from "@core/context/context-tracking/ContextTrackerTypes"
import { RemoteConfig } from "@shared/remote-config/schema"
import { GlobalState, Settings } from "@shared/storage/state-keys"
import { fileExistsAtPath } from "@utils/fs"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { getDocumentsPath } from "./documents-path"

export { getDocumentsPath } from "./documents-path"

export { getSkillsDirectoriesForScan, type SkillsScanDirectory } from "./skill-directories"

export const GlobalFileNames = {
	apiConversationHistory: "api_conversation_history.json",
	contextHistory: "context_history.json",
	uiMessages: "ui_messages.json",
	clineRecommendedModels: "cline_recommended_models.json",
	openRouterModels: "openrouter_models.json",
	vercelAiGatewayModels: "vercel_ai_gateway_models.json",
	groqModels: "groq_models.json",
	basetenModels: "baseten_models.json",
	hicapModels: "hicap_models.json",
	mcpSettings: "cline_mcp_settings.json",
	clineRules: ".clinerules",
	workflows: ".clinerules/workflows",
	clineruleSkillsDir: ".clinerules/skills",
	clineSkillsDir: ".cline/skills",
	claudeSkillsDir: ".claude/skills",
	agentsSkillsDir: ".agents/skills",
	cursorRulesDir: ".cursor/rules",
	cursorRulesFile: ".cursorrules",
	windsurfRules: ".windsurfrules",
	agentsRulesFile: "AGENTS.md",
	taskMetadata: "task_metadata.json",
	remoteConfig: (orgId: string) => `remote_config_${orgId}.json`,
}

/**
 * Returns the cross-platform path to the Cline home directory (~/.cline).
 * This works on macOS, Linux, and Windows:
 * - macOS: /Users/username/.cline
 * - Linux: /home/username/.cline
 * - Windows: C:\Users\username\.cline
 *
 * This is intended to eventually replace ~/Documents/Cline as the global config location.
 */
function getClineHomePath(): string {
	return path.join(os.homedir(), ".cline")
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

/**
 * Returns the global skills directory path (~/.cline/skills) without creating it.
 */
function getClineSkillsDirectoryPath(): string {
	return path.join(getClineHomePath(), "skills")
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

export async function getSavedApiConversationHistory(taskId: string): Promise<Anthropic.MessageParam[]> {
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
		Logger.error("Failed to read remote config from cache:", error)
		return undefined
	}
}

export async function writeRemoteConfigToCache(organizationId: string, config: RemoteConfig): Promise<void> {
	try {
		const remoteConfigFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.remoteConfig(organizationId))
		await fs.writeFile(remoteConfigFilePath, JSON.stringify(config))
	} catch (error) {
		Logger.error("Failed to write remote config to cache:", error)
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
		Logger.error("Failed to delete remote config from cache:", error)
	}
}
