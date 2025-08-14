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
		// Currently only read_file and list_files support partial streaming
		if (block.name !== "read_file" && block.name !== "list_files") {
			return
		}

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
	 * Handle complete block execution with approval flow
	 */
	private async handleCompleteBlock(block: ToolUse): Promise<void> {
		// Currently only read_file and list_files are migrated
		if (block.name === "read_file" || block.name === "list_files") {
			await this.handleFileToolExecution(block)
		} else {
			// For future tools that might be added, just execute and push result
			const result = await this.coordinator.execute(this.config, block)
			this.pushToolResult(result, block)
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
