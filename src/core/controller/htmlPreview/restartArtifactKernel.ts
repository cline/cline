import { Empty } from "@shared/proto/cline/common"
import type { RestartArtifactKernelRequest } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

export async function restartArtifactKernel(controller: Controller, request: RestartArtifactKernelRequest): Promise<Empty> {
	const artifactId = request.artifactId?.trim() || ""
	if (!artifactId) {
		return Empty.create()
	}
	controller.getArtifactKernelService().restartKernel(artifactId, request.profileId?.trim() || undefined)
	return Empty.create()
}
