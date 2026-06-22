import { Empty } from "@shared/proto/cline/common"
import { UpdateSettingsRequestCli } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function updateSettingsCli(_controller: Controller, _request: UpdateSettingsRequestCli): Promise<Empty> {
	return Empty.create({})
}
