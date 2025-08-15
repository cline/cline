import { fixModelHtmlEscaping } from "@utils/string"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"

export class ExecuteCommandToolHandler implements IToolHandler {
	readonly name = "execute_command"

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

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
			return `Error: Command blocked by .clineignore rules. The command attempted to access: ${ignoredFileAttemptedToAccess}`
		}

		// Execute the command using the callback
		const [userRejected, result] = await config.callbacks.executeCommandTool(command)

		if (userRejected) {
			config.taskState.didRejectTool = true
		}

		return result
	}

	/**
	 * Check if this command should be auto-approved based on the dual approval system
	 * Returns [autoApproveSafe, autoApproveAll] tuple
	 */
	shouldAutoApprove(config: any, requiresApprovalPerLLM: boolean): [boolean, boolean] {
		// This logic is handled by the AutoApprove class in the main ToolExecutor
		// The handler just executes the command - approval logic is handled by the coordinator
		return [false, false]
	}
}
