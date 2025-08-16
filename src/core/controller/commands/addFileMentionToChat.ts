import { Controller } from "../index"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { sendAddToInputEvent } from "../ui/subscribeToAddToInput"
import { getFileMentionFromPath } from "@/core/mentions"

export async function addFileMentionToChat(controller: Controller, request: CommandContext): Promise<Empty> {
	const filePath = request.filePath || ""
	if (!filePath) return {}

	const fileMention = await getFileMentionFromPath(filePath)

	if (request.submit) {
		await controller.initTask(fileMention)
	} else {
		await sendAddToInputEvent(fileMention)
	}

	telemetryService.captureButtonClick("command_addFileMentionToChat", controller.task?.ulid)

	return {}
}
