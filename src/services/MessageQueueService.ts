/**
 * Message Queue Service
 *
 * Enables bidirectional communication between Claude Code and Cline via file-based messaging.
 * This allows external processes to send commands to Cline and receive responses.
 */

import * as fs from "fs"
import * as path from "path"
import type { Controller } from "@/core/controller"
import { combineApiRequests } from "@/shared/combineApiRequests"
import { combineCommandSequences } from "@/shared/combineCommandSequences"
import { getApiMetrics } from "@/shared/getApiMetrics"

interface Message {
	id: string
	from: "claude-code" | "cline" | string
	to: "claude-code" | "cline" | string
	timestamp: string
	type: "command" | "response" | "notification"
	content: string
	metadata: {
		replyTo?: string
		[key: string]: any
	}
}

export class MessageQueueService {
	private static instance: MessageQueueService | null = null
	private queueDir: string
	private inboxDir: string
	private outboxDir: string
	private responsesDir: string
	private watcher: fs.FSWatcher | null = null
	private enabled: boolean = true
	private onMessageCallback: ((message: Message) => Promise<string | void>) | null = null
	private logMessages: string[] = []
	private controller: Controller | null = null

	private constructor(workspaceRoot: string) {
		this.queueDir = path.join(workspaceRoot, ".message-queue")
		this.inboxDir = path.join(this.queueDir, "inbox")
		this.outboxDir = path.join(this.queueDir, "outbox")
		this.responsesDir = path.join(this.queueDir, "responses")

		this.ensureDirectories()
		this.log("Message Queue Service initialized")
	}

	public static getInstance(workspaceRoot?: string): MessageQueueService {
		if (!MessageQueueService.instance && workspaceRoot) {
			MessageQueueService.instance = new MessageQueueService(workspaceRoot)
		}
		if (!MessageQueueService.instance) {
			throw new Error("MessageQueueService not initialized. Call getInstance with workspaceRoot first.")
		}
		return MessageQueueService.instance
	}

	public static reset(): void {
		if (MessageQueueService.instance) {
			MessageQueueService.instance.dispose()
			MessageQueueService.instance = null
		}
	}

	private ensureDirectories(): void {
		const dirs = [this.queueDir, this.inboxDir, this.outboxDir, this.responsesDir]
		dirs.forEach((dir) => {
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
				this.log(`Created directory: ${dir}`)
			}
		})
	}

	/**
	 * Set the controller reference for model switching
	 */
	public setController(controller: Controller): void {
		this.controller = controller
		this.log("Controller reference set")
	}

	/**
	 * Set the callback function that will handle incoming messages
	 */
	public setMessageHandler(handler: (message: Message) => Promise<string | void>): void {
		this.onMessageCallback = handler
		this.log("Message handler registered")
	}

	/**
	 * Start watching for incoming messages
	 */
	public startWatching(): void {
		if (this.watcher) {
			this.log("Already watching for messages")
			return
		}

		this.log(`Starting to watch: ${this.inboxDir}`)

		// Process existing messages
		this.processExistingMessages()

		// Watch for new messages
		this.watcher = fs.watch(this.inboxDir, (eventType, filename) => {
			if (filename && filename.endsWith(".json") && eventType === "rename") {
				// 'rename' event fires when file is created
				setTimeout(() => {
					const filePath = path.join(this.inboxDir, filename)
					if (fs.existsSync(filePath)) {
						this.processMessage(filePath)
					}
				}, 100) // Small delay to ensure file is fully written
			}
		})

		this.log("Message watcher started")
		// Notification shown via console log
	}

	/**
	 * Stop watching for messages
	 */
	public stopWatching(): void {
		if (this.watcher) {
			this.watcher.close()
			this.watcher = null
			this.log("Message watcher stopped")
		}
	}

	/**
	 * Process all existing messages in the inbox
	 */
	private processExistingMessages(): void {
		try {
			const files = fs.readdirSync(this.inboxDir)
			const messageFiles = files.filter((f) => f.endsWith(".json"))

			if (messageFiles.length > 0) {
				this.log(`Found ${messageFiles.length} existing message(s)`)
				messageFiles.forEach((filename) => {
					this.processMessage(path.join(this.inboxDir, filename))
				})
			}
		} catch (error) {
			this.log(`Error processing existing messages: ${error}`)
		}
	}

	/**
	 * Process a single message file
	 */
	private async processMessage(filePath: string): Promise<void> {
		try {
			const content = fs.readFileSync(filePath, "utf8")
			const message: Message = JSON.parse(content)

			this.log(`📨 Received message from ${message.from}:`)
			this.log(`   ID: ${message.id}`)
			this.log(`   Type: ${message.type}`)
			this.log(`   Content: ${message.content}`)

			// Check for special commands
			let responseContent: string | void

			// Handle model switching command: "set-model:provider/model-name"
			if (message.content.startsWith("set-model:")) {
				const modelId = message.content.substring("set-model:".length).trim()
				responseContent = await this.handleModelSwitch(modelId)
			}
			// Handle usage/cost query: "get-usage"
			else if (message.content === "get-usage" || message.content === "get-tokens" || message.content === "get-cost") {
				responseContent = await this.handleGetUsage()
			}
			// Handle enable-all-commands: enables auto-approval for ALL terminal commands (including PowerShell)
			else if (message.content === "enable-all-commands" || message.content === "yolo-commands") {
				responseContent = await this.handleEnableAllCommands()
			}
			// Handle auto-approve-all: enables all auto-approval settings
			else if (message.content === "auto-approve-all" || message.content === "yolo-mode") {
				responseContent = await this.handleAutoApproveAll()
			}
			// Handle other special commands here...
			else {
				// Default: Call the message handler if registered
				responseContent = `Cline received your message: "${message.content}"`

				if (this.onMessageCallback) {
					try {
						responseContent = await this.onMessageCallback(message)
					} catch (error) {
						this.log(`Error in message handler: ${error}`)
						responseContent = `Error processing message: ${error}`
					}
				}
			}

			// Send response if we have content
			if (responseContent) {
				this.sendResponse(message.id, responseContent)
			}

			// Delete processed message
			fs.unlinkSync(filePath)
			this.log(`✅ Message processed and cleaned up`)
		} catch (error) {
			this.log(`❌ Error processing message ${path.basename(filePath)}: ${error}`)
		}
	}

	/**
	 * Handle model switching command
	 * @param modelId The OpenRouter model ID (e.g., "anthropic/claude-3.5-sonnet")
	 */
	private async handleModelSwitch(modelId: string): Promise<string> {
		if (!this.controller) {
			this.log(`❌ Cannot switch model: Controller not set`)
			return `Error: Controller not initialized. Cannot switch model.`
		}

		if (!modelId) {
			return `Error: No model ID provided. Use format: set-model:provider/model-name`
		}

		try {
			const currentConfig = this.controller.stateManager.getApiConfiguration()

			// Update the configuration with new model ID for both plan and act modes
			this.controller.stateManager.setApiConfiguration({
				...currentConfig,
				planModeOpenRouterModelId: modelId,
				actModeOpenRouterModelId: modelId,
			})

			this.log(`✅ Model switched to: ${modelId}`)
			return `Model changed to: ${modelId}`
		} catch (error) {
			this.log(`❌ Error switching model: ${error}`)
			return `Error switching model: ${error}`
		}
	}

	/**
	 * Handle get-usage command - returns token usage and cost for current task
	 */
	private async handleGetUsage(): Promise<string> {
		if (!this.controller) {
			return `Error: Controller not initialized. Cannot get usage.`
		}

		try {
			const task = this.controller.task
			if (!task) {
				return `No active task. Usage: Tokens In: 0, Tokens Out: 0, Cost: $0.00`
			}

			const clineMessages = task.messageStateHandler.getClineMessages()
			const combinedMessages = combineApiRequests(combineCommandSequences(clineMessages.slice(1)))
			const apiMetrics = getApiMetrics(combinedMessages)

			const currentModel = this.controller.stateManager.getApiConfiguration()
			const modelId = currentModel.planModeOpenRouterModelId || currentModel.actModeOpenRouterModelId || "unknown"

			const usage = {
				model: modelId,
				tokensIn: apiMetrics.totalTokensIn,
				tokensOut: apiMetrics.totalTokensOut,
				cacheWrites: apiMetrics.totalCacheWrites || 0,
				cacheReads: apiMetrics.totalCacheReads || 0,
				totalCost: apiMetrics.totalCost,
			}

			this.log(`📊 Usage report: ${JSON.stringify(usage)}`)
			return `Usage Report | Model: ${usage.model} | Tokens In: ${usage.tokensIn.toLocaleString()} | Tokens Out: ${usage.tokensOut.toLocaleString()} | Cache: W${usage.cacheWrites}/R${usage.cacheReads} | Cost: $${usage.totalCost.toFixed(4)}`
		} catch (error) {
			this.log(`❌ Error getting usage: ${error}`)
			return `Error getting usage: ${error}`
		}
	}

	/**
	 * Handle enable-all-commands - enables auto-approval for ALL terminal commands
	 * This allows PowerShell scripts and other "risky" commands to run without approval
	 */
	private async handleEnableAllCommands(): Promise<string> {
		if (!this.controller) {
			return `Error: Controller not initialized. Cannot update settings.`
		}

		try {
			const currentSettings = this.controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			const updatedSettings = {
				...currentSettings,
				version: (currentSettings.version || 1) + 1,
				enabled: true,
				actions: {
					...currentSettings.actions,
					executeSafeCommands: true,
					executeAllCommands: true,
				},
			}

			this.controller.stateManager.setGlobalState("autoApprovalSettings", updatedSettings)
			await this.controller.postStateToWebview()

			this.log(`✅ Enabled auto-approval for ALL commands (including PowerShell)`)
			return `All commands auto-approval ENABLED. PowerShell scripts will now execute without prompts.`
		} catch (error) {
			this.log(`❌ Error enabling all commands: ${error}`)
			return `Error enabling all commands: ${error}`
		}
	}

	/**
	 * Handle auto-approve-all - enables ALL auto-approval settings (full YOLO mode)
	 */
	private async handleAutoApproveAll(): Promise<string> {
		if (!this.controller) {
			return `Error: Controller not initialized. Cannot update settings.`
		}

		try {
			const currentSettings = this.controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
			const updatedSettings = {
				...currentSettings,
				version: (currentSettings.version || 1) + 1,
				enabled: true,
				actions: {
					readFiles: true,
					readFilesExternally: true,
					editFiles: true,
					editFilesExternally: true,
					executeSafeCommands: true,
					executeAllCommands: true,
					useBrowser: true,
					useMcp: true,
				},
			}

			this.controller.stateManager.setGlobalState("autoApprovalSettings", updatedSettings)
			await this.controller.postStateToWebview()

			this.log(`✅ Enabled FULL auto-approval (YOLO mode)`)
			return `FULL auto-approval ENABLED. All actions will be auto-approved: read, edit, commands, browser, MCP.`
		} catch (error) {
			this.log(`❌ Error enabling auto-approve-all: ${error}`)
			return `Error enabling auto-approve-all: ${error}`
		}
	}

	/**
	 * Send a response to a message
	 */
	private sendResponse(replyToId: string, content: string): void {
		const response: Message = {
			id: this.generateId(),
			from: "cline",
			to: "claude-code",
			timestamp: new Date().toISOString(),
			type: "response",
			content: content,
			metadata: {
				replyTo: replyToId,
			},
		}

		const filename = `${Date.now()}_${response.id.substring(0, 8)}.json`
		const filepath = path.join(this.responsesDir, filename)

		fs.writeFileSync(filepath, JSON.stringify(response, null, 2))
		this.log(`✅ Response sent: ${content}`)
	}

	/**
	 * Send a message to Claude Code (outbox)
	 */
	public sendMessage(content: string, type: "notification" | "response" = "notification", replyTo?: string): string {
		this.ensureDirectories()

		const message: Message = {
			id: this.generateId(),
			from: "cline",
			to: "claude-code",
			timestamp: new Date().toISOString(),
			type: type,
			content: content,
			metadata: replyTo ? { replyTo } : {},
		}

		const filename = `${Date.now()}_${message.id.substring(0, 8)}.json`
		const filepath = path.join(this.outboxDir, filename)

		fs.writeFileSync(filepath, JSON.stringify(message, null, 2))
		this.log(`📤 Message sent to Claude Code: ${content}`)

		return message.id
	}

	/**
	 * Send completion notification back to CLI
	 */
	public sendTaskCompletion(originalMessageId: string, result: string): void {
		this.sendResponse(originalMessageId, `Task completed: ${result}`)
	}

	/**
	 * Generate a UUID
	 */
	private generateId(): string {
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0
			const v = c === "x" ? r : (r & 0x3) | 0x8
			return v.toString(16)
		})
	}

	/**
	 * Cleanup old messages (older than 1 hour)
	 */
	public cleanupOldMessages(): void {
		const oneHourAgo = Date.now() - 60 * 60 * 1000
		const dirs = [this.inboxDir, this.outboxDir, this.responsesDir]

		dirs.forEach((dir) => {
			if (!fs.existsSync(dir)) return

			const files = fs.readdirSync(dir)
			let cleaned = 0

			files.forEach((file) => {
				const filePath = path.join(dir, file)
				try {
					const stats = fs.statSync(filePath)
					if (stats.mtimeMs < oneHourAgo) {
						fs.unlinkSync(filePath)
						cleaned++
					}
				} catch (error) {
					// Ignore errors on individual files
				}
			})

			if (cleaned > 0) {
				this.log(`🗑️  Cleaned up ${cleaned} old message(s) from ${path.basename(dir)}`)
			}
		})
	}

	/**
	 * Log message (stored in memory)
	 */
	private log(message: string): void {
		const timestamp = new Date().toISOString()
		const logEntry = `[${timestamp}] ${message}`
		this.logMessages.push(logEntry)

		// Keep only last 100 messages
		if (this.logMessages.length > 100) {
			this.logMessages.shift()
		}

		// Also log to console
		console.log(`[MessageQueue] ${logEntry}`)
	}

	/**
	 * Get log messages
	 */
	public getLogs(): string[] {
		return [...this.logMessages]
	}

	/**
	 * Enable/disable the service
	 */
	public setEnabled(enabled: boolean): void {
		this.enabled = enabled
		if (enabled) {
			this.startWatching()
		} else {
			this.stopWatching()
		}
		this.log(`Message Queue Service ${enabled ? "enabled" : "disabled"}`)
	}

	/**
	 * Check if service is enabled
	 */
	public isEnabled(): boolean {
		return this.enabled
	}

	/**
	 * Dispose of resources
	 */
	public dispose(): void {
		this.stopWatching()
		this.log("Message Queue Service disposed")
		this.logMessages = []
	}
}
