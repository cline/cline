import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { resolveWorkspacePath } from "@core/workspace"
import { ClineAsk } from "@shared/ExtensionMessage"
import { setBreakpoint } from "@/hosts/vscode/hostbridge/debug/debugService"
import { SetBreakpointRequest } from "@/shared/proto/index.host"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class SetBreakpointToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.SET_BREAKPOINT

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} at '${block.params.file_path}:${block.params.line_number}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const filePath = block.params.file_path
		const lineNumber = block.params.line_number
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			return
		} else {
			await uiHelpers
				.ask(
					"command" as ClineAsk,
					uiHelpers.removeClosingTag(block, "file_path", `${filePath}:${lineNumber}`),
					block.partial,
				)
				.catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const filePath: string | undefined = block.params.file_path
		const lineNumberStr: string | undefined = block.params.line_number
		const condition: string | undefined = block.params.condition
		const logMessage: string | undefined = block.params.log_message

		// Validate required parameters
		if (!filePath) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "file_path")
		}

		if (!lineNumberStr) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "line_number")
		}

		const lineNumber = parseInt(lineNumberStr, 10)
		if (isNaN(lineNumber) || lineNumber < 1) {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError("line_number must be a positive integer")
		}

		config.taskState.consecutiveMistakeCount = 0

		const absoluteFilePath = resolveWorkspacePath(config.cwd, filePath)

		// Check auto-approval
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(this.name)
		const shouldAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

		if (!shouldAutoApprove) {
			const breakpointDesc = `${filePath}:${lineNumber}${condition ? ` (condition: ${condition})` : ""}${logMessage ? ` (log: ${logMessage})` : ""}`
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"command",
				`Cline wants to set a breakpoint at:\n\n${breakpointDesc}`,
				config,
			)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		showNotificationForApprovalIfAutoApprovalEnabled(
			`Cline is setting breakpoint at ${filePath}:${lineNumber}`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)

		try {
			// Build breakpoint request
			const request = SetBreakpointRequest.create({
				filePath: absoluteFilePath,
				lineNumber: lineNumber,
				condition: condition || "",
				logMessage: logMessage || "",
			})

			// Set the breakpoint
			const result = await setBreakpoint(request)

			if (result.error) {
				return formatResponse.toolError(`Failed to set breakpoint: ${result.error.message}`)
			} else {
				return `Breakpoint set successfully at ${absoluteFilePath}:${lineNumber}${condition ? ` with condition: ${condition}` : ""}${logMessage ? ` with log message: ${logMessage}` : ""}\n\nBreakpoint ID: ${result.breakpoint?.id || "N/A"}`
			}
		} catch (error) {
			return formatResponse.toolError(`Set breakpoint failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
}
