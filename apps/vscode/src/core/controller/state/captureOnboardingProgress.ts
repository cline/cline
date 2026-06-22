import { Empty } from "@shared/proto/cline/common"
import { OnboardingProgressRequest } from "@shared/proto/cline/state"
import type { Controller } from "../index"

export async function captureOnboardingProgress(_controller: Controller, _request: OnboardingProgressRequest): Promise<Empty> {
	return Empty.create({})
}
