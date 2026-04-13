// Replaces classic src/core/storage/disk.ts reads (see origin/main)
//
// Reads all existing on-disk state from the Cline data directory.
// This module is used by the SDK adapter layer to bootstrap state
// from the classic storage format during migration.
//
// All reads are non-throwing — missing or corrupt files return defaults.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Anthropic } from "@anthropic-ai/sdk"
import { ClineMessage } from "@shared/ExtensionMessage"
import { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@shared/services/Logger"
import { GlobalStateAndSettings, Secrets } from "@shared/storage/state-keys"

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Cline data directory.
 * Priority: CLINE_DATA_DIR env > CLINE_DIR env + "/data" > ~/.cline/data
 */
export function resolveDataDir(override?: string): string {
	if (override) return override
	if (process.env.CLINE_DATA_DIR) return process.env.CLINE_DATA_DIR
	const clineDir = process.env.CLINE_DIR || path.join(os.homedir(), ".cline")
	return path.join(clineDir, "data")
}

/** Path to globalState.json */
export function globalStatePath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "globalState.json")
}

/** Path to secrets.json */
export function secretsPath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "secrets.json")
}

/** Path to taskHistory.json (stored in state/ subdirectory) */
export function taskHistoryPath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "state", "taskHistory.json")
}

/** Path to MCP settings file */
export function mcpSettingsPath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "settings", "cline_mcp_settings.json")
}

/** Path to a task directory */
export function taskDirPath(taskId: string, dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "tasks", taskId)
}

/** Path to api_conversation_history.json for a task */
export function apiConversationHistoryPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "api_conversation_history.json")
}

/** Path to ui_messages.json for a task */
export function uiMessagesPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "ui_messages.json")
}

/** Path to context_history.json for a task */
export function contextHistoryPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "context_history.json")
}

/** Path to task_metadata.json for a task */
export function taskMetadataPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "task_metadata.json")
}

// ---------------------------------------------------------------------------
// Low-level JSON reader
// ---------------------------------------------------------------------------

/**
 * Read and parse a JSON file, returning undefined on any error.
 * Never throws — returns fallback instead.
 */
function readJsonFile<T>(filePath: string, fallback: T): T {
	try {
		if (!fs.existsSync(filePath)) {
			return fallback
		}
		const content = fs.readFileSync(filePath, "utf-8").trim()
		if (!content || content === "{}") {
			return fallback
		}
		return JSON.parse(content) as T
	} catch (error) {
		Logger.warn(`[LegacyStateReader] Failed to read ${filePath}:`, error)
		return fallback
	}
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

/**
 * Read the full globalState.json contents.
 * Returns a partial record — only keys present on disk are included.
 */
export function readGlobalState(dataDir?: string): Partial<GlobalStateAndSettings> {
	return readJsonFile<Partial<GlobalStateAndSettings>>(globalStatePath(dataDir), {})
}

/**
 * Read a single key from globalState.json.
 */
export function readGlobalStateKey<K extends keyof GlobalStateAndSettings>(
	key: K,
	dataDir?: string,
): GlobalStateAndSettings[K] | undefined {
	const state = readGlobalState(dataDir)
	return state[key]
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * Read the full secrets.json contents.
 * Returns a partial record — only keys present on disk are included.
 */
export function readSecrets(dataDir?: string): Partial<Secrets> {
	return readJsonFile<Partial<Secrets>>(secretsPath(dataDir), {})
}

/**
 * Read a single key from secrets.json.
 */
export function readSecretKey<K extends keyof Secrets>(key: K, dataDir?: string): Secrets[K] | undefined {
	const secrets = readSecrets(dataDir)
	return secrets[key]
}

// ---------------------------------------------------------------------------
// Task history
// ---------------------------------------------------------------------------

/**
 * Read taskHistory.json from the state directory.
 * Returns an empty array if the file is missing or corrupt.
 */
export function readTaskHistory(dataDir?: string): HistoryItem[] {
	return readJsonFile<HistoryItem[]>(taskHistoryPath(dataDir), [])
}

// ---------------------------------------------------------------------------
// Per-task data
// ---------------------------------------------------------------------------

/**
 * Read the API conversation history for a specific task.
 * Returns an empty array if the file is missing or corrupt.
 */
export function readApiConversationHistory(taskId: string, dataDir?: string): Anthropic.MessageParam[] {
	return readJsonFile<Anthropic.MessageParam[]>(apiConversationHistoryPath(taskId, dataDir), [])
}

/**
 * Read the UI messages for a specific task.
 * Returns an empty array if the file is missing or corrupt.
 */
export function readUiMessages(taskId: string, dataDir?: string): ClineMessage[] {
	return readJsonFile<ClineMessage[]>(uiMessagesPath(taskId, dataDir), [])
}

/**
 * Read the context history for a specific task.
 * Returns an empty array if the file is missing or corrupt.
 */
export function readContextHistory(taskId: string, dataDir?: string): unknown[] {
	return readJsonFile<unknown[]>(contextHistoryPath(taskId, dataDir), [])
}

/**
 * Read task metadata for a specific task.
 * Returns an empty object if the file is missing or corrupt.
 */
export function readTaskMetadata(taskId: string, dataDir?: string): Record<string, unknown> {
	return readJsonFile<Record<string, unknown>>(taskMetadataPath(taskId, dataDir), {})
}

// ---------------------------------------------------------------------------
// MCP settings
// ---------------------------------------------------------------------------

/** Shape of the MCP settings file */
export interface McpSettingsFile {
	mcpServers: Record<
		string,
		{
			/** Command to run (stdio transport) */
			command?: string
			/** Arguments for the command */
			args?: string[]
			/** Environment variables */
			env?: Record<string, string>
			/** URL for SSE/streamableHTTP transport */
			url?: string
			/** Whether the server is disabled */
			disabled?: boolean
			/** Auto-approve settings for tools */
			autoApprove?: string[]
			/** Timeout in milliseconds */
			timeout?: number
			/** Transport type */
			transport?: "stdio" | "sse" | "streamableHttp"
		}
	>
}

/**
 * Read the MCP settings file.
 * Returns an empty mcpServers object if the file is missing or corrupt.
 */
export function readMcpSettings(dataDir?: string): McpSettingsFile {
	return readJsonFile<McpSettingsFile>(mcpSettingsPath(dataDir), { mcpServers: {} })
}

// ---------------------------------------------------------------------------
// Task directory listing
// ---------------------------------------------------------------------------

/**
 * List all task IDs that have directories on disk.
 * Returns an empty array if the tasks directory doesn't exist.
 */
export function listTaskIds(dataDir?: string): string[] {
	const tasksDir = path.join(resolveDataDir(dataDir), "tasks")
	try {
		if (!fs.existsSync(tasksDir)) {
			return []
		}
		return fs
			.readdirSync(tasksDir, { withFileTypes: true })
			.filter((dirent) => dirent.isDirectory())
			.map((dirent) => dirent.name)
	} catch (error) {
		Logger.warn(`[LegacyStateReader] Failed to list tasks in ${tasksDir}:`, error)
		return []
	}
}

// ---------------------------------------------------------------------------
// Composite reader
// ---------------------------------------------------------------------------

/** All legacy state read from disk in a single call */
export interface LegacyState {
	globalState: Partial<GlobalStateAndSettings>
	secrets: Partial<Secrets>
	taskHistory: HistoryItem[]
	mcpSettings: McpSettingsFile
}

/**
 * Read all legacy state from disk in a single call.
 * This is the primary entry point for bootstrapping the SDK adapter
 * from existing on-disk data.
 */
export function readAllLegacyState(dataDir?: string): LegacyState {
	return {
		globalState: readGlobalState(dataDir),
		secrets: readSecrets(dataDir),
		taskHistory: readTaskHistory(dataDir),
		mcpSettings: readMcpSettings(dataDir),
	}
}
