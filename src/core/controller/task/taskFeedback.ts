import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Handles task feedback submission (thumbs up/down)
 * @param controller The controller instance
 * @param request The StringRequest containing the feedback type ("thumbs_up" or "thumbs_down") in the value field
 * @returns Empty response
 */
export async function taskFeedback(controller: Controller, request: StringRequest): Promise<Empty> {
	if (!request.value) {
		console.warn("taskFeedback: Missing feedback type value")
		return Empty.create()
	}

	try {
		if (controller.task?.ulid) {
			telemetryService.captureTaskFeedback(controller.task.ulid, request.value as any)
		} else {
			console.warn("taskFeedback: No active task to receive feedback")
		}
	} catch (error) {
		console.error("Error in taskFeedback handler:", error)
	}

	return Empty.create()
}
