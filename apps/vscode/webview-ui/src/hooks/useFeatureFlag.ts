import posthog from "posthog-js"
import { useEffect, useState } from "react"
import { useExtensionState } from "../context/ExtensionStateContext"

/**
 * Hook to check feature flag status in the webview.
 *
 * Feature flags work independently of telemetry settings to ensure extension
 * functionality can be gated even when telemetry is disabled. In self-hosted
 * mode, PostHog is not initialized, so feature flags are treated as disabled.
 */
export const useHasFeatureFlag = (flagName: string): boolean => {
	const { environment } = useExtensionState()
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"
	const [flagEnabled, setFlagEnabled] = useState(false)

	useEffect(() => {
		if (isSelfHostedOrUnknown) {
			setFlagEnabled(false)
			return
		}

		const readFlag = () => {
			setFlagEnabled(posthog.isFeatureEnabled(flagName) === true)
		}

		readFlag()
		return posthog.onFeatureFlags(readFlag)
	}, [flagName, isSelfHostedOrUnknown])

	if (isSelfHostedOrUnknown) {
		return false
	}

	return flagEnabled
}
