/**
 * SdkController
 *
 * The top-level adapter that wires the SDK session engine with the
 * existing webview protocol. It acts as the GrpcHandlerDelegate and
 * coordinates:
 *
 * - MessageTranslator: SDK events → ClineMessage[]
 * - StateBuilder: builds ExtensionState for webview
 * - GrpcHandler: handles webview gRPC requests
 * - Event bridge: pushes state/message updates to webview
 *
 * This replaces the classic Controller for SDK-powered sessions.
 */

import type { ApiConfiguration } from "@shared/api"
import type { ClineMessage, ExtensionState } from "@shared/ExtensionMessage"
import type { HistoryItem } from "@shared/HistoryItem"
import { Logger } from "@shared/services/Logger"
import type { Mode } from "@shared/storage/types"
import type { UserInfo } from "@shared/UserInfo"
import * as fs from "fs"
import * as path from "path"
import { type FileSearchResult, GrpcHandler, type GrpcHandlerDelegate, type McpServerProto } from "./grpc-handler"
import type { ClineAuthCredentials, LegacyStateReader } from "./legacy-state-reader"
import { type AgentDoneEvent, type AgentEvent, type AgentUsageEvent, MessageTranslator } from "./message-translator"
import { buildExtensionState, type StateBuilderInput } from "./state-builder"

// ---------------------------------------------------------------------------
// Session interface — what the SDK session looks like to us
// ---------------------------------------------------------------------------

export interface SdkSession {
	/** Send a prompt to the agent */
	sendPrompt(text: string, images?: string[]): Promise<void>

	/** Send a follow-up/response to a pending ask */
	sendResponse(text: string): Promise<void>

	/** Abort the current session */
	abort(): Promise<void>

	/** Subscribe to events from the session */
	onEvent(handler: (event: AgentEvent) => void): void

	/** Whether the session is currently running */
	isRunning(): boolean
}

/** Factory to create SDK sessions */
export type SessionFactory = (config: { apiConfiguration?: ApiConfiguration; mode?: Mode; cwd?: string }) => Promise<SdkSession>

// ---------------------------------------------------------------------------
// SdkController
// ---------------------------------------------------------------------------

export interface SdkControllerOptions {
	/** Function to create new SDK sessions */
	sessionFactory?: SessionFactory

	/** Extension version */
	version?: string

	/** Initial API configuration */
	apiConfiguration?: ApiConfiguration

	/** Initial mode */
	mode?: Mode

	/** Working directory */
	cwd?: string

	/** Task history (from persisted storage) */
	taskHistory?: HistoryItem[]

	/** Legacy state reader (for settings not yet migrated) */
	legacyState?: LegacyStateReader
}

export class SdkController implements GrpcHandlerDelegate {
	private translator: MessageTranslator
	private grpcHandler: GrpcHandler
	private sessionFactory?: SessionFactory
	private currentSession?: SdkSession

	// State
	private version: string
	private apiConfiguration?: ApiConfiguration
	private mode: Mode
	readonly cwd: string
	private taskHistory: HistoryItem[]
	private currentTaskItem?: HistoryItem
	private legacyState?: LegacyStateReader

	/** External push callbacks (registered by WebviewGrpcBridge) */
	private onPushStateCallback?: (state: ExtensionState) => void
	private onPushPartialMessageCallback?: (message: ClineMessage) => void

	constructor(options: SdkControllerOptions = {}) {
		this.version = options.version ?? "0.0.0"
		this.apiConfiguration = options.apiConfiguration
		this.mode = options.mode ?? "act"
		this.cwd = options.cwd ?? process.cwd()
		this.taskHistory = options.taskHistory ?? []
		this.sessionFactory = options.sessionFactory
		this.legacyState = options.legacyState

		this.translator = new MessageTranslator()
		this.grpcHandler = new GrpcHandler(this)
	}

	/** Get the gRPC handler (for wiring into the webview message system) */
	getGrpcHandler(): GrpcHandler {
		return this.grpcHandler
	}

	/** Get the message translator */
	getTranslator(): MessageTranslator {
		return this.translator
	}

	/** Register a callback for state push events */
	onPushState(callback: (state: ExtensionState) => void): void {
		this.onPushStateCallback = callback
	}

	/** Register a callback for partial message push events */
	onPushPartialMessage(callback: (message: ClineMessage) => void): void {
		this.onPushPartialMessageCallback = callback
	}

	// -----------------------------------------------------------------------
	// GrpcHandlerDelegate implementation
	// -----------------------------------------------------------------------

	getState(): ExtensionState {
		// Build userInfo from Cline auth credentials on disk
		let userInfo: UserInfo | undefined
		if (this.legacyState && typeof this.legacyState.readClineAuthInfo === "function") {
			const authInfo = this.legacyState.readClineAuthInfo()
			if (authInfo?.userInfo) {
				userInfo = {
					displayName: authInfo.userInfo.displayName || authInfo.userInfo.email,
					email: authInfo.userInfo.email,
				}
			}
		}

		const input: StateBuilderInput = {
			legacyState: this.legacyState,
			version: this.version,
			clineMessages: this.translator.getMessages(),
			currentTaskItem: this.currentTaskItem,
			taskHistory: this.taskHistory,
			mode: this.mode,
			apiConfiguration: this.apiConfiguration,
			userInfo,
		}
		return buildExtensionState(input)
	}

	/** Get the Cline auth credentials from disk (for use by grpc-handler) */
	getClineAuthInfo(): ClineAuthCredentials | null {
		if (this.legacyState && typeof this.legacyState.readClineAuthInfo === "function") {
			return this.legacyState.readClineAuthInfo()
		}
		return null
	}

	async newTask(text: string, images?: string[]): Promise<void> {
		// Reset translator for new task
		this.translator.reset()

		// Create task history item
		this.currentTaskItem = {
			id: `task_${Date.now()}`,
			ts: Date.now(),
			task: text,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: this.cwd,
		}

		// Add initial "task" message
		const taskMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "task",
			text,
		}
		this.translator.getMessages().push(taskMessage)

		// Push state update
		this.pushStateUpdate()

		// Create and start session if factory is available
		if (this.sessionFactory) {
			this.currentSession = await this.sessionFactory({
				apiConfiguration: this.apiConfiguration,
				mode: this.mode,
				cwd: this.cwd,
			})

			// Wire up event handler
			this.currentSession.onEvent((event) => this.handleSessionEvent(event))

			// Send prompt
			await this.currentSession.sendPrompt(text, images)
		}
	}

	async askResponse(_response: string, text?: string, images?: string[]): Promise<void> {
		// Add user feedback message if there's text
		if (text) {
			const feedbackMessage: ClineMessage = {
				ts: Date.now(),
				type: "say",
				say: "user_feedback",
				text,
			}
			this.translator.getMessages().push(feedbackMessage)
			this.pushStateUpdate()
		}

		if (this.currentSession) {
			// Send follow-up to the existing session
			const prompt = text || ""
			if (prompt) {
				await this.currentSession.sendResponse(prompt)
			}
		} else if (text && this.sessionFactory) {
			// No active session (e.g., after clearTask) — start a new one
			// This handles the case where the user types a follow-up after
			// the session has been disposed.
			await this.newTask(text, images)
		}
	}

	async clearTask(): Promise<void> {
		// Persist the current task before clearing (if there is one)
		this.persistCurrentTask()

		if (this.currentSession) {
			await this.currentSession.abort()
		}
		this.currentSession = undefined
		this.currentTaskItem = undefined
		this.translator.reset()
		this.pushStateUpdate()
	}

	async cancelTask(): Promise<void> {
		if (this.currentSession) {
			await this.currentSession.abort()
			// Clear the session so subsequent askResponse calls start a new task
			// instead of trying to send to the aborted session.
			this.currentSession = undefined
		}

		// Add resume_task ask so the webview shows the input for resuming
		const resumeMsg: ClineMessage = {
			ts: Date.now(),
			type: "ask",
			ask: "resume_task",
			text: "",
		}
		this.translator.getMessages().push(resumeMsg)
		this.grpcHandler.pushPartialMessage(resumeMsg)

		// Persist the task in its current state (can be resumed later)
		this.persistCurrentTask()

		this.pushStateUpdate()
	}

	getTaskHistory(offset?: number, limit?: number): HistoryItem[] {
		const start = offset ?? 0
		const end = limit ? start + limit : undefined
		return this.taskHistory.slice(start, end)
	}

	async showTaskWithId(id: string): Promise<void> {
		// Find the task in history
		const item = this.taskHistory.find((t) => t.id === id)
		if (!item) {
			return
		}

		// Load saved messages from disk
		let messages: ClineMessage[] = []
		if (this.legacyState) {
			try {
				const raw = this.legacyState.readUiMessages(id)
				messages = raw as ClineMessage[]
			} catch {
				// If messages can't be loaded, show the task with no messages
			}
		}

		// Reset current state and restore the task
		this.translator.reset()
		this.currentSession = undefined

		// Restore task item and messages
		this.currentTaskItem = { ...item }

		// Push loaded messages into the translator
		const translatorMessages = this.translator.getMessages()
		for (const msg of messages) {
			translatorMessages.push(msg)
		}

		this.pushStateUpdate()
	}

	async deleteTasksWithIds(ids: string[]): Promise<void> {
		if (ids.length === 0) {
			// Delete all — also delete task directories from disk
			if (this.legacyState) {
				for (const item of this.taskHistory) {
					try {
						this.legacyState.deleteTaskDirectory(item.id)
					} catch {
						// Best-effort
					}
				}
			}
			this.taskHistory = []
		} else {
			// Delete specific tasks and their directories
			if (this.legacyState) {
				for (const id of ids) {
					try {
						this.legacyState.deleteTaskDirectory(id)
					} catch {
						// Best-effort
					}
				}
			}
			this.taskHistory = this.taskHistory.filter((item) => !ids.includes(item.id))
		}

		// Persist updated task history
		this.persistTaskHistory()
		this.pushStateUpdate()
	}

	async updateApiConfiguration(config: Partial<ApiConfiguration>): Promise<void> {
		this.apiConfiguration = { ...this.apiConfiguration, ...config } as ApiConfiguration
		// Persist to disk so settings survive extension restart
		if (this.legacyState) {
			try {
				this.legacyState.saveApiConfiguration(config)
			} catch {
				// Best-effort persistence
			}
		}
		this.pushStateUpdate()
	}

	async togglePlanActMode(mode: Mode): Promise<void> {
		this.mode = mode
		// Persist mode to disk
		if (this.legacyState) {
			try {
				this.legacyState.saveMode(mode)
			} catch {
				// Best-effort persistence
			}
		}
		this.pushStateUpdate()
	}

	async updateSettings(settings: Record<string, unknown>): Promise<void> {
		// Settings come as key-value pairs that map to globalState keys.
		// Some keys are API handler settings (persisted via saveApiConfiguration),
		// while others are user settings (persisted directly to globalState.json).
		// We need to handle both types.
		if (this.legacyState) {
			try {
				const apiConfigUpdates: Partial<ApiConfiguration> = {}
				let hasApiConfig = false

				for (const [key, value] of Object.entries(settings)) {
					// Special handling for clineEnv: changing environment requires
					// logging out (auth tokens are environment-specific), matching
					// the classic extension's updateSettings behavior.
					if (key === "clineEnv" && typeof value === "string") {
						this.writeGlobalStateKey("clineEnv", value)
						// Log out when environment changes (tokens are env-specific)
						this.clearClineAuth()
						continue
					}
					// Try saving via saveApiConfiguration first (handles API keys + secrets)
					;(apiConfigUpdates as Record<string, unknown>)[key] = value
					hasApiConfig = true

					// Also write directly to globalState.json for user settings
					// (saveApiConfiguration only writes ApiHandlerSettingsKeys/SecretKeys,
					// so USER_SETTINGS_FIELDS like planActSeparateModelsSetting would be
					// silently dropped without this direct write)
					this.writeGlobalStateKey(key, value)
				}

				if (hasApiConfig) {
					this.legacyState.saveApiConfiguration(apiConfigUpdates)
				}
			} catch {
				// Best-effort persistence
			}
		}
		this.pushStateUpdate()
	}

	async updateAutoApprovalSettings(settings: Record<string, unknown>): Promise<void> {
		// Write auto-approval settings directly to globalState.json.
		// This cannot use saveApiConfiguration() because autoApprovalSettings
		// is a USER_SETTINGS_FIELD, not an API_HANDLER_SETTINGS_FIELD, so
		// saveApiConfiguration() silently drops it.
		this.writeGlobalStateKey("autoApprovalSettings", settings)
		this.pushStateUpdate()
	}

	// -----------------------------------------------------------------------
	// Session event handling
	// -----------------------------------------------------------------------

	/** Process an SDK event and push updates to webview */
	handleSessionEvent(event: AgentEvent): void {
		const update = this.translator.processEvent(event)

		// Update currentTaskItem with usage data
		if (event.type === "usage") {
			this.updateTaskItemUsage(event as AgentUsageEvent)
		}

		// On task completion, persist the task
		if (event.type === "done") {
			this.handleTaskDone(event as AgentDoneEvent)
		}

		// Push partial message updates for added/modified messages
		const messages = this.translator.getMessages()
		for (const idx of [...update.added, ...update.modified]) {
			if (idx >= 0 && idx < messages.length) {
				const msg = messages[idx]
				this.grpcHandler.pushPartialMessage(msg)
				this.onPushPartialMessageCallback?.(msg)
			}
		}

		// Push full state update if anything changed
		if (update.added.length > 0 || update.modified.length > 0) {
			this.pushStateUpdate()
		}
	}

	// -----------------------------------------------------------------------
	// Task persistence
	// -----------------------------------------------------------------------

	/** Update the current task item with usage data from a usage event */
	private updateTaskItemUsage(event: AgentUsageEvent): void {
		if (!this.currentTaskItem) return

		this.currentTaskItem.tokensIn = event.totalInputTokens
		this.currentTaskItem.tokensOut = event.totalOutputTokens
		if (event.totalCost !== undefined) {
			this.currentTaskItem.totalCost = event.totalCost
		}
		if (event.cacheWriteTokens !== undefined) {
			this.currentTaskItem.cacheWrites = event.cacheWriteTokens
		}
		if (event.cacheReadTokens !== undefined) {
			this.currentTaskItem.cacheReads = event.cacheReadTokens
		}
	}

	/** Handle task completion — update final usage and persist */
	private handleTaskDone(event: AgentDoneEvent): void {
		if (!this.currentTaskItem) return

		// Update with final usage from the done event
		if (event.usage) {
			this.currentTaskItem.tokensIn = event.usage.inputTokens
			this.currentTaskItem.tokensOut = event.usage.outputTokens
			if (event.usage.totalCost !== undefined) {
				this.currentTaskItem.totalCost = event.usage.totalCost
			}
			if (event.usage.cacheWriteTokens !== undefined) {
				this.currentTaskItem.cacheWrites = event.usage.cacheWriteTokens
			}
			if (event.usage.cacheReadTokens !== undefined) {
				this.currentTaskItem.cacheReads = event.usage.cacheReadTokens
			}
		}

		this.persistCurrentTask()
	}

	/**
	 * Persist the current task: add to history, save messages to disk,
	 * and write the updated task history file.
	 */
	private persistCurrentTask(): void {
		if (!this.currentTaskItem) return

		const taskId = this.currentTaskItem.id

		// Add or update in task history
		const existingIndex = this.taskHistory.findIndex((t) => t.id === taskId)
		if (existingIndex >= 0) {
			this.taskHistory[existingIndex] = { ...this.currentTaskItem }
		} else {
			this.taskHistory.unshift({ ...this.currentTaskItem })
		}

		// Save to disk
		if (this.legacyState) {
			try {
				// Save task history
				this.persistTaskHistory()

				// Save UI messages for this task
				const messages = this.translator.getMessages()
				if (messages.length > 0) {
					this.legacyState.saveUiMessages(taskId, messages)
				}
			} catch {
				// Best-effort persistence — don't crash
			}
		}
	}

	/** Persist the task history array to disk */
	private persistTaskHistory(): void {
		if (!this.legacyState) return

		try {
			this.legacyState.saveTaskHistory(this.taskHistory)
		} catch {
			// Best-effort persistence
		}
	}

	// -----------------------------------------------------------------------
	// File search (for @ mentions in chat)
	// -----------------------------------------------------------------------

	/** Injectable callback for platform-specific file picker */
	selectFilesCallback?: (allowImages: boolean) => Promise<{ images: string[]; files: string[] }>

	async searchFiles(query: string, type?: string, limit?: number): Promise<FileSearchResult[]> {
		const maxResults = limit ?? 200
		const results: FileSearchResult[] = []
		const queryLower = query.toLowerCase()

		// Skip directories that are typically not useful
		const SKIP_DIRS = new Set([
			"node_modules",
			".git",
			"__pycache__",
			".venv",
			"venv",
			".next",
			".nuxt",
			"dist",
			"build",
			"out",
			".cache",
			"coverage",
			".nyc_output",
			".tox",
			".eggs",
		])

		const walk = (dir: string, prefix: string, depth: number) => {
			if (results.length >= maxResults || depth > 8) return
			let entries: fs.Dirent[]
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true })
			} catch {
				return // Skip unreadable directories
			}
			for (const entry of entries) {
				if (results.length >= maxResults) break
				if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue

				const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
				const isDir = entry.isDirectory()
				const entryType = isDir ? "folder" : "file"

				// Apply type filter
				if (type === "file" && isDir) {
					// Still recurse into directories to find files
				} else if (type === "folder" && !isDir) {
					// Skip files when looking for folders only
				} else {
					// Match against query (empty query returns all)
					if (!query || relPath.toLowerCase().includes(queryLower)) {
						results.push({ path: relPath, type: entryType, label: entry.name })
					}
				}

				if (isDir) {
					walk(path.join(dir, entry.name), relPath, depth + 1)
				}
			}
		}

		walk(this.cwd, "", 0)
		return results
	}

	async selectFiles(allowImages: boolean): Promise<{ images: string[]; files: string[] }> {
		if (this.selectFilesCallback) {
			return this.selectFilesCallback(allowImages)
		}
		return { images: [], files: [] }
	}

	// -----------------------------------------------------------------------
	// State persistence (globalState.json read/write)
	// -----------------------------------------------------------------------

	/** Read a value from persistent global state */
	readGlobalStateKey(key: string): unknown {
		if (!this.legacyState) return undefined
		const gs = this.legacyState.readGlobalState()
		return (gs as Record<string, unknown>)[key]
	}

	/**
	 * Write a value to persistent global state and push state update.
	 * Writes the key to globalState.json and triggers a webview state push.
	 */
	writeGlobalStateKey(key: string, value: unknown): void {
		if (!this.legacyState) return

		const gsPath = path.join(this.legacyState.dataDir, "globalState.json")
		let gs: Record<string, unknown>
		try {
			const raw = fs.readFileSync(gsPath, "utf-8")
			gs = JSON.parse(raw)
		} catch {
			gs = {}
		}

		if (value === undefined) {
			delete gs[key]
		} else {
			gs[key] = value
		}

		// Atomic write
		try {
			const dir = path.dirname(gsPath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			const tmpPath = `${gsPath}.tmp.${process.pid}`
			fs.writeFileSync(tmpPath, JSON.stringify(gs, null, "\t"), "utf-8")
			fs.renameSync(tmpPath, gsPath)
		} catch (err) {
			Logger.error(`[SdkController] Failed to write globalState key "${key}":`, err)
		}

		// Push state update so the webview reflects the change
		this.pushStateUpdate()
	}

	// -----------------------------------------------------------------------
	// Task operations
	// -----------------------------------------------------------------------

	/**
	 * Toggle the favorite flag on a task history item.
	 * Persists the change to disk and pushes state update.
	 */
	async toggleTaskFavorite(taskId: string, isFavorite: boolean): Promise<void> {
		const item = this.taskHistory.find((t) => t.id === taskId)
		if (item) {
			item.isFavorited = isFavorite
			this.persistTaskHistory()
			this.pushStateUpdate()
		}
	}

	/**
	 * Get the total disk size of all task storage in bytes.
	 * Recursively sums file sizes under ~/.cline/data/tasks/.
	 */
	async getTotalTasksSize(): Promise<number> {
		if (!this.legacyState) return 0
		const tasksDir = path.join(this.legacyState.dataDir, "tasks")
		return this.getDirectorySize(tasksDir)
	}

	/**
	 * Export a task by ID. Platform-specific (save dialog) is handled
	 * by the exportTaskCallback if set.
	 */
	async exportTaskWithId(taskId: string): Promise<void> {
		if (this.exportTaskCallback) {
			const item = this.taskHistory.find((t) => t.id === taskId)
			if (!item) return

			// Load messages
			let messages: unknown[] = []
			if (this.legacyState) {
				try {
					messages = this.legacyState.readUiMessages(taskId)
				} catch {
					// Best-effort
				}
			}

			await this.exportTaskCallback(taskId, item, messages)
		}
	}

	/** Injectable callback for platform-specific task export */
	exportTaskCallback?: (taskId: string, item: HistoryItem, messages: unknown[]) => Promise<void>

	// -----------------------------------------------------------------------
	// Platform operations (injectable callbacks)
	// -----------------------------------------------------------------------

	/** Injectable callback for opening URLs */
	openUrlCallback?: (url: string) => Promise<void>

	/** Injectable callback for opening files in the editor */
	openFileCallback?: (filePath: string) => Promise<void>

	/** Injectable callback for copying text to clipboard */
	copyToClipboardCallback?: (text: string) => Promise<void>

	/** Injectable callback for opening MCP settings */
	openMcpSettingsCallback?: () => Promise<void>

	async openUrl(url: string): Promise<void> {
		if (this.openUrlCallback) {
			await this.openUrlCallback(url)
		}
	}

	async openFile(filePath: string): Promise<void> {
		if (this.openFileCallback) {
			await this.openFileCallback(filePath)
		}
	}

	async copyToClipboard(text: string): Promise<void> {
		if (this.copyToClipboardCallback) {
			await this.copyToClipboardCallback(text)
		}
	}

	async openMcpSettings(): Promise<void> {
		if (this.openMcpSettingsCallback) {
			await this.openMcpSettingsCallback()
		}
	}

	// -----------------------------------------------------------------------
	// Data queries
	// -----------------------------------------------------------------------

	/**
	 * Convert absolute/URI paths to workspace-relative paths.
	 */
	async getRelativePaths(uris: string[]): Promise<string[]> {
		return uris.map((uri) => {
			// Handle file:// URIs
			let filePath = uri
			if (filePath.startsWith("file://")) {
				filePath = decodeURIComponent(filePath.replace("file://", ""))
			}

			// Make relative to cwd
			if (filePath.startsWith(this.cwd)) {
				const rel = filePath.substring(this.cwd.length)
				// Remove leading separator
				return rel.startsWith("/") || rel.startsWith("\\") ? rel.substring(1) : rel
			}
			return filePath
		})
	}

	/**
	 * Check if a URL points to an image by making a HEAD request.
	 */
	async checkIsImageUrl(url: string): Promise<boolean> {
		// Quick check by extension first
		const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]
		if (imageExtensions.some((ext) => url.toLowerCase().endsWith(ext))) {
			return true
		}

		// Try HEAD request for content-type (with timeout)
		try {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 3000)
			const response = await globalThis.fetch(url, {
				method: "HEAD",
				signal: controller.signal,
			})
			clearTimeout(timeout)
			const contentType = response.headers.get("content-type") ?? ""
			return contentType.startsWith("image/")
		} catch {
			return false
		}
	}

	// -----------------------------------------------------------------------
	// Model discovery
	// -----------------------------------------------------------------------

	/**
	 * Fetch available models from a local Ollama endpoint.
	 * Ollama API: GET /api/tags → { models: [{ name: "...", ... }] }
	 */
	async getOllamaModels(endpoint: string): Promise<string[]> {
		try {
			const baseUrl = endpoint.replace(/\/+$/, "")
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 5000)
			const response = await globalThis.fetch(`${baseUrl}/api/tags`, {
				signal: controller.signal,
			})
			clearTimeout(timeout)
			if (!response.ok) return []
			const data = (await response.json()) as { models?: Array<{ name: string }> }
			return (data.models ?? []).map((m) => m.name)
		} catch {
			return []
		}
	}

	/**
	 * Fetch available models from a local LM Studio endpoint.
	 * LM Studio API (OpenAI-compatible): GET /v1/models → { data: [{ id: "..." }] }
	 */
	async getLmStudioModels(endpoint: string): Promise<string[]> {
		try {
			const baseUrl = endpoint.replace(/\/+$/, "")
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 5000)
			const response = await globalThis.fetch(`${baseUrl}/v1/models`, {
				signal: controller.signal,
			})
			clearTimeout(timeout)
			if (!response.ok) return []
			const data = (await response.json()) as { data?: Array<{ id: string }> }
			return (data.data ?? []).map((m) => m.id)
		} catch {
			return []
		}
	}

	// -----------------------------------------------------------------------
	// MCP servers
	// -----------------------------------------------------------------------

	/**
	 * Read MCP servers from ~/.cline/data/settings/cline_mcp_settings.json
	 * and return them in proto-compatible format for the webview.
	 *
	 * The settings file format is:
	 * { "mcpServers": { "name": { "command": "...", "args": [...], "disabled": bool, ... } } }
	 *
	 * We convert each entry to a McpServerProto with status=0 (disconnected)
	 * since we're not actually running MCP servers in SDK mode.
	 */
	getMcpServers(): McpServerProto[] {
		if (!this.legacyState) return []

		try {
			const settings = this.legacyState.readMcpSettings()
			if (!settings) return []

			const mcpServersMap = (settings as Record<string, unknown>).mcpServers as Record<string, unknown> | undefined
			if (!mcpServersMap || typeof mcpServersMap !== "object") return []

			const DEFAULT_TIMEOUT = 60

			return Object.entries(mcpServersMap).map(([name, configObj]) => {
				const config = (configObj as Record<string, unknown>) ?? {}
				const disabled = (config.disabled as boolean) ?? false
				const timeout = (config.timeout as number) ?? DEFAULT_TIMEOUT

				return {
					name,
					config: JSON.stringify(configObj),
					// Proto McpServerStatus: 0=DISCONNECTED, 1=CONNECTED, 2=CONNECTING
					status: 0,
					error: "",
					tools: [],
					resources: [],
					resourceTemplates: [],
					prompts: [],
					disabled,
					timeout,
				}
			})
		} catch (err) {
			Logger.error("[SdkController] Failed to read MCP settings:", err)
			return []
		}
	}

	// -----------------------------------------------------------------------
	// Account operations
	// -----------------------------------------------------------------------

	/**
	 * Clear Cline auth credentials (logout).
	 * Removes credentials from disk and pushes state update.
	 */
	clearClineAuth(): void {
		if (this.legacyState) {
			this.legacyState.clearClineAuthInfo()
		}
		this.pushStateUpdate()
	}

	/**
	 * Update the active organization.
	 * Persists the change to disk and pushes state update.
	 */
	setActiveOrganization(organizationId: string | undefined): void {
		if (this.legacyState) {
			this.legacyState.setActiveOrganization(organizationId)
		}
		this.pushStateUpdate()
	}

	/**
	 * Fetch user credits from the Cline API using stored auth token.
	 * Returns credit balance and usage data in the proto format the webview expects.
	 *
	 * Uses the same endpoint as ClineAccountService.fetchBalanceRPC():
	 *   GET https://api.cline.bot/api/v1/users/{userId}/balance
	 *   Authorization: Bearer workos:{idToken}
	 * Response: { data: { userId, balance }, success: true }
	 * The balance value is in cents; we divide by 100 to match the original
	 * getUserCredits handler which does `balance.balance / 100`.
	 */
	async fetchUserCredits(): Promise<{
		balance?: { currentBalance: number }
		usageTransactions?: unknown[]
		paymentTransactions?: unknown[]
	}> {
		const authInfo = this.legacyState?.readClineAuthInfo()
		if (!authInfo?.idToken || !authInfo?.userInfo?.id) {
			return { balance: undefined }
		}

		// Use appBaseUrl from auth credentials if set (e.g. for testing),
		// otherwise fall back to the production Cline API endpoint.
		const apiBaseUrl = authInfo.userInfo?.appBaseUrl ?? "https://api.cline.bot"
		const userId = authInfo.userInfo.id
		const apiUrl = `${apiBaseUrl}/api/v1/users/${userId}/balance`
		// The Cline API requires the "workos:" prefix on the auth token
		const authToken = authInfo.idToken.startsWith("workos:") ? authInfo.idToken : `workos:${authInfo.idToken}`

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 10000)
		try {
			const response = await globalThis.fetch(apiUrl, {
				headers: {
					Authorization: `Bearer ${authToken}`,
					"Content-Type": "application/json",
				},
				signal: controller.signal,
			})
			clearTimeout(timeout)
			if (!response.ok) {
				throw new Error(`Credits API returned ${response.status}`)
			}
			const json = (await response.json()) as { data?: { balance?: number }; success?: boolean }
			const balanceValue = json.data?.balance
			return {
				balance: balanceValue !== undefined ? { currentBalance: balanceValue / 100 } : undefined,
				usageTransactions: [],
				paymentTransactions: [],
			}
		} catch (err) {
			clearTimeout(timeout)
			Logger.error("[SdkController] Failed to fetch user credits:", err)
			return { balance: undefined }
		}
	}

	/**
	 * Fetch organization credits from the Cline API.
	 *
	 * Uses the same endpoint as ClineAccountService.fetchOrganizationBalanceRPC():
	 *   GET https://api.cline.bot/api/v1/organizations/{organizationId}/balance
	 *   Authorization: Bearer workos:{idToken}
	 * Response: { data: { organizationId, balance }, success: true }
	 */
	async fetchOrganizationCredits(
		organizationId: string,
	): Promise<{ balance?: { currentBalance: number }; usageTransactions?: unknown[] }> {
		const authInfo = this.legacyState?.readClineAuthInfo()
		if (!authInfo?.idToken) {
			return { balance: undefined }
		}

		const apiBaseUrl = authInfo.userInfo?.appBaseUrl ?? "https://api.cline.bot"
		const apiUrl = `${apiBaseUrl}/api/v1/organizations/${organizationId}/balance`
		const authToken = authInfo.idToken.startsWith("workos:") ? authInfo.idToken : `workos:${authInfo.idToken}`

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 10000)
		try {
			const response = await globalThis.fetch(apiUrl, {
				headers: {
					Authorization: `Bearer ${authToken}`,
					"Content-Type": "application/json",
				},
				signal: controller.signal,
			})
			clearTimeout(timeout)
			if (!response.ok) {
				throw new Error(`Org credits API returned ${response.status}`)
			}
			const json = (await response.json()) as { data?: { balance?: number; organizationId?: string }; success?: boolean }
			const balanceValue = json.data?.balance
			return {
				balance: balanceValue !== undefined ? { currentBalance: balanceValue / 100 } : undefined,
				usageTransactions: [],
			}
		} catch (err) {
			clearTimeout(timeout)
			Logger.error("[SdkController] Failed to fetch org credits:", err)
			return { balance: undefined }
		}
	}

	// -----------------------------------------------------------------------
	// Helpers
	// -----------------------------------------------------------------------

	private pushStateUpdate(): void {
		const state = this.getState()
		this.grpcHandler.pushState(state)
		this.onPushStateCallback?.(state)
	}

	/**
	 * Recursively calculate the total size of a directory in bytes.
	 * Returns 0 if the directory doesn't exist or can't be read.
	 */
	private getDirectorySize(dirPath: string): number {
		try {
			if (!fs.existsSync(dirPath)) return 0
			let totalSize = 0
			const entries = fs.readdirSync(dirPath, { withFileTypes: true })
			for (const entry of entries) {
				const entryPath = path.join(dirPath, entry.name)
				if (entry.isDirectory()) {
					totalSize += this.getDirectorySize(entryPath)
				} else if (entry.isFile()) {
					try {
						totalSize += fs.statSync(entryPath).size
					} catch {
						// Skip files we can't stat
					}
				}
			}
			return totalSize
		} catch {
			return 0
		}
	}
}
