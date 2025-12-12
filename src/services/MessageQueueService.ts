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
	private workspaceRoot: string
	private watcher: fs.FSWatcher | null = null
	private enabled: boolean = true
	private onMessageCallback: ((message: Message) => Promise<string | undefined>) | null = null
	private logMessages: string[] = []
	private controller: Controller | null = null

	private constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot
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
	public setMessageHandler(handler: (message: Message) => Promise<string | undefined>): void {
		this.onMessageCallback = handler
		this.log("Message handler registered")
	}

	private simpleQueueInterval: NodeJS.Timeout | null = null
	private simpleQueueFile: string = ""

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

		// Also start the simple text file queue watcher
		this.startSimpleQueueWatcher()

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
		this.stopSimpleQueueWatcher()
	}

	/**
	 * Start the simple text file queue watcher (polls copilot-to-cline.txt)
	 */
	private startSimpleQueueWatcher(): void {
		if (this.simpleQueueInterval) {
			return // Already running
		}

		this.simpleQueueFile = path.join(this.queueDir, "copilot-to-cline.txt")
		const responseFile = path.join(this.queueDir, "cline-to-copilot.txt")

		this.log(`Starting simple queue watcher: ${this.simpleQueueFile}`)

		// Poll every 2 seconds for messages
		this.simpleQueueInterval = setInterval(async () => {
			try {
				if (fs.existsSync(this.simpleQueueFile)) {
					const content = fs.readFileSync(this.simpleQueueFile, "utf8").trim()
					if (content) {
						this.log(`📨 Simple queue message: ${content}`)

						// Clear the file immediately to prevent re-processing
						fs.writeFileSync(this.simpleQueueFile, "")

						// Process the message
						const response = await this.processSimpleMessage(content)

						// Write response
						if (response) {
							fs.writeFileSync(responseFile, response)
							this.log(`📤 Response written to cline-to-copilot.txt`)
						}
					}
				}
			} catch (_error) {
				// Silently ignore errors (file might be locked, etc.)
			}
		}, 2000)

		this.log("Simple queue watcher started (2s polling)")
	}

	/**
	 * Stop the simple text file queue watcher
	 */
	private stopSimpleQueueWatcher(): void {
		if (this.simpleQueueInterval) {
			clearInterval(this.simpleQueueInterval)
			this.simpleQueueInterval = null
			this.log("Simple queue watcher stopped")
		}
	}

	/**
	 * Process a simple text message (from copilot-to-cline.txt)
	 */
	private async processSimpleMessage(content: string): Promise<string> {
		// Handle pipeline orchestration: "pipeline: claude->codex->gemini: prompt"
		if (content.startsWith("pipeline:")) {
			return await this.handlePipeline(content.substring("pipeline:".length).trim())
		}
		// Handle parallel execution: "parallel: claude+codex+gemini: prompt"
		if (content.startsWith("parallel:")) {
			return await this.handleParallel(content.substring("parallel:".length).trim())
		}
		// Handle CLI routing prefixes (check -yolo variants first since they're more specific)
		if (content.startsWith("claude-yolo:")) {
			const prompt = content.substring("claude-yolo:".length).trim()
			return await this.handleClaudeCli(prompt, true) // yolo = auto-approve all
		}
		if (content.startsWith("claude:")) {
			const prompt = content.substring("claude:".length).trim()
			return await this.handleClaudeCli(prompt, true)
		}
		if (content.startsWith("codex-yolo:")) {
			const prompt = content.substring("codex-yolo:".length).trim()
			return await this.handleCodexCli(prompt, true) // yolo = bypass sandbox
		}
		if (content.startsWith("codex:")) {
			const prompt = content.substring("codex:".length).trim()
			return await this.handleCodexCli(prompt, true)
		}
		if (content.startsWith("gemini-yolo:")) {
			const prompt = content.substring("gemini-yolo:".length).trim()
			return await this.handleGeminiCli(prompt, true) // yolo = auto-approve all
		}
		if (content.startsWith("gemini:")) {
			const prompt = content.substring("gemini:".length).trim()
			return await this.handleGeminiCli(prompt, true)
		}
		// Handle Copilot CLI routing
		if (content.startsWith("copilot:")) {
			const prompt = content.substring("copilot:".length).trim()
			return await this.handleCopilotCli(prompt)
		}
		if (content === "help" || content === "messaging-help" || content === "?") {
			return this.getHelpText()
		}
		if (content === "auto-approve-all" || content === "yolo-mode") {
			return await this.handleAutoApproveAll()
		}
		if (content === "get-usage") {
			return await this.handleGetUsage()
		}
		if (content.startsWith("set-model:")) {
			const modelId = content.substring("set-model:".length).trim()
			return await this.handleModelSwitch(modelId)
		}

		// Default: echo back that message was received
		// If there's a message handler, call it
		if (this.onMessageCallback) {
			const fakeMessage: Message = {
				id: this.generateId(),
				from: "copilot",
				to: "cline",
				timestamp: new Date().toISOString(),
				type: "command",
				content: content,
				metadata: {},
			}
			const result = await this.onMessageCallback(fakeMessage)
			return result || `Cline received: ${content}`
		}

		return `Cline received: ${content}`
	}

	/**
	 * Handle pipeline orchestration - chain multiple agents sequentially
	 * Format: "claude->codex->gemini: initial prompt"
	 * Each agent receives the previous agent's output as context
	 */
	private async handlePipeline(content: string): Promise<string> {
		// Parse: "claude->codex->gemini: prompt"
		const colonIndex = content.indexOf(":")
		if (colonIndex === -1) {
			return "Error: Pipeline format is 'pipeline: agent1->agent2: prompt'"
		}

		const agentChain = content.substring(0, colonIndex).trim()
		const initialPrompt = content.substring(colonIndex + 1).trim()
		const agents = agentChain.split("->").map((a) => a.trim().toLowerCase())

		if (agents.length < 2) {
			return "Error: Pipeline needs at least 2 agents (e.g., claude->codex)"
		}

		this.log(`🔗 Starting pipeline: ${agents.join(" → ")}`)
		this.log(`📝 Initial prompt: ${initialPrompt}`)

		let currentOutput = initialPrompt
		const results: string[] = []

		for (let i = 0; i < agents.length; i++) {
			const agent = agents[i]
			const isFirst = i === 0
			const prompt = isFirst
				? currentOutput
				: `Previous agent output:\n${currentOutput}\n\nContinue with this task or improve upon it.`

			this.log(`🤖 Step ${i + 1}/${agents.length}: Running ${agent}...`)

			let result: string
			try {
				switch (agent) {
					case "claude":
						result = await this.handleClaudeCli(prompt, true)
						break
					case "codex":
						result = await this.handleCodexCli(prompt, true)
						break
					case "gemini":
						result = await this.handleGeminiCli(prompt, true)
						break
					case "copilot":
						result = await this.handleCopilotCli(prompt)
						break
					default:
						result = `Error: Unknown agent '${agent}'. Use claude, codex, gemini, or copilot.`
				}
			} catch (error: any) {
				result = `Error in ${agent}: ${error.message}`
			}

			results.push(`=== ${agent.toUpperCase()} ===\n${result}`)
			currentOutput = result
			this.log(`✅ ${agent} completed`)
		}

		const finalOutput = `🔗 PIPELINE COMPLETE (${agents.join(" → ")})\n\n${results.join("\n\n")}`
		this.log(`🏁 Pipeline finished`)
		return finalOutput
	}

	/**
	 * Handle parallel execution - run multiple agents simultaneously
	 * Format: "claude+codex+gemini: prompt"
	 * All agents receive the same prompt and results are aggregated
	 */
	private async handleParallel(content: string): Promise<string> {
		// Parse: "claude+codex+gemini: prompt"
		const colonIndex = content.indexOf(":")
		if (colonIndex === -1) {
			return "Error: Parallel format is 'parallel: agent1+agent2: prompt'"
		}

		const agentList = content.substring(0, colonIndex).trim()
		const prompt = content.substring(colonIndex + 1).trim()
		const agents = agentList.split("+").map((a) => a.trim().toLowerCase())

		if (agents.length < 2) {
			return "Error: Parallel needs at least 2 agents (e.g., claude+codex)"
		}

		this.log(`⚡ Starting parallel execution: ${agents.join(" + ")}`)
		this.log(`📝 Prompt: ${prompt}`)

		// Run all agents in parallel
		const promises = agents.map(async (agent) => {
			try {
				let result: string
				switch (agent) {
					case "claude":
						result = await this.handleClaudeCli(prompt, true)
						break
					case "codex":
						result = await this.handleCodexCli(prompt, true)
						break
					case "gemini":
						result = await this.handleGeminiCli(prompt, true)
						break
					case "copilot":
						result = await this.handleCopilotCli(prompt)
						break
					default:
						result = `Error: Unknown agent '${agent}'`
				}
				return { agent, result, success: true }
			} catch (error: any) {
				return { agent, result: error.message, success: false }
			}
		})

		const results = await Promise.all(promises)

		const output = results.map((r) => `=== ${r.agent.toUpperCase()} ${r.success ? "✅" : "❌"} ===\n${r.result}`).join("\n\n")

		const finalOutput = `⚡ PARALLEL COMPLETE (${agents.join(" + ")})\n\n${output}`
		this.log(`🏁 Parallel execution finished`)
		return finalOutput
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
			let responseContent: string | undefined

			// Handle model switching command: "set-model:provider/model-name"
			if (message.content.startsWith("set-model:")) {
				const modelId = message.content.substring("set-model:".length).trim()
				responseContent = await this.handleModelSwitch(modelId)
			}
			// Handle usage/cost query: "get-usage"
			else if (message.content === "get-usage" || message.content === "get-tokens" || message.content === "get-cost") {
				responseContent = await this.handleGetUsage()
			}
			// Handle help command
			else if (message.content === "help" || message.content === "messaging-help" || message.content === "?") {
				responseContent = this.getHelpText()
			}
			// Handle enable-all-commands: enables auto-approval for ALL terminal commands (including PowerShell)
			else if (message.content === "enable-all-commands" || message.content === "yolo-commands") {
				responseContent = await this.handleEnableAllCommands()
			}
			// Handle auto-approve-all: enables all auto-approval settings
			else if (message.content === "auto-approve-all" || message.content === "yolo-mode") {
				responseContent = await this.handleAutoApproveAll()
			}
			// Handle Claude CLI commands (check -yolo variant first)
			else if (message.content.startsWith("claude-yolo:")) {
				const prompt = message.content.substring("claude-yolo:".length).trim()
				responseContent = await this.handleClaudeCli(prompt, true)
			} else if (message.content.startsWith("claude:")) {
				const prompt = message.content.substring("claude:".length).trim()
				responseContent = await this.handleClaudeCli(prompt, true)
			}
			// Handle Codex CLI commands (check -yolo variant first)
			else if (message.content.startsWith("codex-yolo:")) {
				const prompt = message.content.substring("codex-yolo:".length).trim()
				responseContent = await this.handleCodexCli(prompt, true)
			} else if (message.content.startsWith("codex:")) {
				const prompt = message.content.substring("codex:".length).trim()
				responseContent = await this.handleCodexCli(prompt, true)
			}
			// Handle Gemini CLI commands (check -yolo variant first)
			else if (message.content.startsWith("gemini-yolo:")) {
				const prompt = message.content.substring("gemini-yolo:".length).trim()
				responseContent = await this.handleGeminiCli(prompt, true)
			} else if (message.content.startsWith("gemini:")) {
				const prompt = message.content.substring("gemini:".length).trim()
				responseContent = await this.handleGeminiCli(prompt, true)
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
	 * Handle Claude CLI commands - sends prompts to Claude CLI and returns response
	 * @param prompt The prompt to send to Claude CLI
	 * @param bypassPermissions Whether to run with --permission-mode bypassPermissions
	 * @param allowedTools Array of tools to grant (e.g., ["WebSearch", "Read", "Edit", "Bash"])
	 */
	private async handleClaudeCli(
		prompt: string,
		bypassPermissions: boolean = false,
		allowedTools: string[] = [],
	): Promise<string> {
		if (!prompt) {
			return `Error: No prompt provided. Use format: claude:your prompt here`
		}

		try {
			const { execSync } = require("child_process")
			let flags = ""
			if (bypassPermissions) {
				flags = "--permission-mode bypassPermissions "
			} else if (allowedTools.length > 0) {
				// Grant specific tools using --allowedTools flag
				flags = `--allowedTools ${allowedTools.join(",")} `
			}
			const command = `claude ${flags}-p "${prompt.replace(/"/g, '\\"')}\n"`

			this.log(`🤖 Sending to Claude CLI: ${prompt}`)
			const result = execSync(command, {
				encoding: "utf8",
				timeout: 120000, // 2 minute timeout
				cwd: this.workspaceRoot,
			})

			this.log(`✅ Claude CLI response received`)
			// Write completion signal file for easy polling
			this.writeCompletionSignal("claude", "success", result.trim())
			return `Task completed: Claude CLI finished - ${result.trim().substring(0, 200)}${result.trim().length > 200 ? "..." : ""}`
		} catch (error: any) {
			this.log(`❌ Error calling Claude CLI: ${error.message}`)
			this.writeCompletionSignal("claude", "error", error.message)
			return `Task completed: Claude CLI error - ${error.message}`
		}
	}

	/**
	 * Handle Codex CLI commands - sends prompts to OpenAI Codex CLI and returns response
	 * @param prompt The prompt to send to Codex CLI
	 * @param fullAuto Whether to run with --full-auto flag
	 */
	private async handleCodexCli(prompt: string, fullAuto: boolean = false): Promise<string> {
		if (!prompt) {
			return `Error: No prompt provided. Use format: codex:your prompt here`
		}

		try {
			const { execSync } = require("child_process")
			// Use dangerously-bypass for full agent mode, otherwise read-only sandbox
			// Always skip git repo check since we may be in non-git directories
			const modeFlag = fullAuto ? "--dangerously-bypass-approvals-and-sandbox" : "-s read-only"
			const command = `codex exec ${modeFlag} --skip-git-repo-check "${prompt.replace(/"/g, '\\"')}"`

			this.log(`🤖 Sending to Codex CLI: ${prompt}`)
			const result = execSync(command, {
				encoding: "utf8",
				timeout: 180000, // 3 minute timeout (Codex can be slow)
				cwd: this.workspaceRoot,
			})

			// Extract just the response (after "codex" line)
			const lines = result.split("\n")
			const codexIndex = lines.findIndex((line: string) => line.trim() === "codex")
			const responseLines = codexIndex >= 0 ? lines.slice(codexIndex + 1) : lines
			const cleanResponse = responseLines
				.filter((line: string) => !line.startsWith("tokens used") && line.trim() !== "")
				.join("\n")
				.trim()

			this.log(`✅ Codex CLI response received`)
			// Write completion signal file for easy polling
			this.writeCompletionSignal("codex", "success", cleanResponse)
			return `Task completed: Codex CLI finished - ${cleanResponse.substring(0, 200)}${cleanResponse.length > 200 ? "..." : ""}`
		} catch (error: any) {
			this.log(`❌ Error calling Codex CLI: ${error.message}`)
			this.writeCompletionSignal("codex", "error", error.message)
			return `Task completed: Codex CLI error - ${error.message}`
		}
	}

	/**
	 * Handle Gemini CLI commands - sends prompts to Google Gemini CLI and returns response
	 * @param prompt The prompt to send to Gemini CLI
	 * @param yolo Whether to run with --yolo flag (auto-approve all)
	 */
	private async handleGeminiCli(prompt: string, yolo: boolean = false): Promise<string> {
		if (!prompt) {
			return `Error: No prompt provided. Use format: gemini:your prompt here`
		}

		try {
			const { execSync } = require("child_process")
			// Use Gemini 2.5 Pro model with --yolo for auto-approve mode
			const yoloFlag = yolo ? "-y " : ""
			const command = `gemini -m gemini-2.5-pro ${yoloFlag}"${prompt.replace(/"/g, '\\"')}"`

			this.log(`💎 Sending to Gemini CLI (2.5 Pro): ${prompt}`)
			const result = execSync(command, {
				encoding: "utf8",
				timeout: 180000, // 3 minute timeout
				cwd: this.workspaceRoot,
			})

			// Clean up the response (remove "Loaded cached credentials." line if present)
			const cleanResponse = result
				.split("\n")
				.filter((line: string) => !line.includes("Loaded cached credentials"))
				.join("\n")
				.trim()

			this.log(`✅ Gemini CLI response received`)
			// Write completion signal file for easy polling
			this.writeCompletionSignal("gemini", "success", cleanResponse)
			return `Task completed: Gemini CLI finished - ${cleanResponse.substring(0, 200)}${cleanResponse.length > 200 ? "..." : ""}`
		} catch (error: any) {
			this.log(`❌ Error calling Gemini CLI: ${error.message}`)
			this.writeCompletionSignal("gemini", "error", error.message)
			return `Task completed: Gemini CLI error - ${error.message}`
		}
	}

	/**
	 * Handle GitHub Copilot CLI commands - sends prompts to Copilot CLI and returns response
	 * @param prompt The prompt to send to Copilot CLI
	 */
	private async handleCopilotCli(prompt: string): Promise<string> {
		if (!prompt) {
			return `Error: No prompt provided. Use format: copilot:your prompt here`
		}

		try {
			const { execSync } = require("child_process")
			// Use -p for non-interactive prompt mode
			const command = `copilot -p "${prompt.replace(/"/g, '\\"')}"`

			this.log(`🤖 Sending to Copilot CLI: ${prompt}`)
			const result = execSync(command, {
				encoding: "utf8",
				timeout: 120000, // 2 minute timeout
				cwd: this.workspaceRoot,
			})

			// Clean up response - remove usage stats at the end
			const lines = result.split("\n")
			const cleanLines = lines.filter(
				(line: string) =>
					!line.startsWith("Total usage") &&
					!line.startsWith("Total duration") &&
					!line.startsWith("Total code") &&
					!line.startsWith("Usage by model"),
			)
			const cleanResponse = cleanLines.join("\n").trim()

			this.log(`✅ Copilot CLI response received`)
			this.writeCompletionSignal("copilot", "success", cleanResponse)
			return `Task completed: Copilot CLI finished - ${cleanResponse.substring(0, 200)}${cleanResponse.length > 200 ? "..." : ""}`
		} catch (error: any) {
			this.log(`❌ Error calling Copilot CLI: ${error.message}`)
			this.writeCompletionSignal("copilot", "error", error.message)
			return `Task completed: Copilot CLI error - ${error.message}`
		}
	}

	/**
	 * Write a completion signal file for easy polling by external processes
	 */
	private writeCompletionSignal(source: string, status: "success" | "error", message: string): void {
		try {
			const signalFile = path.join(this.queueDir, "last-completion.json")
			const signal = {
				timestamp: new Date().toISOString(),
				source,
				status,
				message: message.substring(0, 500),
			}
			fs.writeFileSync(signalFile, JSON.stringify(signal, null, 2))
			this.log(`📝 Wrote completion signal: ${source} ${status}`)
		} catch (error) {
			this.log(`⚠️ Failed to write completion signal: ${error}`)
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
		// Also write completion signal for easy polling
		this.writeCompletionSignal("cline", "success", result)
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
	 * Get help text for all messaging commands
	 */
	private getHelpText(): string {
		return `
╔══════════════════════════════════════════════════════════════════════╗
║              BCLINE MESSAGING SYSTEM - HELP                          ║
╚══════════════════════════════════════════════════════════════════════╝

📋 BASIC COMMANDS:
  help                    Show this help message
  get-usage               Get token usage and cost for current task
  auto-approve-all        Enable all auto-approvals (files, commands, browser, MCP)
  yolo-mode               Alias for auto-approve-all
  enable-all-commands     Enable auto-approval for ALL terminal commands
  yolo-commands           Alias for enable-all-commands
  set-model:<model-id>    Switch OpenRouter model (e.g., set-model:anthropic/claude-sonnet-4)

🤖 CLI ROUTING:
  claude:<prompt>         Send to Claude CLI (Opus 4.5)
  claude-yolo:<prompt>    Claude CLI with auto-approve (bypassPermissions)
  codex:<prompt>          Send to Codex CLI (GPT-5.1) in read-only mode
  codex-yolo:<prompt>     Codex CLI with full agent mode (bypasses sandbox)
  gemini:<prompt>         Send to Gemini CLI
  gemini-yolo:<prompt>    Gemini CLI with YOLO mode
  copilot:<prompt>        Send to GitHub Copilot CLI

🔗 ORCHESTRATION:
  pipeline: a->b->c: prompt   Chain agents sequentially (output feeds next)
  parallel: a+b+c: prompt     Run agents in parallel, aggregate results
  (agents: claude, codex, gemini, copilot)

💻 POWERSHELL COMMANDS (from any directory):
  Send-Cline "message"    Send message to Cline
  Send-Claude "prompt"    Send to Claude CLI
  Send-Codex "prompt"     Send to Codex CLI  
  Send-Gemini "prompt"    Send to Gemini CLI
  Send-Copilot "prompt"   Send to GitHub Copilot CLI
  Cline-AutoApprove       Enable auto-approvals
  Cline-SetModel "model"  Switch model
  Cline-Usage             Get token usage
  Cline-Help              Show this help

📁 MESSAGE QUEUE:
  Location: .message-queue/
  ├── inbox/      Messages TO Cline
  ├── responses/  Responses FROM Cline
  └── outbox/     Notifications FROM Cline

📚 DOCUMENTATION:
  See CLI_MESSAGING.md for full documentation
`.trim()
	}

	/**
	 * Cleanup old messages (older than 1 hour)
	 */
	public cleanupOldMessages(): void {
		const oneHourAgo = Date.now() - 60 * 60 * 1000
		const dirs = [this.inboxDir, this.outboxDir, this.responsesDir]

		dirs.forEach((dir) => {
			if (!fs.existsSync(dir)) {
				return
			}

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
				} catch (_error) {
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
