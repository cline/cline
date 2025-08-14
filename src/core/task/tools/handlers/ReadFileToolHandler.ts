import * as path from "path"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { showSystemNotification } from "@integrations/notifications"
import { formatResponse } from "@core/prompts/responses"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { extractFileContent } from "@integrations/misc/extract-file-content"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { ClineSayTool } from "@shared/ExtensionMessage"

export class ReadFileToolHandler implements IToolHandler {
	readonly name = "read_file"

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		const relPath: string | undefined = block.params.path

		const sharedMessageProps: ClineSayTool = {
			tool: "readFile",
			path: getReadablePath(config.cwd, this.removeClosingTag(block, "path", relPath)),
		}

		// Handle partial streaming
		if (block.partial) {
			const partialMessage = JSON.stringify({
				...sharedMessageProps,
				content: undefined,
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
			} satisfies ClineSayTool)

			if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
				config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
				await config.callbacks.say("tool", partialMessage, undefined, undefined, block.partial)
			} else {
				config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")
				await config.callbacks.ask("tool", partialMessage, block.partial).catch(() => {})
			}
			// For partial blocks, we don't return a result yet
			return ""
		}

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

		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			content: absolutePath,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(relPath),
		} satisfies ClineSayTool)

		// Handle auto-approval
		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
			config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			showNotificationForApprovalIfAutoApprovalEnabled(
				`Cline wants to read ${path.basename(absolutePath)}`,
				config.autoApprovalSettings.enabled,
				config.autoApprovalSettings.enableNotifications,
			)
			config.callbacks.removeLastPartialMessageIfExistsWithType("say", "tool")

			const didApprove = await config.callbacks.askApproval("tool", block, completeMessage)
			if (!didApprove) {
				telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, false)
				// Return empty string to signal rejection
				return ""
			}
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, false, true)
		}

		// Execute the actual file read operation
		const supportsImages = config.api.getModel().info.supportsImages ?? false
		const result = await extractFileContent(absolutePath, supportsImages)

		// Track file read operation
		await config.services.fileContextTracker.trackFileContext(relPath!, "read_tool")

		// Update focus chain if enabled
		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		// Return the result with image block if present
		if (result.imageBlock) {
			// Need to push the image block to userMessageContent directly
			config.taskState.userMessageContent.push(result.imageBlock)
		}

		return result.text
	}

	private removeClosingTag(block: ToolUse, tag: string, text?: string): string {
		if (!block.partial) {
			return text || ""
		}
		if (!text) {
			return ""
		}
		// This regex dynamically constructs a pattern to match the closing tag
		const tagRegex = new RegExp(
			`\\s?<\/?${tag
				.split("")
				.map((char) => `(?:${char})?`)
				.join("")}$`,
			"g",
		)
		return text.replace(tagRegex, "")
	}
}
