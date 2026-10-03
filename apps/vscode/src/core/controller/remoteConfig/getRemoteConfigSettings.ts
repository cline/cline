import { Controller } from "@/sdk"
import { Empty, RemoteConfigSettingsResponse } from "@/shared/proto/index.cline"
import { getAllRemoteConfigSettings } from "./settings"

export async function getRemoteConfigSettings(controller: Controller, _request: Empty): Promise<RemoteConfigSettingsResponse> {
	await controller.waitForInitialRemoteConfig()
	return RemoteConfigSettingsResponse.create({ settings: getAllRemoteConfigSettings(controller) })
}
