import * as path from "path"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { ClineAsk, ClineSay, ClineSayTool } from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"
import { ToolUse, ToolUseName } from "../../assistant-message"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../utils"
import { ToolExecutorCoordinator } from "./ToolExecutorCoordinator"

/**
 * Handles the execution of tools registered with the coordinator.
 * This class encapsulates all the approval flow, UI updates, and telemetry
 * for coordinator-managed tools, keeping the main ToolExecutor clean.
 */
export class CoordinatorToolExecutor {
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
	) {}

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
		const relPath = block.params.path
		const tool = this.getToolDisplayName(block)

		const sharedMessageProps = {
			tool,
			path: getReadablePath(this.config.cwd, this.removeClosingTag(block, "path", relPath)),
			content: block.name === "list_files" ? "" : undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

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
		const relPath = block.params.path
		const content = block.params.content || block.params.diff

		const fileExists = this.config.services.diffViewProvider.editType === "modify"
		const sharedMessageProps = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(this.config.cwd, this.removeClosingTag(block, "path", relPath)),
			content: this.removeClosingTag(block, block.name === "replace_in_file" ? "diff" : "content", content),
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		if (await this.shouldAutoApproveToolWithPath(block.name, relPath)) {
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
		const server_name = block.params.server_name
		const tool_name = block.params.tool_name
		const uri = block.params.uri
		const mcp_arguments = block.params.arguments

		const partialMessage = JSON.stringify({
			type: block.name === "use_mcp_tool" ? "use_mcp_tool" : "access_mcp_resource",
			serverName: this.removeClosingTag(block, "server_name", server_name),
			toolName: this.removeClosingTag(block, "tool_name", tool_name),
			uri: this.removeClosingTag(block, "uri", uri),
			arguments: this.removeClosingTag(block, "arguments", mcp_arguments),
		})

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
			case "ask_followup_question":
			case "web_fetch":
			case "browser_action":
				// These tools have simpler approval flows - just execute and push result
				const result = await this.coordinator.execute(this.config, block)
				this.pushToolResult(result, block)
				break
			default:
				// For any other tools that might be added, just execute and push result
				const defaultResult = await this.coordinator.execute(this.config, block)
				this.pushToolResult(defaultResult, block)
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

		// Validate path parameter
		if (!relPath) {
			this.config.taskState.consecutiveMistakeCount++
			this.pushToolResult(await this.sayAndCreateMissingParamError(block.name, "path"), block)
			await this.saveCheckpoint()
			return
		}

		const absolutePath = path.resolve(this.config.cwd, relPath)
		const tool = this.getToolDisplayName(block)

		// Execute the tool to get the result (handlers validate params and check clineignore)
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (this.isValidationError(result)) {
			this.pushToolResult(result, block)
			await this.saveCheckpoint()
			return
		}

		// Handle approval flow
		const approved = await this.handleApprovalFlow(block, relPath, absolutePath, tool, result)
		if (!approved) {
			await this.saveCheckpoint()
			return
		}

		// Tool was approved, push the result
		this.pushToolResult(result, block)
	}

	/**
	 * Get the display name for a tool based on its parameters
	 */
	private getToolDisplayName(block: ToolUse): string {
		if (block.name === "list_files") {
			return block.params.recursive?.toLowerCase() === "true" ? "listFilesRecursive" : "listFilesTopLevel"
		}
		return "readFile"
	}

	/**
	 * Check if a result is a validation error
	 */
	private isValidationError(result: any): boolean {
		return (
			typeof result === "string" &&
			(result.includes("Missing required parameter") || result.includes("blocked by .clineignore"))
		)
	}

	/**
	 * Handle execution of write-related tools (write_to_file, replace_in_file, new_rule)
	 */
	private async handleWriteToolExecution(block: ToolUse): Promise<void> {
		const relPath = block.params.path
		const content = block.params.content || block.params.diff

		// Validate path parameter
		if (!relPath) {
			this.config.taskState.consecutiveMistakeCount++
			this.pushToolResult(await this.sayAndCreateMissingParamError(block.name, "path"), block)
			return
		}

		// Check if file exists for UI messaging
		const absolutePath = path.resolve(this.config.cwd, relPath)
		const fileExists =
			this.config.services.diffViewProvider.editType === "modify" || (await this.config.services.diffViewProvider.isEditing)
				? this.config.services.diffViewProvider.editType === "modify"
				: await require("@utils/fs").fileExistsAtPath(absolutePath)

		// Create shared message props for UI
		const sharedMessageProps = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(this.config.cwd, relPath),
			content: content,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		// Handle approval flow for write tools
		if (await this.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await this.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await this.say("tool" as ClineSay, completeMessage, undefined, undefined, false)
			this.config.taskState.consecutiveAutoApprovedRequestsCount++
			telemetryService.captureToolUsage(this.config.ulid, block.name, this.config.api.getModel().id, true, true)
		} else {
			const notificationMessage = `Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`

			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				this.config.autoApprovalSettings.enabled,
				this.config.autoApprovalSettings.enableNotifications,
			)

			await this.removeLastPartialMessageIfExistsWithType("say", "tool")
			const didApprove = await this.askApproval("tool" as ClineAsk, block, completeMessage)

			if (!didApprove) {
				telemetryService.captureToolUsage(this.config.ulid, block.name, this.config.api.getModel().id, false, false)
				// Reset diff view if user rejected
				await this.config.services.diffViewProvider.revertChanges()
				await this.config.services.diffViewProvider.reset()
				return
			}

			telemetryService.captureToolUsage(this.config.ulid, block.name, this.config.api.getModel().id, false, true)
		}

		// User approved or auto-approved, now execute the tool
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (this.isValidationError(result)) {
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
		if (this.isValidationError(result)) {
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
		const server_name = block.params.server_name
		const tool_name = block.params.tool_name
		const uri = block.params.uri
		const mcp_arguments = block.params.arguments

		// Create complete message for approval
		const completeMessage = JSON.stringify({
			type: block.name === "use_mcp_tool" ? "use_mcp_tool" : "access_mcp_resource",
			serverName: server_name,
			toolName: tool_name,
			uri: uri,
			arguments: mcp_arguments,
		})

		// Handle approval flow for MCP tools
		let shouldAutoApprove = false
		if (block.name === "use_mcp_tool") {
			// Check if this specific tool is auto-approved on the server
			const isToolAutoApproved = this.config.services.mcpHub.connections
				?.find((conn: any) => conn.server.name === server_name)
				?.server.tools?.find((tool: any) => tool.name === tool_name)?.autoApprove

			shouldAutoApprove = this.config.autoApprovalSettings.enabled && isToolAutoApproved
		} else {
			// access_mcp_resource uses general auto-approval
			shouldAutoApprove = this.config.autoApprovalSettings.enabled
		}

		if (shouldAutoApprove) {
			await this.removeLastPartialMessageIfExistsWithType("ask", "use_mcp_server")
			await this.say("use_mcp_server" as ClineSay, completeMessage, undefined, undefined, false)
			this.config.taskState.consecutiveAutoApprovedRequestsCount++
		} else {
			const notificationMessage =
				block.name === "use_mcp_tool"
					? `Cline wants to use ${tool_name} on ${server_name}`
					: `Cline wants to access ${uri} on ${server_name}`

			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				this.config.autoApprovalSettings.enabled,
				this.config.autoApprovalSettings.enableNotifications,
			)

			await this.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
			const didApprove = await this.askApproval("use_mcp_server" as ClineAsk, block, completeMessage)

			if (!didApprove) {
				return
			}
		}

		// Show MCP request started message
		await this.say("mcp_server_request_started" as ClineSay)

		// Execute the MCP tool through the handler
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (this.isValidationError(result)) {
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
		// Show loading message
		await this.say("load_mcp_documentation" as ClineSay, "", undefined, undefined, false)

		// Execute the tool through the handler
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (this.isValidationError(result)) {
			this.pushToolResult(result, block)
			return
		}

		// Push the successful result
		this.pushToolResult(result, block)
	}

	/**
	 * Handle execution of task management tools (plan_mode_respond, attempt_completion, new_task)
	 */
	private async handleTaskManagementExecution(block: ToolUse): Promise<void> {
		// Execute the tool through the handler
		const result = await this.coordinator.execute(this.config, block)

		// Check if handler returned an error
		if (this.isValidationError(result)) {
			this.pushToolResult(result, block)
			return
		}

		// For task management tools, the handler manages the entire flow
		// The result is already the final formatted response
		this.pushToolResult(result, block)
	}

	/**
	 * Handle the approval flow for a tool execution
	 */
	private async handleApprovalFlow(
		block: ToolUse,
		relPath: string,
		absolutePath: string,
		tool: string,
		result: any,
	): Promise<boolean> {
		const sharedMessageProps = {
			tool,
			path: getReadablePath(this.config.cwd, relPath),
			content: block.name === "list_files" ? result : absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await this.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
			await this.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await this.say("tool" as ClineSay, completeMessage, undefined, undefined, false)
			this.config.taskState.consecutiveAutoApprovedRequestsCount++
			telemetryService.captureToolUsage(this.config.ulid, block.name, this.config.api.getModel().id, true, true)
			return true
		} else {
			const notificationMessage =
				block.name === "list_files"
					? `Cline wants to view directory ${path.basename(absolutePath)}/`
					: `Cline wants to read ${path.basename(absolutePath)}`

			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				this.config.autoApprovalSettings.enabled,
				this.config.autoApprovalSettings.enableNotifications,
			)

			await this.removeLastPartialMessageIfExistsWithType("say", "tool")
			const didApprove = await this.askApproval("tool" as ClineAsk, block, completeMessage)

			if (!didApprove) {
				telemetryService.captureToolUsage(this.config.ulid, block.name, this.config.api.getModel().id, false, false)
				return false
			}

			telemetryService.captureToolUsage(this.config.ulid, block.name, this.config.api.getModel().id, false, true)
			return true
		}
	}
}
