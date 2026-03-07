import { useFeatureFlagEnabled } from "posthog-js/react"
import { useExtensionState } from "../context/ExtensionStateContext"

/**
 * Hook to check feature flag status in the webview
 * Feature flags work independently of telemetry settings to ensure
 * proper extension functionality regardless of user privacy preferences.
 *
 * In self-hosted mode, always returns false since PostHog is disabled.
 */
export const useHasFeatureFlag = (flagName: string): boolean => {
	const { environment } = useExtensionState()
	// Treat unknown/undefined/null/empty environment as selfHosted (safety fallback)
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"

	// Note: We must call useFeatureFlagEnabled unconditionally due to React's Rules of Hooks.
	// In selfHosted mode, PostHog isn't initialized so this returns undefined (harmless no-op).
	const flagEnabled = useFeatureFlagEnabled(isSelfHostedOrUnknown ? "" : flagName)

	if (isSelfHostedOrUnknown) {
		return false
	}

	if (flagEnabled && typeof flagEnabled === "boolean") {
		return flagEnabled
	}
	return false
}
