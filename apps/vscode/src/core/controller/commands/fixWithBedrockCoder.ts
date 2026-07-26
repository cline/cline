import { getFileMentionFromPath } from "@/core/mentions"
import { singleFileDiagnosticsToProblemsString } from "@/integrations/diagnostics"
import { CommandContext, Empty } from "@/shared/proto/index.bedrock_coder"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../index"

export async function fixWithBedrockCoder(controller: Controller, request: CommandContext): Promise<Empty> {
	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	const problemsString = await singleFileDiagnosticsToProblemsString(filePath, request.diagnostics)

	await controller.initTask(
		`Fix the following code in ${fileMention}
\`\`\`\n${request.selectedText}\n\`\`\`\n\nProblems:\n${problemsString}`,
	)
	Logger.log("fixWithBedrockCoder", request.selectedText, request.filePath, request.language, problemsString)
	return {}
}
