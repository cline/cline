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

/**
 * Tri-state feature flag status.
 * - "enabled" / "disabled": PostHog has resolved the flag.
 * - "loading": PostHog hasn't returned flags yet (e.g. mid auth/identify
 *   handshake, or while remote config is still loading).
 *
 * The boolean {@link useHasFeatureFlag} collapses "loading" into `false`, which
 * causes a false-negative when a feature is briefly treated as disabled before
 * flags have actually resolved. Callers that must not flash a disabled/empty
 * state before flags load should use this variant and treat "loading" distinctly
 * from "disabled".
 */
export type FeatureFlagStatus = "enabled" | "disabled" | "loading"

export const useFeatureFlagStatus = (flagName: string): FeatureFlagStatus => {
	const { environment } = useExtensionState()
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"
	const [status, setStatus] = useState<FeatureFlagStatus>("loading")

	useEffect(() => {
		if (isSelfHostedOrUnknown) {
			setStatus("disabled")
			return
		}

		const readFlag = () => {
			// posthog.isFeatureEnabled returns undefined until flags have loaded.
			const value = posthog.isFeatureEnabled(flagName)
			if (value === undefined) {
				setStatus("loading")
				return
			}
			setStatus(value ? "enabled" : "disabled")
		}

		readFlag()
		return posthog.onFeatureFlags(readFlag)
	}, [flagName, isSelfHostedOrUnknown])

	if (isSelfHostedOrUnknown) {
		return "disabled"
	}

	return status
}
