import { getFileMentionFromPath } from "@/core/mentions"
import { singleFileDiagnosticsToProblemsString } from "@/integrations/diagnostics"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"

export async function fixWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)

	let taskMessage = `Fix the following code in ${fileMention}
\`\`\`\n${request.selectedText}\n\`\`\`\n\nProblems:\n${problemsString}`

	// Add notebook cell JSON for .ipynb files to provide complete context
	if (request.notebookCellJson && filePath.endsWith(".ipynb")) {
		Logger.log("Adding notebook cell JSON to fixWithCline task for enhanced editing")
		taskMessage += `\n\nCurrent Notebook Cell Context (Raw JSON):\n\`\`\`json\n${request.notebookCellJson}\n\`\`\``
	}

	await controller.initTask(taskMessage)
	console.log(
		"fixWithCline",
		request.selectedText,
		request.filePath,
		request.language,
		problemsString,
		request.notebookCellJson ? "with notebook cell JSON" : "",
	)

	telemetryService.captureButtonClick("codeAction_fixWithCline", controller.task?.ulid)
	return {}
}
