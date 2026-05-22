import type { ArtifactKernelState } from "@services/artifact-preview/ArtifactKernelService"
import {
	ArtifactKernelInfoResponse,
	type GetArtifactKernelInfoRequest,
	ArtifactKernelState as ProtoArtifactKernelState,
} from "@shared/proto/cline/html_preview"
import type { Controller } from ".."
import { isWorkspaceTrustedForPython } from "./ensurePythonExecutionAllowed"

function toProtoState(state: ArtifactKernelState | undefined): ProtoArtifactKernelState {
	switch (state) {
		case "stopped":
			return ProtoArtifactKernelState.ARTIFACT_KERNEL_STATE_STOPPED
		case "starting":
			return ProtoArtifactKernelState.ARTIFACT_KERNEL_STATE_STARTING
		case "ready":
			return ProtoArtifactKernelState.ARTIFACT_KERNEL_STATE_READY
		case "busy":
			return ProtoArtifactKernelState.ARTIFACT_KERNEL_STATE_BUSY
		case "error":
			return ProtoArtifactKernelState.ARTIFACT_KERNEL_STATE_ERROR
		default:
			return ProtoArtifactKernelState.ARTIFACT_KERNEL_STATE_STOPPED
	}
}

export async function getArtifactKernelInfo(
	controller: Controller,
	request: GetArtifactKernelInfoRequest,
): Promise<ArtifactKernelInfoResponse> {
	const artifactId = request.artifactId?.trim() || ""
	const svc = controller.getArtifactKernelService()
	const profileId = request.profileId?.trim() || svc.getActiveProfileId()
	const info = artifactId ? await svc.getInfoOrDefault(artifactId, profileId) : null

	const { environments, activeProfileId } = await svc.listEnvironments()
	const active = environments.find((e) => e.id === (info?.profileId || activeProfileId))

	return ArtifactKernelInfoResponse.create({
		artifactId,
		interpreterPath: info?.interpreterPath || active?.interpreterPath || "",
		state: toProtoState(info?.state),
		cwd: info?.cwd || active?.cwd || "",
		lastError: info?.lastError || "",
		profileId: info?.profileId || activeProfileId || "",
		label: info?.label || active?.label || "",
		pythonVersion: info?.pythonVersion || "",
		packagesProbe: info?.packagesProbe || "",
		kernelDirty: info?.kernelDirty ?? false,
		executionCount: info?.executionCount ?? 0,
		workspaceTrusted: isWorkspaceTrustedForPython(),
	})
}
