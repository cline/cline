import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from "../index"

export async function improveWithCline(
	controller: Controller,
	request: CommandContext,
	notebookContext?: String,
): Promise<Empty> {
	if (
		(!request.selectedText || !request.selectedText.trim()) &&
		!(request.notebookCellJson && request.filePath?.endsWith(".ipynb"))
	) {
		Logger.log("❌ No text selected and no notebook cell context")
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to improve.",
		})
		return {}
	}
	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	const isNotebook = filePath.endsWith(".ipynb") && request.notebookCellJson
	const hasSelectedText = request.selectedText && request.selectedText.trim()

	// Build prompt
	let prompt = hasSelectedText
		? `Improve the following code from ${fileMention} (e.g., suggest refactorings, optimizations, or better practices):\n\`\`\`${request.language}\n${request.selectedText}\n\`\`\``
		: `Improve the current code in the current notebook cell from ${fileMention}. Suggest refactorings, optimizations, or better practices based on the cell context.`

	if (isNotebook) {
		Logger.log("Adding notebook cell JSON to improveWithCline task for enhanced context")
		prompt += `\n${notebookContext}\n\nCurrent Notebook Cell Context (Raw JSON):\n\`\`\`json\n${request.notebookCellJson}\n\`\`\``
	}

	// Send: notebooks go to existing task if available, non-notebooks always create new task
	if (isNotebook && controller.task) {
		await controller.task.handleWebviewAskResponse("messageResponse", prompt)
	} else {
		await controller.initTask(prompt)
	}

	telemetryService.captureButtonClick("codeAction_improveCode", controller.task?.ulid)

	return {}
}
