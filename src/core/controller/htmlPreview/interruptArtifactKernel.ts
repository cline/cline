import { type InterruptArtifactKernelRequest, InterruptArtifactKernelResponse } from "@shared/proto/cline/html_preview"
import type { Controller } from ".."

export async function interruptArtifactKernel(
	controller: Controller,
	request: InterruptArtifactKernelRequest,
): Promise<InterruptArtifactKernelResponse> {
	const artifactId = request.artifactId?.trim() || ""
	if (!artifactId) {
		return InterruptArtifactKernelResponse.create({
			recovered: false,
			error: "artifact_id is required",
		})
	}
	const result = await controller.getArtifactKernelService().interruptKernel(artifactId, request.profileId?.trim() || undefined)
	return InterruptArtifactKernelResponse.create({
		recovered: result.recovered,
		error: result.error ?? "",
	})
}
