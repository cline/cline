import { Controller } from "@/sdk"
import { RemoteConfigSetting, StringRequest } from "@/shared/proto/index.cline"

export async function toggleRemoteConfigSetting(_controller: Controller, _request: StringRequest): Promise<RemoteConfigSetting> {
	// TODO(ENG): Toggling remote config settings is not implemented yet. The
	// `enabled` flag is currently hardcoded to `true` in getRemoteConfigSettings,
	// so there is no per-setting enabled state to flip. When this is wired up,
	// look up the setting by name, persist the new enabled state, and return the
	// updated RemoteConfigSetting. Until then, reject so the caller's request
	// completes instead of hanging forever.
	throw new Error("toggleRemoteConfigSetting is not implemented")
}
