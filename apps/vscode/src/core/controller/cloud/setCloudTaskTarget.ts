import type { CloudTaskTargetSelection } from "@shared/cloud/cloud-sessions"
import type { CloudTaskTarget } from "@shared/proto/cline/cloud"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/** Remembers the Local/Cloud choice (and repository) for the next task. */
export async function setCloudTaskTarget(controller: Controller, request: CloudTaskTarget): Promise<Empty> {
	const selection: CloudTaskTargetSelection = {
		target: request.target === "cloud" ? "cloud" : "local",
		repoUrl: request.repoUrl?.trim() || undefined,
		repositoryId: request.repositoryId ? Number(request.repositoryId) : undefined,
		branch: request.branch?.trim() || undefined,
	}
	controller.stateManager.setGlobalState("cloudTaskTarget", selection)
	await controller.postStateToWebview()
	return Empty.create()
}
