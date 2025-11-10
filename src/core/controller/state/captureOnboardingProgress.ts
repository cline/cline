import { Empty } from "@shared/proto/cline/common"
import { OnboardingProgressRequest } from "@shared/proto/cline/state"
import { telemetryService } from "../../../services/telemetry"
import type { Controller } from "../index"

/**
 * Captures the onboarding progress step
 * @param controller The controller instance
 * @param request The request containing the step number
 * @returns Empty response
 */
export async function captureOnboardingProgress(_controller: Controller, request: OnboardingProgressRequest): Promise<Empty> {
	try {
		telemetryService.captureOnboardingProgress({
			step: Number(request.step),
			model: request.modelSelected,
			action: request.action,
			completed: !!request.completed,
		})
		return Empty.create({})
	} catch (error) {
		console.error("Failed to set welcome view completed:", error)
		throw error
	}
}
