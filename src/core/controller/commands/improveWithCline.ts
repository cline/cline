import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from "../index"
import { sendAddToInputEvent } from "../ui/subscribeToAddToInput"

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

	if (request.selectedText && request.selectedText.trim()) {
		let prompt1 = `Improve the following code from ${fileMention} (e.g., suggest refactorings, optimizations, or better practices):
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``

		// Add notebook cell JSON for .ipynb files to provide complete context when selected text is present
		if (request.notebookCellJson && filePath.endsWith(".ipynb")) {
			Logger.log("Adding notebook cell JSON to improveWithCline task for enhanced context")
			prompt1 += `\n${notebookContext}\n`
			prompt1 += `\n\nCurrent Notebook Cell Context (Raw JSON):\n\`\`\`json\n${request.notebookCellJson}\n\`\`\``
			await sendAddToInputEvent(prompt1)
		}
		await controller.initTask(prompt1)
	} else if (request.notebookCellJson && filePath.endsWith(".ipynb")) {
		let prompt2 = `Improve the current code in the current notebook cell from ${fileMention}. Suggest refactorings, optimizations, or better practices based on the cell context.`
		Logger.log("Adding notebook cell JSON to improveWithCline task for enhanced context")
		prompt2 += `\n${notebookContext}\n`
		prompt2 += `\n\nCurrent Notebook Cell Context (Raw JSON):\n\`\`\`json\n${request.notebookCellJson}\n\`\`\``
		await sendAddToInputEvent(prompt2)
	}

	telemetryService.captureButtonClick("codeAction_improveCode", controller.task?.ulid)

	return {}
}
