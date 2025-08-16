import { Controller } from "../index"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { getFileMentionFromPath } from "@/core/mentions"

export async function improveWithCline(controller: Controller, request: CommandContext): Promise<Empty> {
	if (!request.selectedText || !request.selectedText.trim()) {
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Please select some code to improve.",
		})
		return {}
	}
	const fileMention = await getFileMentionFromPath(request.filePath || "")
	const prompt = `Improve the following code from ${fileMention} (e.g., suggest refactorings, optimizations, or better practices):
\`\`\`${request.language}\n${request.selectedText}\n\`\`\``

	await controller.initTask(prompt)

	telemetryService.captureButtonClick("codeAction_improveCode", controller.task?.ulid)

	return {}
}
