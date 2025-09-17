import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineAsk } from "@shared/ExtensionMessage"
import { stopDebugging } from "@/hosts/vscode/hostbridge/debug/debugService"
import { Empty } from "@/shared/proto/index.cline"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class StopDebuggingToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.STOP_DEBUGGING

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			return
		} else {
			await uiHelpers.ask("command" as ClineAsk, "Stop debugging session", block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		config.taskState.consecutiveMistakeCount = 0

		// Check auto-approval
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(this.name)
		const shouldAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

		if (!shouldAutoApprove) {
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"command",
				"Cline wants to stop the debug session",
				config,
			)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		showNotificationForApprovalIfAutoApprovalEnabled(
			`Cline is stopping debug session`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)

		try {
			// Stop the debug session
			const result = await stopDebugging(Empty.create({}))

			if (result.error) {
				return formatResponse.toolError(`Failed to stop debug session: ${result.error.message}`)
			} else {
				return "Debug session stopped successfully"
			}
		} catch (error) {
			return formatResponse.toolError(`Stop debugging failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
}
