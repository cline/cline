import { getFileMentionFromPath } from "@/core/mentions"
import { HostProvider } from "@/hosts/host-provider"
import { CommandContext, Empty } from "@/shared/proto/index.bedrock_coder"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Controller } from "../index"

export async function explainWithBedrockCoder(controller: Controller, request: CommandContext): Promise<Empty> {
	if (!request.selectedText?.trim()) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to explain.",
		})
		return {}
	}

	const filePath = request.filePath || ""
	const fileMention = await getFileMentionFromPath(filePath)
	const prompt = `Explain the following code from ${fileMention}:
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``

	await controller.initTask(prompt)
	return {}
}
