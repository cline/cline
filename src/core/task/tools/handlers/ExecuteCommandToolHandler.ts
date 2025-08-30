import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { showSystemNotification } from "@integrations/notifications"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineAsk } from "@shared/ExtensionMessage"
import { fixModelHtmlEscaping } from "@utils/string"
import { telemetryService } from "@/services/telemetry"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ExecuteCommandToolHandler implements IFullyManagedTool {
	readonly name = "execute_command"

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.command}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const command = block.params.command

		// For commands, we need to wait for the requires_approval parameter before showing UI
		// This is because the approval flow depends on that parameter
		if (!block.params.requires_approval) {
			return // Wait for complete block
		}

		// Command partial streaming is handled differently - just show the command
		const partialCommand = uiHelpers.removeClosingTag(block, "command", command)

		// Check if this should be auto-approved to determine UI flow
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool("execute_command")

		if (shouldAutoApprove) {
			// For auto-approved commands, we can't partially stream a say prematurely
			// since it may become an ask based on the requires_approval parameter
			// So we wait for the complete block
			return
		} else {
			// For manual approval, stream the ask message
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "command")
			await uiHelpers.ask("command" as ClineAsk, partialCommand, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		try {
			let command: string | undefined = block.params.command
			const requiresApprovalRaw: string | undefined = block.params.requires_approval
			const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"

			// Validate required parameters
			if (!command) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError("execute_command", "command")
			}

			if (!requiresApprovalRaw) {
				config.taskState.consecutiveMistakeCount++
				return await config.callbacks.sayAndCreateMissingParamError("execute_command", "requires_approval")
			}

			config.taskState.consecutiveMistakeCount = 0

			// Pre-process command for certain models
			if (config.api.getModel().id.includes("gemini")) {
				command = fixModelHtmlEscaping(command)
			}

			// Check clineignore validation for command
			const ignoredFileAttemptedToAccess = config.services.clineIgnoreController.validateCommand(command)
			if (ignoredFileAttemptedToAccess) {
				await config.callbacks.say("clineignore_error", ignoredFileAttemptedToAccess)
				return formatResponse.toolError(formatResponse.clineIgnoreError(ignoredFileAttemptedToAccess))
			}

			let didAutoApprove = false

			// If the model says this command is safe and auto approval for safe commands is true, execute the command
			// If the model says the command is risky, but *BOTH* auto approve settings are true, execute the command
			const autoApproveResult = config.autoApprover?.shouldAutoApproveTool(block.name)
			const [autoApproveSafe, autoApproveAll] = Array.isArray(autoApproveResult)
				? autoApproveResult
				: [autoApproveResult, false]

			if ((!requiresApprovalPerLLM && autoApproveSafe) || (requiresApprovalPerLLM && autoApproveSafe && autoApproveAll)) {
				// Auto-approve flow
				await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "command")
				await config.callbacks.say("command", command, undefined, undefined, false)
				config.taskState.consecutiveAutoApprovedRequestsCount++
				didAutoApprove = true
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
			} else {
				// Manual approval flow
				showNotificationForApprovalIfAutoApprovalEnabled(
					`Cline wants to execute a command: ${command}`,
					config.autoApprovalSettings.enabled,
					config.autoApprovalSettings.enableNotifications,
				)

				const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
					"command",
					command + `${autoApproveSafe && requiresApprovalPerLLM ? COMMAND_REQ_APP_STRING : ""}`,
					config,
				)
				if (!didApprove) {
					telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
					return formatResponse.toolDenied()
				}
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}

			// Setup timeout notification for long-running auto-approved commands
			let timeoutId: NodeJS.Timeout | undefined
			if (didAutoApprove && config.autoApprovalSettings.enableNotifications) {
				// if the command was auto-approved, and it's long running we need to notify the user after some time has passed without proceeding
				timeoutId = setTimeout(() => {
					showSystemNotification({
						subtitle: "Command is still running",
						message: "An auto-approved command has been running for 30s, and may need your attention.",
					})
				}, 30_000)
			}

			// Execute the command
			const [userRejected, result] = await config.callbacks.executeCommandTool(command)

			if (timeoutId) {
				clearTimeout(timeoutId)
			}

			if (userRejected) {
				config.taskState.didRejectTool = true
			}

			return result
		} catch (error) {
			return `Error executing command: ${(error as Error).message}`
		}
	}
}
