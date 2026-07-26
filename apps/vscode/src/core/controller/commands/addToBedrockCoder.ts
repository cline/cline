import { getFileMentionFromPath } from "@/core/mentions"
import { singleFileDiagnosticsToProblemsString } from "@/integrations/diagnostics"
import { CommandContext, Empty } from "@/shared/proto/index.bedrock_coder"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"
import { sendAddToInputEvent } from "../ui/subscribeToAddToInput"

// "Add to BedrockCoder" context menu in an ordinary text editor.
export async function addToBedrockCoder(_controller: Controller, request: CommandContext): Promise<Empty> {
	if (!request.selectedText?.trim()) {
		Logger.log("No text selected - returning early")
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
	Logger.log("addToBedrockCoder", request.selectedText, filePath, request.language)
	return {}
}
