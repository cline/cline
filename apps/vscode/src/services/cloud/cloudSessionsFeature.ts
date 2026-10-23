import { StateManager } from "@/core/storage/StateManager"
import { featureFlagsService } from "@/services/feature-flags"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"

/**
 * `CLINE_CLOUD_SESSIONS=1` forces cloud sessions on (and `0` off) for local
 * development and testing, bypassing both the flag and the Settings toggle.
 */
function readCloudSessionsOverride(): boolean | undefined {
	const override = process.env.CLINE_CLOUD_SESSIONS?.trim().toLowerCase()
	if (override === "1" || override === "true") {
		return true
	}
	if (override === "0" || override === "false") {
		return false
	}
	return undefined
}

/** Whether the `ext-cloud-sessions` rollout makes cloud sessions available to this user. */
export function isCloudSessionsFeatureAvailable(): boolean {
	return readCloudSessionsOverride() ?? featureFlagsService.getBooleanFlagEnabled(FeatureFlag.CLOUD_SESSIONS)
}

/** Whether cloud sessions are both available and turned on by the user in Settings. */
export function isCloudSessionsFeatureEnabled(): boolean {
	const override = readCloudSessionsOverride()
	if (override !== undefined) {
		return override
	}
	return isCloudSessionsFeatureAvailable() && StateManager.get().getGlobalSettingsKey("cloudSessionsEnabled")
}
