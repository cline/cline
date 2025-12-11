import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from "../index"

export async function explainWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	if (
		(!request.selectedText || !request.selectedText.trim()) &&
		!(request.notebookCellJson && request.filePath?.endsWith(".ipynb"))
	) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to explain.",
		})
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	let prompt = `Explain the following code from ${fileMention}:
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``

	// Add notebook cell JSON for .ipynb files to provide complete context
	if (request.notebookCellJson && filePath.endsWith(".ipynb")) {
		Logger.log("Adding notebook cell JSON to explainWithCline task for enhanced context")
		prompt += `\n\nCurrent Notebook Cell Context (Raw JSON):\n\`\`\`json\n${request.notebookCellJson}\n\`\`\``
	}

	await controller.initTask(prompt)
	telemetryService.captureButtonClick("codeAction_explainCode", controller.task?.ulid)

	return {}
}
