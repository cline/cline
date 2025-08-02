import { useFeatureFlagEnabled } from "posthog-js/react"

/**
 * Hook to check feature flag status in the webview
 * Feature flags work independently of telemetry settings to ensure
 * proper extension functionality regardless of user privacy preferences
 */
export const useHasFeatureFlag = (flagName: string): boolean => {
	const flagEnabled = useFeatureFlagEnabled(flagName)
	if (flagEnabled && typeof flagEnabled === "boolean") {
		return flagEnabled
	}
	return false
}
