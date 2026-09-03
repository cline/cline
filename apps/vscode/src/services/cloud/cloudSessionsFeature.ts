import { featureFlagsService } from "@/services/feature-flags"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"

/**
 * Cloud sessions are rolled out behind the `ext-cloud-sessions` PostHog flag.
 * `CLINE_CLOUD_SESSIONS=1` forces it on for local development and testing.
 */
export function isCloudSessionsFeatureEnabled(): boolean {
	const override = process.env.CLINE_CLOUD_SESSIONS?.trim().toLowerCase()
	if (override === "1" || override === "true") {
		return true
	}
	if (override === "0" || override === "false") {
		return false
	}
	return featureFlagsService.getBooleanFlagEnabled(FeatureFlag.CLOUD_SESSIONS)
}
