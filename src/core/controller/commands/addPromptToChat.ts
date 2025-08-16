import { Controller } from "../index"
import { CommandContext, Empty } from "@/shared/proto/index.cline"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"
import { sendAddToInputEvent } from "../ui/subscribeToAddToInput"

export async function addPromptToChat(controller: Controller, request: CommandContext): Promise<Empty> {
	const prompt = request.prompt || ""

	if (request.submit) {
		await controller.initTask(prompt)
	} else {
		await sendAddToInputEvent(prompt)
	}

	telemetryService.captureButtonClick("command_addPromptToChat", controller.task?.ulid)

	return {}
}
