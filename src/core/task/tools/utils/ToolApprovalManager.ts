import * as path from "path"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { ClineAsk, ClineSay } from "@shared/ExtensionMessage"
import { ClineAskResponse } from "@shared/WebviewMessage"
import { ToolUse, ToolUseName } from "../../../assistant-message"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"

/**
 * Manages the approval flow for tool executions, including auto-approval logic,
 * notification generation, telemetry capture, and UI message routing.
 */
export class ToolApprovalManager {
	constructor(
		private config: any,
		private shouldAutoApproveToolWithPath: (toolName: ToolUseName, path?: string) => Promise<boolean>,
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
	) {}

	/**
	 * Handle approval flow for file-related tools (read_file, list_files, etc.)
	 */
	async handleFileToolApproval(
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
			await this.handleAutoApproval("tool", completeMessage, block)
			return true
		} else {
			const notificationMessage = this.createFileToolNotificationMessage(block, absolutePath)
			return await this.handleManualApproval("tool", completeMessage, block, notificationMessage)
		}
	}

	/**
	 * Handle approval flow for write-related tools (write_to_file, replace_in_file, new_rule)
	 */
	async handleWriteToolApproval(block: ToolUse, relPath: string, fileExists: boolean, content: string): Promise<boolean> {
		const sharedMessageProps = {
			tool: fileExists ? "editedExistingFile" : "newFileCreated",
			path: getReadablePath(this.config.cwd, relPath),
			content: content,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await this.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await this.handleAutoApproval("tool", completeMessage, block)
			return true
		} else {
			const notificationMessage = `Cline wants to ${fileExists ? "edit" : "create"} ${path.basename(relPath)}`
			return await this.handleManualApproval("tool", completeMessage, block, notificationMessage)
		}
	}

	/**
	 * Handle approval flow for MCP tools (use_mcp_tool, access_mcp_resource)
	 */
	async handleMcpToolApproval(block: ToolUse): Promise<boolean> {
		const server_name = block.params.server_name
		const tool_name = block.params.tool_name
		const uri = block.params.uri
		const mcp_arguments = block.params.arguments

		const completeMessage = JSON.stringify({
			type: block.name === "use_mcp_tool" ? "use_mcp_tool" : "access_mcp_resource",
			serverName: server_name,
			toolName: tool_name,
			uri: uri,
			arguments: mcp_arguments,
		})

		const shouldAutoApprove = this.shouldAutoApproveMcpTool(block, server_name, tool_name)

		if (shouldAutoApprove) {
			await this.handleAutoApproval("use_mcp_server", completeMessage, block)
			return true
		} else {
			const notificationMessage = this.createMcpToolNotificationMessage(block, tool_name, server_name, uri)
			return await this.handleManualApproval("use_mcp_server", completeMessage, block, notificationMessage)
		}
	}

	/**
	 * Handle auto-approval flow
	 */
	private async handleAutoApproval(messageType: string, message: string, block: ToolUse): Promise<void> {
		await this.removeLastPartialMessageIfExistsWithType("ask", messageType)
		await this.say(messageType as ClineSay, message, undefined, undefined, false)
		this.config.taskState.consecutiveAutoApprovedRequestsCount++
		this.captureTelemetry(block, true, true)
	}

	/**
	 * Handle manual approval flow
	 */
	private async handleManualApproval(
		messageType: string,
		message: string,
		block: ToolUse,
		notificationMessage: string,
	): Promise<boolean> {
		showNotificationForApprovalIfAutoApprovalEnabled(
			notificationMessage,
			this.config.autoApprovalSettings.enabled,
			this.config.autoApprovalSettings.enableNotifications,
		)

		await this.removeLastPartialMessageIfExistsWithType("say", messageType)
		const didApprove = await this.askApproval(messageType as ClineAsk, block, message)

		if (!didApprove) {
			this.captureTelemetry(block, false, false)
			return false
		}

		this.captureTelemetry(block, false, true)
		return true
	}

	/**
	 * Determine if MCP tool should be auto-approved
	 */
	private shouldAutoApproveMcpTool(block: ToolUse, server_name: string, tool_name: string): boolean {
		if (block.name === "use_mcp_tool") {
			// Check if this specific tool is auto-approved on the server
			const isToolAutoApproved = this.config.services.mcpHub.connections
				?.find((conn: any) => conn.server.name === server_name)
				?.server.tools?.find((tool: any) => tool.name === tool_name)?.autoApprove

			return this.config.autoApprovalSettings.enabled && isToolAutoApproved
		} else {
			// access_mcp_resource uses general auto-approval
			return this.config.autoApprovalSettings.enabled
		}
	}

	/**
	 * Create notification message for file tools
	 */
	private createFileToolNotificationMessage(block: ToolUse, absolutePath: string): string {
		return block.name === "list_files"
			? `Cline wants to view directory ${path.basename(absolutePath)}/`
			: `Cline wants to read ${path.basename(absolutePath)}`
	}

	/**
	 * Create notification message for MCP tools
	 */
	private createMcpToolNotificationMessage(
		block: ToolUse,
		tool_name: string | undefined,
		server_name: string | undefined,
		uri: string | undefined,
	): string {
		return block.name === "use_mcp_tool"
			? `Cline wants to use ${tool_name || "unknown tool"} on ${server_name || "unknown server"}`
			: `Cline wants to access ${uri || "unknown resource"} on ${server_name || "unknown server"}`
	}

	/**
	 * Capture telemetry for tool usage
	 */
	private captureTelemetry(block: ToolUse, isAutoApproved: boolean, wasApproved: boolean): void {
		telemetryService.captureToolUsage(
			this.config.ulid,
			block.name,
			this.config.api.getModel().id,
			isAutoApproved,
			wasApproved,
		)
	}
}
