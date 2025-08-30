import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import * as path from "path"
import { telemetryService } from "@/services/telemetry"
import type { ToolResponse } from "../../index"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { IFullyManagedTool } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { ToolResultUtils } from "../utils/ToolResultUtils"

export class ReadFileToolHandler implements IFullyManagedTool {
	readonly name = "read_file"

	constructor(private validator: ToolValidator) {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.path}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const relPath = block.params.path

		const config = uiHelpers.getConfig()

		// Create and show partial UI message
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, uiHelpers.removeClosingTag(block, "path", relPath)),
			content: undefined,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		}

		const partialMessage = JSON.stringify(sharedMessageProps)

		// Handle auto-approval vs manual approval for partial
		if (await uiHelpers.shouldAutoApproveToolWithPath(block.name, relPath)) {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
		} else {
			await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "tool")
			await uiHelpers.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const relPath: string | undefined = block.params.path

		// Validate required parameters
		const pathValidation = this.validator.assertRequiredParams(block, "path")
		if (!pathValidation.ok) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError("read_file", "path")
		}

		// Check clineignore access
		const accessValidation = this.validator.checkClineIgnorePath(relPath!)
		if (!accessValidation.ok) {
			await config.callbacks.say("clineignore_error", relPath)
			return formatResponse.toolError(formatResponse.clineIgnoreError(relPath!))
		}

		config.taskState.consecutiveMistakeCount = 0
		const absolutePath = path.resolve(config.cwd, relPath!)

		// Handle approval flow
		const sharedMessageProps = {
			tool: "readFile",
			path: getReadablePath(config.cwd, relPath!),
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath!),
		}

		const completeMessage = JSON.stringify(sharedMessageProps)

		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, relPath)) {
			// Auto-approval flow
			await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++

			// Capture telemetry
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			// Manual approval flow
			const notificationMessage = `Cline wants to read ${path.basename(absolutePath)}`

			// Show notification
			showNotificationForApprovalIfAutoApprovalEnabled(
				notificationMessage,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)

			await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await ToolResultUtils.askApprovalAndPushFeedback("tool", completeMessage, config)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				return formatResponse.toolDenied()
			} else {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
			}
		}

		// Execute the actual file read operation
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		const result = await extractFileContent(absolutePath, supportsImages)

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

		// Handle image blocks separately - they need to be pushed to userMessageContent
		if (result.imageBlock) {
			config.taskState.userMessageContent.push(result.imageBlock)
		}

		return result.text
	}
}
