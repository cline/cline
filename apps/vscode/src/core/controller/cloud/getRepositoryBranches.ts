import { CloudBranchList, type RepositoryBranchesRequest } from "@shared/proto/cline/cloud"
import type { Controller } from "../index"

export async function getRepositoryBranches(
	controller: Controller,
	request: RepositoryBranchesRequest,
): Promise<CloudBranchList> {
	const branches = await controller.cloudSessions.listBranches(Number(request.repositoryId), request.query)
	return CloudBranchList.create({ branches })
}
