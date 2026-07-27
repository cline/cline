// Replaces classic src/core/storage/disk.ts reads (see origin/main)
//
// Reads (and, for legacy task maintenance, writes) on-disk state in the
// pre-SDK storage format from the Cline data directory, so the SDK adapter can
// surface tasks and settings created before the SDK migration and keep legacy
// task artifacts in sync when those tasks are resumed on the SDK build.
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
function globalStatePath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "globalState.json")
}

/** Path to secrets.json */
function secretsPath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "secrets.json")
}

/** Path to taskHistory.json (stored in state/ subdirectory) */
function taskHistoryPath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "state", "taskHistory.json")
}

/** Path to MCP settings file */
function mcpSettingsPath(dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "settings", "cline_mcp_settings.json")
}

/** Path to a task directory */
export function taskDirPath(taskId: string, dataDir?: string): string {
	return path.join(resolveDataDir(dataDir), "tasks", taskId)
}

/** Path to api_conversation_history.json for a task */
function apiConversationHistoryPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "api_conversation_history.json")
}

/** Path to ui_messages.json for a task */
function uiMessagesPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "ui_messages.json")
}

/** Path to context_history.json for a task */
function contextHistoryPath(taskId: string, dataDir?: string): string {
	return path.join(taskDirPath(taskId, dataDir), "context_history.json")
}

/** Path to task_metadata.json for a task */
function taskMetadataPath(taskId: string, dataDir?: string): string {
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

/**
 * Delete a legacy task from taskHistory.json and remove its task artifact directory.
 * Returns true when the task existed in legacy history.
 */
export function deleteLegacyTask(taskId: string, dataDir?: string): boolean {
	const historyPath = taskHistoryPath(dataDir)
	const history = readTaskHistory(dataDir)
	const filteredHistory = history.filter((item) => item.id !== taskId)
	const existed = filteredHistory.length !== history.length

	try {
		if (existed) {
			fs.mkdirSync(path.dirname(historyPath), { recursive: true })
			fs.writeFileSync(historyPath, JSON.stringify(filteredHistory, null, 2), "utf-8")
		}
		fs.rmSync(taskDirPath(taskId, dataDir), { recursive: true, force: true })
	} catch (error) {
		Logger.warn(`[LegacyStateReader] Failed to delete legacy task ${taskId}:`, error)
	}

	return existed
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
 * Say types the legacy extension persisted but the current webview no longer
 * renders (the pre-SDK auto-retry status rows). Dropped on read so old
 * transcripts don't degrade into raw-JSON text rows.
 */
const REMOVED_LEGACY_SAY_TYPES = new Set(["error_retry", "api_req_retried"])

/**
 * Read the UI messages for a specific task.
 * Returns an empty array if the file is missing or corrupt.
 */
export function readUiMessages(taskId: string, dataDir?: string): ClineMessage[] {
	const messages = readRawUiMessages(taskId, dataDir)
	return messages.filter((message) => !REMOVED_LEGACY_SAY_TYPES.has((message as { say?: string }).say ?? ""))
}

/**
 * Read the UI messages for a specific task exactly as stored on disk, without
 * dropping legacy-only say types. Used by the legacy write-back path, which
 * must preserve the untouched legacy prefix byte-for-byte.
 */
export function readRawUiMessages(taskId: string, dataDir?: string): ClineMessage[] {
	return readJsonFile<ClineMessage[]>(uiMessagesPath(taskId, dataDir), [])
}

/**
 * Overwrite a legacy task's conversation artifacts (api_conversation_history.json
 * and ui_messages.json). Used by the legacy write-back path so work added to a
 * resumed legacy task on the SDK build survives a rollback to the legacy build.
 * Throws on IO failure so callers can surface the error.
 */
export function writeLegacyTaskConversation(
	taskId: string,
	files: { apiConversationHistory: unknown[]; uiMessages: unknown[] },
	dataDir?: string,
): void {
	fs.mkdirSync(taskDirPath(taskId, dataDir), { recursive: true })
	fs.writeFileSync(apiConversationHistoryPath(taskId, dataDir), JSON.stringify(files.apiConversationHistory), "utf-8")
	fs.writeFileSync(uiMessagesPath(taskId, dataDir), JSON.stringify(files.uiMessages), "utf-8")
}

/**
 * Merge updated fields into an existing legacy taskHistory.json entry so the
 * legacy build's history list reflects work done on the SDK build (recency,
 * token counts, cost). Returns false when the task has no legacy entry.
 */
export function updateLegacyTaskHistoryItem(update: Partial<HistoryItem> & { id: string }, dataDir?: string): boolean {
	const historyPath = taskHistoryPath(dataDir)
	const history = readTaskHistory(dataDir)
	const index = history.findIndex((item) => item.id === update.id)
	if (index === -1) {
		return false
	}
	history[index] = { ...history[index], ...update }
	try {
		fs.mkdirSync(path.dirname(historyPath), { recursive: true })
		fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf-8")
		return true
	} catch (error) {
		Logger.warn(`[LegacyStateReader] Failed to update legacy task history item ${update.id}:`, error)
		return false
	}
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
