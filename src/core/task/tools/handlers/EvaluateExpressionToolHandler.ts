import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineAsk } from "@shared/ExtensionMessage"
import { evaluateExpression } from "@/hosts/vscode/hostbridge/debug/debugService"
import { EvaluateExpressionRequest } from "@/shared/proto/index.host"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class EvaluateExpressionToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.EVALUATE_EXPRESSION

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.expression}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const expression = block.params.expression
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			return
		} else {
			await uiHelpers
				.ask("command" as ClineAsk, uiHelpers.removeClosingTag(block, "expression", expression), block.partial)
				.catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const expression: string | undefined = block.params.expression
		const frameId: string | undefined = block.params.frame_id
		const context: string | undefined = block.params.context

		// Validate required parameters
		if (!expression) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "expression")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Check auto-approval
		const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(this.name)
		const shouldAutoApprove = autoApproveResult === true || (Array.isArray(autoApproveResult) && autoApproveResult[0])

		if (!shouldAutoApprove) {
			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"command",
				`Cline wants to evaluate expression in debug console:\n\n${expression}${frameId ? `\nIn frame: ${frameId}` : ""}${context ? `\nContext: ${context}` : ""}`,
				config,
			)
			if (!didApprove) {
				return formatResponse.toolDenied()
			}
		}

		showNotificationForApprovalIfAutoApprovalEnabled(
			`Cline is evaluating expression: ${expression}`,
			config.autoApprovalSettings.enabled,
			config.autoApprovalSettings.enableNotifications,
		)

		try {
			// Build evaluation request
			const request = EvaluateExpressionRequest.create({
				expression: expression,
				frameId: frameId || "0",
				context: context || "watch",
			})

			// Evaluate the expression
			const result = await evaluateExpression(request)

			if (result.error) {
				return formatResponse.toolError(`Failed to evaluate expression: ${result.error.message}`)
			} else if (result.evaluationResult) {
				return `Expression evaluated: ${expression}${frameId ? ` (in frame: ${frameId})` : ""}${context ? ` (context: ${context})` : ""}\nResult: ${result.evaluationResult.value}\nType: ${result.evaluationResult.type || "unknown"}\nSuccess: ${result.evaluationResult.success}`
			} else {
				return `Expression evaluated: ${expression}${frameId ? ` (in frame: ${frameId})` : ""}${context ? ` (context: ${context})` : ""}\nResult: [no result returned]`
			}
		} catch (error) {
			return formatResponse.toolError(
				`Evaluate expression failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
}
