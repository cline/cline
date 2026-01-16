/**
 * CLI Webview Adapter
 *
 * This module bridges the Controller's state updates with terminal output.
 * It listens to Controller state changes and formats ClineMessages for
 * display in the terminal.
 */

import type {
	BrowserActionResult,
	ClineApiReqInfo,
	ClineAskUseMcpServer,
	ClineMessage,
	ClineSayBrowserAction,
	ClineSayTool,
} from "@shared/ExtensionMessage"
import type { Controller } from "@/core/controller"
import type { OutputFormatter } from "./output/types.js"

/**
 * State change handler callback type
 */
export type StateChangeHandler = (messages: ClineMessage[]) => void

/**
 * CLI Webview Adapter class
 *
 * Subscribes to Controller state updates and outputs messages to the terminal.
 */
export class CliWebviewAdapter {
	private lastMessageCount = 0
	private lastMessageTs = 0
	private isStreaming = false
	private partialContent = ""
	private pollInterval: NodeJS.Timeout | null = null
	private onStateChange?: StateChangeHandler

	constructor(
		private controller: Controller,
		private formatter: OutputFormatter,
	) {}

	/**
	 * Start listening for state updates
	 *
	 * @param onStateChange - Optional callback for raw state changes
	 * @param pollIntervalMs - Polling interval in milliseconds (default: 100ms)
	 */
	startListening(onStateChange?: StateChangeHandler, pollIntervalMs = 100): void {
		this.onStateChange = onStateChange

		// Poll for state changes
		// NOTE: In the future, we could use a more efficient event-based approach
		// by subscribing to Controller events directly
		this.pollInterval = setInterval(() => {
			this.checkForUpdates()
		}, pollIntervalMs)
	}

	/**
	 * Stop listening for state updates
	 */
	stopListening(): void {
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
			this.pollInterval = null
		}
	}

	/**
	 * Check for new messages and output them
	 */
	private checkForUpdates(): void {
		const messages = this.controller.task?.messageStateHandler.getClineMessages() || []

		// Notify callback of all messages
		if (this.onStateChange) {
			this.onStateChange(messages)
		}

		// Process new messages
		if (messages.length > this.lastMessageCount) {
			const newMessages = messages.slice(this.lastMessageCount)
			for (const msg of newMessages) {
				this.outputMessage(msg)
			}
			this.lastMessageCount = messages.length
		} else if (messages.length > 0) {
			// Check for partial message updates on the last message
			const lastMessage = messages[messages.length - 1]
			if (lastMessage.partial && lastMessage.ts > this.lastMessageTs) {
				this.handlePartialMessage(lastMessage)
			}
		}

		if (messages.length > 0) {
			this.lastMessageTs = messages[messages.length - 1].ts
		}
	}

	/**
	 * Handle partial (streaming) message updates
	 */
	private handlePartialMessage(msg: ClineMessage): void {
		const content = msg.text || ""

		// Only output the new content
		if (content.length > this.partialContent.length) {
			const newContent = content.slice(this.partialContent.length)
			// For streaming, we write without newlines
			process.stdout.write(newContent)
			this.partialContent = content
			this.isStreaming = true
		}
	}

	/**
	 * Output a ClineMessage to the terminal
	 */
	outputMessage(msg: ClineMessage): void {
		// If we were streaming, finish the line
		if (this.isStreaming && !msg.partial) {
			process.stdout.write("\n")
			this.isStreaming = false
			this.partialContent = ""
		}

		// Skip partial messages - they're handled separately
		if (msg.partial) {
			this.handlePartialMessage(msg)
			return
		}

		if (msg.type === "say") {
			this.outputSayMessage(msg)
		} else if (msg.type === "ask") {
			this.outputAskMessage(msg)
		}
	}

	/**
	 * Output a "say" type message
	 */
	private outputSayMessage(msg: ClineMessage): void {
		const say = msg.say

		switch (say) {
			case "task":
				this.formatter.info(`\n📋 Task: ${msg.text || ""}`)
				break

			case "text":
			case "reasoning":
				if (msg.text) {
					// Check if this is reasoning content
					if (say === "reasoning" || msg.reasoning) {
						this.formatter.raw(`💭 ${msg.reasoning || msg.text}`)
					} else {
						this.formatter.raw(msg.text)
					}
				}
				break

			case "error":
				this.formatter.error(`❌ ${msg.text || "An error occurred"}`)
				break

			case "error_retry":
				this.formatter.warn(`🔄 Retrying: ${msg.text || ""}`)
				break

			case "api_req_started":
				// Parse API request info
				if (msg.text) {
					try {
						const _info = JSON.parse(msg.text) as ClineApiReqInfo
						this.formatter.info("🔄 API request started...")
					} catch {
						this.formatter.info("🔄 API request started...")
					}
				}
				break

			case "api_req_finished":
				if (msg.text) {
					try {
						const info = JSON.parse(msg.text) as ClineApiReqInfo
						const tokens = `${info.tokensIn || 0} in / ${info.tokensOut || 0} out`
						const cost = info.cost ? ` ($${info.cost.toFixed(4)})` : ""
						this.formatter.success(`✅ API request complete: ${tokens}${cost}`)
					} catch {
						this.formatter.success("✅ API request complete")
					}
				}
				break

			case "completion_result":
				this.formatter.success(`\n✨ ${msg.text || "Task completed"}`)
				break

			case "user_feedback":
				this.formatter.info(`📝 User: ${msg.text || ""}`)
				break

			case "command":
				this.formatter.raw(`\n$ ${msg.text || ""}`)
				break

			case "command_output":
				if (msg.text) {
					// Indent command output
					const lines = msg.text.split("\n")
					for (const line of lines) {
						this.formatter.raw(`  ${line}`)
					}
				}
				break

			case "tool":
				this.outputToolMessage(msg)
				break

			case "browser_action":
				this.outputBrowserAction(msg)
				break

			case "browser_action_result":
				this.outputBrowserActionResult(msg)
				break

			case "mcp_server_request_started":
				this.formatter.info(`🔌 MCP request: ${msg.text || ""}`)
				break

			case "mcp_server_response":
				this.formatter.raw(`  Response: ${msg.text || ""}`)
				break

			case "checkpoint_created":
				this.formatter.info(`💾 Checkpoint created: ${msg.lastCheckpointHash?.slice(0, 8) || ""}`)
				break

			case "shell_integration_warning":
				this.formatter.warn(`⚠️ Shell integration: ${msg.text || ""}`)
				break

			case "diff_error":
				this.formatter.error(`❌ Diff error: ${msg.text || ""}`)
				break

			default:
				// Handle any other say types
				if (msg.text) {
					this.formatter.raw(msg.text)
				}
		}
	}

	/**
	 * Output a "ask" type message
	 */
	private outputAskMessage(msg: ClineMessage): void {
		const ask = msg.ask

		switch (ask) {
			case "followup":
				this.formatter.raw(`\n❓ ${msg.text || "Question"}`)
				break

			case "plan_mode_respond":
				this.formatter.info(`\n📝 Plan Mode Response Required`)
				if (msg.text) {
					this.formatter.raw(msg.text)
				}
				break

			case "command":
				this.formatter.raw(`\n💻 Execute command?`)
				this.formatter.raw(`  $ ${msg.text || ""}`)
				this.formatter.info("  [approve/deny]")
				break

			case "tool":
				this.outputToolApproval(msg)
				break

			case "api_req_failed":
				this.formatter.error(`\n❌ API request failed`)
				if (msg.text) {
					this.formatter.raw(`  ${msg.text}`)
				}
				this.formatter.info("  [retry/cancel]")
				break

			case "resume_task":
				this.formatter.info(`\n⏸️ Task paused. Resume?`)
				this.formatter.info("  [yes/no]")
				break

			case "completion_result":
				this.formatter.success(`\n✅ Task Complete!`)
				if (msg.text) {
					this.formatter.raw(msg.text)
				}
				this.formatter.info("  [start new task/provide feedback]")
				break

			case "browser_action_launch":
				this.formatter.raw(`\n🌐 Launch browser?`)
				if (msg.text) {
					this.formatter.raw(`  URL: ${msg.text}`)
				}
				this.formatter.info("  [approve/deny]")
				break

			case "use_mcp_server":
				this.outputMcpServerApproval(msg)
				break

			case "mistake_limit_reached":
				this.formatter.warn(`\n⚠️ Mistake limit reached`)
				if (msg.text) {
					this.formatter.raw(msg.text)
				}
				this.formatter.info("  [continue/stop]")
				break

			default:
				if (msg.text) {
					this.formatter.raw(`\n❓ ${msg.text}`)
				}
		}
	}

	/**
	 * Output tool-related messages
	 */
	private outputToolMessage(msg: ClineMessage): void {
		if (!msg.text) return

		try {
			const tool = JSON.parse(msg.text) as ClineSayTool
			switch (tool.tool) {
				case "editedExistingFile":
					this.formatter.raw(`\n📝 Edited: ${tool.path || "file"}`)
					if (tool.diff) {
						this.outputDiff(tool.diff)
					}
					break

				case "newFileCreated":
					this.formatter.raw(`\n📄 Created: ${tool.path || "file"}`)
					break

				case "fileDeleted":
					this.formatter.raw(`\n🗑️ Deleted: ${tool.path || "file"}`)
					break

				case "readFile":
					this.formatter.raw(`\n📖 Read: ${tool.path || "file"}`)
					break

				case "listFilesTopLevel":
				case "listFilesRecursive":
					this.formatter.raw(`\n📂 Listed: ${tool.path || "directory"}`)
					break

				case "searchFiles":
					this.formatter.raw(`\n🔍 Searched: ${tool.regex || "pattern"} in ${tool.path || "directory"}`)
					break

				case "webFetch":
				case "webSearch":
					this.formatter.raw(`\n🌐 Web: ${tool.content || ""}`)
					break

				default:
					this.formatter.raw(`\n🔧 Tool: ${tool.tool}`)
			}
		} catch {
			// Not JSON, just output raw
			this.formatter.raw(`\n🔧 ${msg.text}`)
		}
	}

	/**
	 * Output tool approval request
	 */
	private outputToolApproval(msg: ClineMessage): void {
		if (!msg.text) {
			this.formatter.raw(`\n🔧 Tool approval required`)
			return
		}

		try {
			const tool = JSON.parse(msg.text) as ClineSayTool
			this.formatter.raw(`\n🔧 Approve ${tool.tool}?`)
			if (tool.path) {
				this.formatter.raw(`  Path: ${tool.path}`)
			}
			if (tool.diff) {
				this.outputDiff(tool.diff)
			}
			this.formatter.info("  [approve/deny]")
		} catch {
			this.formatter.raw(`\n🔧 Tool approval: ${msg.text}`)
			this.formatter.info("  [approve/deny]")
		}
	}

	/**
	 * Output diff content
	 */
	private outputDiff(diff: string): void {
		const lines = diff.split("\n")
		for (const line of lines) {
			if (line.startsWith("+")) {
				this.formatter.raw(`  \x1b[32m${line}\x1b[0m`) // Green for additions
			} else if (line.startsWith("-")) {
				this.formatter.raw(`  \x1b[31m${line}\x1b[0m`) // Red for deletions
			} else {
				this.formatter.raw(`  ${line}`)
			}
		}
	}

	/**
	 * Output browser action message
	 */
	private outputBrowserAction(msg: ClineMessage): void {
		if (!msg.text) return

		try {
			const action = JSON.parse(msg.text) as ClineSayBrowserAction
			switch (action.action) {
				case "launch":
					this.formatter.raw(`\n🌐 Browser: Launching...`)
					break
				case "click":
					this.formatter.raw(`\n🖱️ Browser: Click at ${action.coordinate || "position"}`)
					break
				case "type":
					this.formatter.raw(`\n⌨️ Browser: Type "${action.text || ""}"`)
					break
				case "scroll_down":
					this.formatter.raw(`\n📜 Browser: Scroll down`)
					break
				case "scroll_up":
					this.formatter.raw(`\n📜 Browser: Scroll up`)
					break
				case "close":
					this.formatter.raw(`\n🌐 Browser: Closing...`)
					break
			}
		} catch {
			this.formatter.raw(`\n🌐 Browser: ${msg.text}`)
		}
	}

	/**
	 * Output browser action result
	 */
	private outputBrowserActionResult(msg: ClineMessage): void {
		if (!msg.text) return

		try {
			const result = JSON.parse(msg.text) as BrowserActionResult
			if (result.currentUrl) {
				this.formatter.raw(`  URL: ${result.currentUrl}`)
			}
			if (result.logs) {
				this.formatter.raw(`  Console: ${result.logs}`)
			}
			// Note: Screenshots are not displayed in terminal
			if (result.screenshot) {
				this.formatter.raw(`  📷 Screenshot captured`)
			}
		} catch {
			this.formatter.raw(`  ${msg.text}`)
		}
	}

	/**
	 * Output MCP server approval request
	 */
	private outputMcpServerApproval(msg: ClineMessage): void {
		if (!msg.text) {
			this.formatter.raw(`\n🔌 MCP server approval required`)
			return
		}

		try {
			const mcp = JSON.parse(msg.text) as ClineAskUseMcpServer
			this.formatter.raw(`\n🔌 MCP: ${mcp.serverName}`)
			if (mcp.type === "use_mcp_tool" && mcp.toolName) {
				this.formatter.raw(`  Tool: ${mcp.toolName}`)
				if (mcp.arguments) {
					this.formatter.raw(`  Args: ${mcp.arguments}`)
				}
			} else if (mcp.type === "access_mcp_resource" && mcp.uri) {
				this.formatter.raw(`  Resource: ${mcp.uri}`)
			}
			this.formatter.info("  [approve/deny]")
		} catch {
			this.formatter.raw(`\n🔌 MCP approval: ${msg.text}`)
			this.formatter.info("  [approve/deny]")
		}
	}

	/**
	 * Get the current messages from the Controller
	 */
	getMessages(): ClineMessage[] {
		return this.controller.task?.messageStateHandler.getClineMessages() || []
	}

	/**
	 * Reset the message counter (useful when starting a new task)
	 */
	resetMessageCounter(): void {
		this.lastMessageCount = 0
		this.lastMessageTs = 0
		this.partialContent = ""
		this.isStreaming = false
	}

	/**
	 * Output all current messages (useful for initial display)
	 */
	outputAllMessages(): void {
		const messages = this.getMessages()
		for (const msg of messages) {
			this.outputMessage(msg)
		}
		this.lastMessageCount = messages.length
		if (messages.length > 0) {
			this.lastMessageTs = messages[messages.length - 1].ts
		}
	}
}

/**
 * Create a new CLI Webview Adapter
 *
 * @param controller - The Controller instance
 * @param formatter - Output formatter for terminal display
 * @returns A new CliWebviewAdapter instance
 */
export function createCliWebviewAdapter(controller: Controller, formatter: OutputFormatter): CliWebviewAdapter {
	return new CliWebviewAdapter(controller, formatter)
}
