import { Controller } from "../index"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { getFileMentionFromPath } from "@/core/mentions"

export async function explainWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	if (!request.selectedText || !request.selectedText.trim()) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to explain.",
		})
		return {}
	}
	const fileMention = await getFileMentionFromPath(request.filePath || "")
	const prompt = `Explain the following code from ${fileMention}:
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``
	await controller.initTask(prompt)
	telemetryService.captureButtonClick("codeAction_explainCode", controller.task?.ulid)

	return {}
}
