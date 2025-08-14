import { Controller } from "../index"
import { AddToClineRequest, Empty } from "@/shared/proto/index.cline"
import { telemetryService } from "@/services/posthog/PostHogClientProvider"

export async function addToCline(controller: Controller, request: AddToClineRequest): Promise<Empty> {
	await controller.addSelectedCodeToChat(
		request.selectedText || "",
		request.filePath || "",
		request.language || "",
		request.diagnostics,
	)
	telemetryService.captureButtonClick("codeAction_addToChat", controller.task?.ulid)

	return {}
}
