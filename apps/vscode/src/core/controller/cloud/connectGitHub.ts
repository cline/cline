import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import { openExternal } from "@/utils/env"
import type { Controller } from "../index"

/** Opens the GitHub App install (or manage repository access) page in the browser. */
export async function connectGitHub(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const url = await controller.cloudSessions.getGitHubInstallUrl().catch(() => controller.cloudSessions.githubConnectUrl())
	await openExternal(url)
	return Empty.create()
}
