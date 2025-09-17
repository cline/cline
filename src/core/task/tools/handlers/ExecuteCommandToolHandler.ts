import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { WorkspacePathAdapter } from "@core/workspace/WorkspacePathAdapter"
import { showSystemNotification } from "@integrations/notifications"
import { COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { ClineAsk } from "@shared/ExtensionMessage"
import { fixModelHtmlEscaping } from "@utils/string"
import { telemetryService } from "@/services/telemetry"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ExecuteCommandToolHandler implements IFullyManagedTool {
	readonly name = ClineDefaultTool.BASH

	constructor(_validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.command}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const command = block.params.command

		// Check if this should be auto-approved to determine UI flow
		const shouldAutoApprove = uiHelpers.shouldAutoApproveTool(this.name)

		if (shouldAutoApprove) {
			// For auto-approved commands, we can't partially stream a say prematurely
			// since it may become an ask based on the requires_approval parameter
			// So we wait for the complete block
			return
		} else {
			await uiHelpers
				.ask("command" as ClineAsk, uiHelpers.removeClosingTag(block, "command", command), block.partial)
				.catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		let command: string | undefined = block.params.command
		const requiresApprovalRaw: string | undefined = block.params.requires_approval
		const requiresApprovalPerLLM = requiresApprovalRaw?.toLowerCase() === "true"
		const timeoutParam: string | undefined = block.params.timeout
		let timeoutSeconds: number | undefined

		// Validate required parameters
		if (!command) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "command")
		}

		if (!requiresApprovalRaw) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "requires_approval")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Handling of timeout while in yolo mode
		if (config.yoloModeToggled) {
			if (!timeoutParam) {
				timeoutSeconds = 30
			} else {
				const parsedTimeoutParam = parseInt(timeoutParam, 10)
				timeoutSeconds = isNaN(parsedTimeoutParam) || parsedTimeoutParam <= 0 ? 30 : parsedTimeoutParam
			}
		}

		// Pre-process command for certain models
		if (config.api.getModel().id.includes("gemini")) {
			command = fixModelHtmlEscaping(command)
		}

		// Handle multi-workspace command execution
		let executionDir: string = config.cwd
		let actualCommand: string = command

		if (config.isMultiRootEnabled && config.workspaceManager) {
			// Check if command has a workspace hint prefix
			// e.g., "@backend:npm install" or just "npm install"
			const commandMatch = command.match(/^@(\w+):(.+)$/)

			if (commandMatch) {
				const workspaceHint = commandMatch[1]
				actualCommand = commandMatch[2].trim()

				// Find the workspace root for this hint
				const adapter = new WorkspacePathAdapter({
					cwd: config.cwd,
					isMultiRootEnabled: true,
					workspaceManager: config.workspaceManager,
				})

				// Resolve to get the workspace directory
				executionDir = adapter.resolvePath(".", workspaceHint)

				// Update command to remove the workspace prefix for display
				command = actualCommand
			}
			// If no hint, use primary workspace (cwd)
		}

		// Check clineignore validation for command
		const ignoredFileAttemptedToAccess = config.services.clineIgnoreController.validateCommand(actualCommand)
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
			await config.callbacks.say("command", actualCommand, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++
			didAutoApprove = true
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			showNotificationForApprovalIfAutoApprovalEnabled(
				`Cline wants to execute a command: ${actualCommand}`,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback(
				"command",
				actualCommand + `${autoApproveSafe && requiresApprovalPerLLM ? COMMAND_REQ_APP_STRING : ""}`,
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

		// Execute the command in the correct directory
		// If executionDir is different from cwd, prepend cd command
		let finalCommand: string = actualCommand
		if (executionDir !== config.cwd) {
			// Use && to chain commands so they run in sequence
			finalCommand = `cd "${executionDir}" && ${actualCommand}`
		}

		const [userRejected, result] = await config.callbacks.executeCommandTool(finalCommand, timeoutSeconds)

		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}
}
