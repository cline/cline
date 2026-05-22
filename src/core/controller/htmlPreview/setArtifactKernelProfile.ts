import { Empty } from "@shared/proto/cline/common"
import type { SetArtifactKernelProfileRequest } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

export async function setArtifactKernelProfile(controller: Controller, request: SetArtifactKernelProfileRequest): Promise<Empty> {
	const profileId = request.profileId?.trim() || ""
	if (!profileId) {
		return Empty.create()
	}
	controller.getArtifactKernelService().setActiveProfile(profileId)
	return Empty.create()
}
