import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"

export async function improveWithCline(
	controller: Controller,
	request: CommandContext,
	notebookContext?: string,
): Promise<Empty> {
	if (!request.selectedText?.trim() && !notebookContext) {
		Logger.log("❌ No text selected and no notebook context")
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to improve.",
		})
		return {}
	}
	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	const hasSelectedText = request.selectedText?.trim()

	// Build prompt
	let prompt = hasSelectedText
		? `Improve the following code from ${fileMention} (e.g., suggest refactorings, optimizations, or better practices):\n\`\`\`${request.language}\n${request.selectedText}\n\`\`\``
		: `Improve the current code in the current notebook cell from ${fileMention}. Suggest refactorings, optimizations, or better practices based on the cell context.`

	if (notebookContext) {
		Logger.log("Adding notebook context to improveWithCline task")
		prompt += `\n${notebookContext}`
	}

	// Send: notebooks go to existing task if available, non-notebooks always create new task
	if (notebookContext && controller.task) {
		await controller.task.handleWebviewAskResponse("messageResponse", prompt)
	} else {
		await controller.initTask(prompt)
	}

	telemetryService.captureButtonClick("codeAction_improveCode", controller.task?.ulid)

	return {}
}
