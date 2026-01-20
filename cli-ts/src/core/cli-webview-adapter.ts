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
	ClineAskQuestion,
	ClineAskUseMcpServer,
	ClineMessage,
	ClinePlanModeResponse,
	ClineSayBrowserAction,
	ClineSayTool,
	ExtensionState,
} from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { State } from "@shared/proto/cline/state"
import type { ClineMessage as ProtoClineMessage } from "@shared/proto/cline/ui"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import { type MarkedExtension, marked } from "marked"
import { markedTerminal } from "marked-terminal"

// Configure marked with terminal renderer (global setup)
// Note: @types/marked-terminal is outdated and returns wrong type, cast to MarkedExtension
marked.use(markedTerminal() as unknown as MarkedExtension)

import type { Controller } from "@/core/controller"
import type { StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { subscribeToState } from "@/core/controller/state/subscribeToState"
import { subscribeToPartialMessage } from "@/core/controller/ui/subscribeToPartialMessage"
import type { OutputFormatter } from "./output/types.js"
import { type ActivitySpinner, createActivitySpinner } from "./spinner.js"

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
	private printedMessageTs = new Set<number>() // Track which messages we've printed by timestamp
	private subscriptionActive = false
	private onStateChange?: StateChangeHandler
	private _currentOptions: string[] = [] // Track current options for numbered selection
	private activitySpinner: ActivitySpinner // Spinner for idle periods
	private isProcessing = false // Whether AI is currently processing

	constructor(
		private controller: Controller,
		private formatter: OutputFormatter,
	) {
		// Create activity spinner that shows after 2 seconds of inactivity
		this.activitySpinner = createActivitySpinner({
			message: "Working hard...",
			delayMs: 1000,
		})
	}

	/**
	 * Get the current options for numbered selection
	 */
	get currentOptions(): string[] {
		return this._currentOptions
	}

	/**
	 * Set whether the AI is currently processing
	 *
	 * When processing is true, the spinner will start monitoring for inactivity.
	 * When processing is false (e.g., waiting for user input), the spinner is disabled.
	 */
	setProcessing(processing: boolean): void {
		this.isProcessing = processing
		this.activitySpinner.setEnabled(processing)

		if (processing) {
			// Start monitoring for inactivity
			this.activitySpinner.startMonitoring("Processing...")
		} else {
			// Stop spinner when not processing
			this.activitySpinner.stop()
		}
	}

	/**
	 * Render markdown text to terminal-formatted output
	 */
	private renderMarkdown(text: string): string {
		try {
			const rendered = marked.parse(text)
			// marked.parse returns string | Promise<string>, we only use sync mode
			return (typeof rendered === "string" ? rendered : text).trim()
		} catch {
			return text
		}
	}

	/**
	 * Start listening for state updates
	 *
	 * @param onStateChange - Optional callback for raw state changes
	 */
	startListening(onStateChange?: StateChangeHandler): void {
		this.onStateChange = onStateChange
		this.subscriptionActive = true

		// Create a streaming response handler for state updates
		const stateResponseHandler: StreamingResponseHandler<State> = async (state: State) => {
			if (!this.subscriptionActive) {
				return
			}

			if (state.stateJson) {
				try {
					const parsedState = JSON.parse(state.stateJson) as ExtensionState
					const messages = parsedState.clineMessages || []
					this.handleStateUpdate(messages)
				} catch {
					// JSON parse error - ignore malformed state
				}
			}
		}

		// Create a streaming response handler for partial message updates
		// This is needed because the extension uses sendPartialMessageEvent for
		// efficiency instead of postStateToWebview for streaming message updates
		const partialMessageHandler: StreamingResponseHandler<ProtoClineMessage> = async (protoMessage: ProtoClineMessage) => {
			if (!this.subscriptionActive) {
				return
			}

			// Convert proto message to app message and handle it
			const message = convertProtoToClineMessage(protoMessage)
			this.handleSingleMessage(message)
		}

		// Subscribe to both state updates and partial message events
		subscribeToState(this.controller, EmptyRequest.create(), stateResponseHandler)
		subscribeToPartialMessage(this.controller, EmptyRequest.create(), partialMessageHandler)
	}

	/**
	 * Stop listening for state updates
	 */
	stopListening(): void {
		this.subscriptionActive = false
		this.activitySpinner.stop()
	}

	/**
	 * Handle a state update with new messages
	 *
	 * Messages are only printed when they are complete (partial === false).
	 * This maintains proper ordering - e.g., reasoning prints before text.
	 */
	private handleStateUpdate(messages: ClineMessage[]): void {
		// Report activity to reset the spinner timer
		if (this.isProcessing) {
			this.activitySpinner.reportActivity()
		}

		// Notify callback of all messages
		if (this.onStateChange) {
			this.onStateChange(messages)
		}

		// Process messages in order, only printing complete ones we haven't printed yet
		for (const msg of messages) {
			// Skip if already printed
			if (this.printedMessageTs.has(msg.ts)) {
				continue
			}

			// Skip partial messages - wait until they're complete
			if (msg.partial) {
				continue
			}

			// Print the complete message
			this.outputMessage(msg)
			this.printedMessageTs.add(msg.ts)
		}
	}

	/**
	 * Handle a single message update from the partial message stream
	 *
	 * This is called when sendPartialMessageEvent is used instead of postStateToWebview.
	 * It handles both partial updates (which we skip) and completed messages.
	 */
	private handleSingleMessage(msg: ClineMessage): void {
		// Report activity to reset the spinner timer
		if (this.isProcessing) {
			this.activitySpinner.reportActivity()
		}

		// Notify callback with current state (append the new message)
		if (this.onStateChange) {
			const currentMessages = this.getMessages()
			// Check if this message already exists and update it, or append if new
			const existingIndex = currentMessages.findIndex((m) => m.ts === msg.ts)
			if (existingIndex >= 0) {
				currentMessages[existingIndex] = msg
			} else {
				currentMessages.push(msg)
			}
			this.onStateChange(currentMessages)
		}

		// Skip if already printed
		if (this.printedMessageTs.has(msg.ts)) {
			return
		}

		// Skip partial messages - wait until they're complete
		if (msg.partial) {
			return
		}

		// Print the complete message
		this.outputMessage(msg)
		this.printedMessageTs.add(msg.ts)
	}

	/**
	 * Output a ClineMessage to the terminal
	 */
	outputMessage(msg: ClineMessage): void {
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
						this.formatter.info(`🔄 API request started...`)
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
				// TODO end process if yolo mode
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
				this.formatter.warn(`! Shell integration: ${msg.text || ""}`)
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
				this.outputFollowupQuestion(msg)
				break

			case "plan_mode_respond":
				this.outputPlanModeResponse(msg)
				break

			case "command":
				this.formatter.raw(`\n💻 Execute command?`)
				this.formatter.raw(`  $ ${msg.text || ""}`)
				this.formatter.info("  [/approve or /deny]")
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
				this.formatter.info(`\n⏸ Task paused. Resume?`)
				this.formatter.info("  [yes/no]")
				break

			case "completion_result":
				// TODO end process if yolo mode
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
				this.formatter.warn(`\n! Mistake limit reached`)
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
		if (!msg.text) {
			return
		}

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
					this.formatter.raw(`\n🗑 Deleted: ${tool.path || "file"}`)
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
		if (!msg.text) {
			return
		}

		try {
			const action = JSON.parse(msg.text) as ClineSayBrowserAction
			switch (action.action) {
				case "launch":
					this.formatter.raw(`\n🌐 Browser: Launching...`)
					break
				case "click":
					this.formatter.raw(`\n🖱 Browser: Click at ${action.coordinate || "position"}`)
					break
				case "type":
					this.formatter.raw(`\n⌨ Browser: Type "${action.text || ""}"`)
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
		if (!msg.text) {
			return
		}

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
	 * Output a followup question with options
	 */
	private outputFollowupQuestion(msg: ClineMessage): void {
		// Clear previous options
		this._currentOptions = []

		if (!msg.text) {
			this.formatter.raw(`\n❓ Question`)
			return
		}

		try {
			const question = JSON.parse(msg.text) as ClineAskQuestion
			this.formatter.raw(`\n❓ ${question.question}`)

			// Display options as numbered list if present
			if (question.options && question.options.length > 0) {
				this._currentOptions = question.options
				this.formatter.raw("")
				for (let i = 0; i < question.options.length; i++) {
					this.formatter.raw(`  ${i + 1}. ${question.options[i]}`)
				}
				this.formatter.raw("")
				this.formatter.info("  Enter a number to select, or type your response:")
			}
		} catch {
			// Not JSON, output as plain text
			this.formatter.raw(`\n❓ ${msg.text}`)
		}
	}

	/**
	 * Output a plan mode response with markdown rendering
	 */
	private outputPlanModeResponse(msg: ClineMessage): void {
		// Clear previous options
		this._currentOptions = []

		if (!msg.text) {
			this.formatter.info(`\n📝 Plan Mode Response Required`)
			return
		}

		try {
			const planResponse = JSON.parse(msg.text) as ClinePlanModeResponse

			this.formatter.raw("")
			// Render the markdown response
			const rendered = this.renderMarkdown(planResponse.response)
			this.formatter.raw(rendered)

			// Display options as numbered list if present
			if (planResponse.options && planResponse.options.length > 0) {
				this._currentOptions = planResponse.options
				this.formatter.raw("")
				for (let i = 0; i < planResponse.options.length; i++) {
					this.formatter.raw(`  ${i + 1}. ${planResponse.options[i]}`)
				}
				this.formatter.raw("")
				this.formatter.info("  Enter a number to select, or type your response:")
			} else {
				this.formatter.raw("")
				this.formatter.info("  Toggle to Act mode to execute, or provide feedback:")
			}
		} catch {
			// Not JSON, output as plain text
			this.formatter.info(`\n📝 Plan Mode Response Required`)
			this.formatter.raw(msg.text)
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
		this.printedMessageTs.clear()
	}

	/**
	 * Output all current messages (useful for initial display)
	 */
	outputAllMessages(): void {
		const messages = this.getMessages()
		for (const msg of messages) {
			if (!msg.partial && !this.printedMessageTs.has(msg.ts)) {
				this.outputMessage(msg)
				this.printedMessageTs.add(msg.ts)
			}
		}
	}
}
