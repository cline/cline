import { getFileMentionFromPath } from "@/core/mentions"
import { singleFileDiagnosticsToProblemsString } from "@/integrations/diagnostics"
import { telemetryService } from "@/services/telemetry"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { Controller } from "../index"
import { sendAddToInputEvent } from "../ui/subscribeToAddToInput"

// 'Add to Cline' context menu in editor and code action
// Inserts the selected code into the chat.
export async function addToCline(controller: Controller, request: CommandContext): Promise<Empty> {
	if (!request.selectedText) {
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)

	let input = `${fileMention}\n\`\`\`\n${request.selectedText}\n\`\`\``
	if (request.diagnostics.length) {
		const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)
		input += `\nProblems:\n${problemsString}`
	}

	await sendAddToInputEvent(input)

	console.log("addToCline", request.selectedText, filePath, request.language)
	telemetryService.captureButtonClick("codeAction_addToChat", controller.task?.ulid)

	return {}
}
