import * as path from "path"
import { listFiles } from "@services/glob/list-files"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { showSystemNotification } from "@integrations/notifications"
import { formatResponse } from "@core/prompts/responses"
import { getReadablePath, isLocatedInWorkspace } from "@utils/path"
import { showNotificationForApprovalIfAutoApprovalEnabled } from "../../utils"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import type { ToolValidator } from "../ToolValidator"
import type { ClineSayTool } from "@shared/ExtensionMessage"

export class ListFilesToolHandler implements IToolHandler {
	readonly name = "list_files"

	constructor(private validator: ToolValidator) {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		const relDirPath: string | undefined = block.params.path
		const recursiveRaw: string | undefined = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		const sharedMessageProps: ClineSayTool = {
			tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
			path: getReadablePath(config.cwd, this.removeClosingTag(block, "path", relDirPath)),
		}

		// Handle partial streaming
		if (block.partial) {
			const partialMessage = JSON.stringify({
				...sharedMessageProps,
				content: "",
				operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
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
			return await config.callbacks.sayAndCreateMissingParamError("list_files", "path")
		}

		config.taskState.consecutiveMistakeCount = 0
		const absolutePath = path.resolve(config.cwd, relDirPath!)

		// Execute the actual list files operation
		const [files, didHitLimit] = await listFiles(absolutePath, recursive, 200)

		const result = formatResponse.formatFilesList(absolutePath, files, didHitLimit, config.services.clineIgnoreController)

		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			content: result,
			operationIsLocatedInWorkspace: await isLocatedInWorkspace(block.params.path),
		} satisfies ClineSayTool)

		// Handle auto-approval
		if (await config.callbacks.shouldAutoApproveToolWithPath(block.name, block.params.path)) {
			config.callbacks.removeLastPartialMessageIfExistsWithType("ask", "tool")
			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)
			config.taskState.consecutiveAutoApprovedRequestsCount++
			telemetryService.captureToolUsage(config.ulid, block.name, config.api.getModel().id, true, true)
		} else {
			showNotificationForApprovalIfAutoApprovalEnabled(
				`Cline wants to view directory ${path.basename(absolutePath)}/`,
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

		// Update focus chain if enabled
		if (!block.partial && config.focusChainSettings.enabled) {
			await config.callbacks.updateFCListFromToolResponse(block.params.task_progress)
		}

		return result
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
