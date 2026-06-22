import { Empty } from "@shared/proto/cline/common"
import { AutoApprovalSettingsRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function updateAutoApprovalSettings(_controller: Controller, _request: AutoApprovalSettingsRequest): Promise<Empty> {
	return Empty.create({})
}
