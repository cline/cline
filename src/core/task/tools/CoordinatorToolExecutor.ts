import * as path from "path"
import { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"
import { ToolUse, ToolUseName } from "../../assistant-message"
import { ToolExecutorCoordinator } from "./ToolExecutorCoordinator"
import { ToolDisplayUtils } from "./utils/ToolDisplayUtils"
import { ToolValidationUtils } from "./utils/ToolValidationUtils"
import { ToolMessageUtils } from "./utils/ToolMessageUtils"
import { ToolApprovalManager } from "./utils/ToolApprovalManager"
import { ToolErrorHandler } from "./utils/ToolErrorHandler"
import { ToolExecutionStrategies } from "./utils/ToolExecutionStrategies"

/**
 * Handles the execution of tools registered with the coordinator.
 * This class encapsulates all the approval flow, UI updates, and telemetry
 * for coordinator-managed tools, keeping the main ToolExecutor clean.
 */
export class CoordinatorToolExecutor {
	private approvalManager: ToolApprovalManager

	constructor(
		private coordinator: ToolExecutorCoordinator,
		private config: any,
		private pushToolResult: (content: any, block: ToolUse) => void,
		private removeClosingTag: (block: ToolUse, tag: any, text?: string) => string,
		private shouldAutoApproveToolWithPath: (toolName: ToolUseName, path?: string) => Promise<boolean>,
		private sayAndCreateMissingParamError: (toolName: ToolUseName, paramName: string) => Promise<any>,
		private removeLastPartialMessageIfExistsWithType: (type: "ask" | "say", askOrSay: any) => Promise<void>,
		private say: (
			type: ClineSay,
			text?: string,
			images?: string[],
			files?: string[],
			partial?: boolean,
		) => Promise<number | undefined>,
		private ask: (
			type: ClineAsk,
			text?: string,
			partial?: boolean,
		) => Promise<{
			response: ClineAskResponse
			text?: string
			images?: string[]
			files?: string[]
		}>,
		private askApproval: (type: ClineAsk, block: ToolUse, message: string) => Promise<boolean>,
		private saveCheckpoint: () => Promise<void>,
		private updateFCListFromToolResponse: (taskProgress?: string) => Promise<void>,
		private handleError: (action: string, error: Error, block: ToolUse) => Promise<void>,
	) {
		// Initialize the approval manager
		this.approvalManager = new ToolApprovalManager(
			config,
			shouldAutoApproveToolWithPath,
			removeLastPartialMessageIfExistsWithType,
			say,
			ask,
			askApproval,
		)
	}

	/**
	 * Execute a tool through the coordinator if it's registered
	 */
	async execute(block: ToolUse): Promise<boolean> {
		if (!this.coordinator.has(block.name)) {
			return false // Tool not handled by coordinator
		}

		try {
			// Handle partial blocks
			if (block.partial) {
				await this.handlePartialBlock(block)
				return true
			}

			// Handle complete blocks
			await this.handleCompleteBlock(block)
			return true
		} catch (error) {
			await this.handleError(`executing ${block.name}`, error as Error, block)
			await this.saveCheckpoint()
			return true
		}
	}

	/**
	 * Handle partial block streaming UI updates
	 */
	private async handlePartialBlock(block: ToolUse): Promise<void> {
		// Handle different tools that support partial streaming
		switch (block.name) {
			case "read_file":
			case "list_files":
			case "list_code_definition_names":
			case "search_files":
				await this.handleFileToolPartialBlock(block)
				break
			case "write_to_file":
			case "replace_in_file":
			case "new_rule":
				await this.handleWriteToolPartialBlock(block)
				break
			case "execute_command":
				await this.handleCommandPartialBlock(block)
				break
			case "use_mcp_tool":
			case "access_mcp_resource":
				await this.handleMcpToolPartialBlock(block)
				break
			case "load_mcp_documentation":
				// load_mcp_documentation doesn't support partial streaming
				return
			default:
				// Other tools don't support partial streaming yet
				return
		}
	}

	/**
	 * Handle partial blocks for file-related tools
	 */
	private async handleFileToolPartialBlock(block: ToolUse): Promise<void> {
		const sharedMessageProps = await ToolMessageUtils.createFileToolMessageProps(
			block,
			this.config.cwd,
			this.removeClosingTag,
		)

		const partialMessage = JSON.stringify(sharedMessageProps)

		if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
			await this.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await this.say("tool" as ClineSay, partialMessage, undefined, undefined, block.partial)
		} else {
			await this.removeLastPartialMessageIfExistsWithType("say", "tool")
			await this.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
		}
	}

	/**
	 * Handle partial blocks for write-related tools
	 */
	private async handleWriteToolPartialBlock(block: ToolUse): Promise<void> {
		const fileExists = this.config.services.diffViewProvider.editType === "modify"
		const sharedMessageProps = await ToolMessageUtils.createWriteToolMessageProps(
			block,
			this.config.cwd,
			fileExists,
			this.removeClosingTag,
		)

		const partialMessage = JSON.stringify(sharedMessageProps)

		if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
			await this.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await this.say("tool" as ClineSay, partialMessage, undefined, undefined, block.partial)
		} else {
			await this.removeLastPartialMessageIfExistsWithType("say", "tool")
			await this.ask("tool" as ClineAsk, partialMessage, block.partial).catch(() => {})
		}
	}

	/**
	 * Handle partial blocks for command execution
	 */
	private async handleCommandPartialBlock(block: ToolUse): Promise<void> {
		const command = block.params.command

		// For commands, we need to wait for the requires_approval parameter before showing UI
		// This is because the approval flow depends on that parameter
		if (!block.params.requires_approval) {
			return // Wait for complete block
		}

		// Command partial streaming is handled differently - just show the command
		const partialCommand = this.removeClosingTag(block, "command", command)

		// Don't auto-approve partial commands - wait for complete block
		await this.removeLastPartialMessageIfExistsWithType("say", "command")
		await this.ask("command" as ClineAsk, partialCommand, block.partial).catch(() => {})
	}

	/**
	 * Handle partial blocks for MCP tools
	 */
	private async handleMcpToolPartialBlock(block: ToolUse): Promise<void> {
		const partialMessage = JSON.stringify(ToolMessageUtils.createMcpToolMessageProps(block, this.removeClosingTag))

		// MCP tools use a different message type
		if (this.config.autoApprovalSettings.enabled) {
			await this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await this.say("use_mcp_server" as ClineSay, partialMessage, undefined, undefined, block.partial)
		} else {
			await this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
			await this.ask("use_mcp_server" as ClineAsk, partialMessage, block.partial).catch(() => {})
		}
	}

	/**
	 * Handle complete block execution with approval flow
	 */
	private async handleCompleteBlock(block: ToolUse): Promise<void> {
		// Handle different tool types with their specific approval flows
		switch (block.name) {
			case "read_file":
			case "list_files":
			case "list_code_definition_names":
			case "search_files":
				await this.handleFileToolExecution(block)
				break
			case "write_to_file":
			case "replace_in_file":
			case "new_rule":
				await this.handleWriteToolExecution(block)
				break
			case "execute_command":
				await this.handleCommandExecution(block)
				break
			case "use_mcp_tool":
			case "access_mcp_resource":
				await this.handleMcpToolExecution(block)
				break
			case "load_mcp_documentation":
				await this.handleLoadMcpDocumentationExecution(block)
				break
			case "plan_mode_respond":
			case "attempt_completion":
			case "new_task":
				await this.handleTaskManagementExecution(block)
				break
			case "condense":
			case "summarize_task":
			case "report_bug":
				await this.handleContextAndUtilityExecution(block)
				break
			case "ask_followup_question":
			case "web_fetch":
			case "browser_action":
				// These tools have simpler approval flows - just execute and push result
				await ToolExecutionStrategies.executeSimpleTool(block, this.coordinator, this.config, this.pushToolResult)
				break
			default:
				// For any other tools that might be added, just execute and push result
				await ToolExecutionStrategies.executeSimpleTool(block, this.coordinator, this.config, this.pushToolResult)
				break
		}

		// Handle focus chain updates
		if (!block.partial && this.config.focusChainSettings.enabled) {
			await this.updateFCListFromToolResponse(block.params.task_progress)
		}

		await this.saveCheckpoint()
	}

	/**
	 * Handle execution of file-related tools (read_file, list_files)
	 */
	private async handleFileToolExecution(block: ToolUse): Promise<void> {
		const relPath = block.params.path

		// Execute the tool to get the result (handlers validate params and check clineignore)
		const result = await this.coordinator.execute(this.config, block)

		// Handle validation errors using the error handler
		if (
			await ToolErrorHandler.handleValidationError(
				block,
				result,
				this.config,
				this.pushToolResult,
				this.saveCheckpoint,
				this.sayAndCreateMissingParamError,
			)
		) {
			return // Error was handled
		}

		const absolutePath = path.resolve(this.config.cwd, relPath || "")
		const tool = ToolDisplayUtils.getToolDisplayName(block)

		// Handle approval flow using the approval manager
		const approved = await this.approvalManager.handleFileToolApproval(block, relPath || "", absolutePath, tool, result)
		if (!approved) {
			await this.saveCheckpoint()
			return
		}

		// Tool was approved, push the result
		this.pushToolResult(result, block)
	}

	/**
	 * Handle execution of write-related tools (write_to_file, replace_in_file, new_rule)
	 */
	private async handleWriteToolExecution(block: ToolUse): Promise<void> {
		const relPath = block.params.path
		const content = block.params.content || block.params.diff

		// Validate path parameter using error handler
		if (
			await ToolErrorHandler.handleValidationError(
				block,
				null, // No result yet, just checking params
				this.config,
				this.pushToolResult,
				this.saveCheckpoint,
				this.sayAndCreateMissingParamError,
			)
		) {
			return // Error was handled
		}

		// Check if file exists for UI messaging
		const absolutePath = path.resolve(this.config.cwd, relPath || "")
		const fileExists =
			this.config.services.diffViewProvider.editType === "modify" || (await this.config.services.diffViewProvider.isEditing)
				? this.config.services.diffViewProvider.editType === "modify"
				: await require("@utils/fs").fileExistsAtPath(absolutePath)

		// Handle approval flow using the approval manager
		const approved = await this.approvalManager.handleWriteToolApproval(block, relPath || "", fileExists, content || "")
		if (!approved) {
			// Reset diff view if user rejected
			await ToolErrorHandler.handleDiffViewReset(this.config)
			return
		}

		// User approved or auto-approved, now execute the tool
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (ToolValidationUtils.isValidationError(result)) {
			this.pushToolResult(result, block)
			return
		}

		// Push the successful result
		this.pushToolResult(result, block)
	}

	/**
	 * Handle execution of command tool
	 */
	private async handleCommandExecution(block: ToolUse): Promise<void> {
		// Execute the command through the handler
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (ToolValidationUtils.isValidationError(result)) {
			this.pushToolResult(result, block)
			return
		}

		// For commands, the handler manages the approval flow and execution
		// The result is already the final formatted response
		this.pushToolResult(result, block)
	}

	/**
	 * Handle execution of MCP tools (use_mcp_tool, access_mcp_resource)
	 */
	private async handleMcpToolExecution(block: ToolUse): Promise<void> {
		// Handle approval flow using the approval manager
		const approved = await this.approvalManager.handleMcpToolApproval(block)
		if (!approved) {
			return
		}

		// Show MCP request started message
		await this.say("mcp_server_request_started" as ClineSay)

		// Execute the MCP tool through the handler
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (ToolValidationUtils.isValidationError(result)) {
			this.pushToolResult(result, block)
			return
		}

		// Push the successful result
		this.pushToolResult(result, block)
	}

	/**
	 * Handle execution of load_mcp_documentation tool
	 */
	private async handleLoadMcpDocumentationExecution(block: ToolUse): Promise<void> {
		await ToolExecutionStrategies.executeToolWithLoadingMessage(
			block,
			this.coordinator,
			this.config,
			this.pushToolResult,
			this.say,
			"load_mcp_documentation" as ClineSay,
		)
	}

	/**
	 * Handle execution of task management tools (plan_mode_respond, attempt_completion, new_task)
	 */
	private async handleTaskManagementExecution(block: ToolUse): Promise<void> {
		await ToolExecutionStrategies.executeToolWithValidation(block, this.coordinator, this.config, this.pushToolResult)
	}

	/**
	 * Handle execution of context and utility tools (condense, summarize_task, report_bug)
	 */
	private async handleContextAndUtilityExecution(block: ToolUse): Promise<void> {
		await ToolExecutionStrategies.executeToolWithValidation(block, this.coordinator, this.config, this.pushToolResult)
	}
}
