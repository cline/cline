import { Controller } from "@core/controller/index"
import { RemoteConfigSetting, StringRequest } from "@/shared/proto/index.cline"

export async function toggleRemoteConfigSetting(_controller: Controller, _request: StringRequest): Promise<RemoteConfigSetting> {
	return RemoteConfigSetting.create({})
}
