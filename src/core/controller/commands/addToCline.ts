import { getFileMentionFromPath } from "@/core/mentions"
import { singleFileDiagnosticsToProblemsString } from "@/integrations/diagnostics"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"
import { sendAddToInputEvent } from "../ui/subscribeToAddToInput"

// 'Add to Cline' context menu in editor and code action
// Inserts the selected code into the chat.
export async function addToCline(controller: Controller, request: CommandContext, notebookContext?: String): Promise<Empty> {
	if (
		(!request.selectedText || !request.selectedText.trim()) &&
		!(request.notebookCellJson && request.filePath?.endsWith(".ipynb"))
	) {
		Logger.log("❌ No text selected and no notebook cell context - returning early")
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)

	let input = `${fileMention}\n\`\`\`\n${request.selectedText}\n\`\`\``

	// Add notebook cell JSON for .ipynb files to provide complete context
	if (request.notebookCellJson && filePath.endsWith(".ipynb")) {
		Logger.log("Adding notebook cell JSON to context for enhanced editing")
		input += `\n${notebookContext}\n`
		input += `\n\nCurrent Notebook Cell Context (Raw JSON):\n\`\`\`json\n${request.notebookCellJson}\n\`\`\``
	}

	if (request.diagnostics.length) {
		const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)
		input += `\nProblems:\n${problemsString}`
	}

	await sendAddToInputEvent(input)

	console.log(
		"addToCline",
		request.selectedText,
		filePath,
		request.language,
		request.notebookCellJson ? "with notebook cell JSON" : "",
	)
	telemetryService.captureButtonClick("codeAction_addToChat", controller.task?.ulid)

	return {}
}
