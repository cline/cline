import { Controller } from "@core/controller/index"
import { Empty, RemoteConfigSettingsResponse } from "@/shared/proto/index.cline"

export async function getRemoteConfigSettings(_controller: Controller, _request: Empty): Promise<RemoteConfigSettingsResponse> {
	return RemoteConfigSettingsResponse.create({})
}
