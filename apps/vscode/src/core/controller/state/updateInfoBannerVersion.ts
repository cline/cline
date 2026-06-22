import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function updateInfoBannerVersion(_controller: Controller, _request: Int64Request): Promise<Empty> {
	return Empty.create({})
}
