import { posthogConfig } from "@shared/services/config/posthog-config"
import posthog from "posthog-js"
import { PostHogProvider } from "posthog-js/react"
import { type ReactNode, useEffect, useState } from "react"
import { useExtensionState } from "./context/ExtensionStateContext"

const extensionVariant = process.env.CLINE_ROLLOUT_VARIANT
const rolloutVersion = process.env.CLINE_ROLLOUT_VERSION

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { distinctId, version, userInfo, environment, telemetrySetting } = useExtensionState()

	// Skip PostHog entirely in self-hosted mode or when environment is unknown (safety fallback)
	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"

	const isTelemetryEnabled = telemetrySetting !== "disabled"
	const [isActive, setIsActive] = useState(false)

	useEffect(() => {
		if (isSelfHostedOrUnknown || isActive || !posthogConfig.apiKey) {
			return
		}
		// At this point, we know apiKey is defined due to the check above
		const apiKey = posthogConfig.apiKey as string
		posthog.init(apiKey, {
			api_host: posthogConfig.host,
			ui_host: posthogConfig.uiHost,
			disable_session_recording: true,
			capture_pageview: false,
			capture_dead_clicks: false,
			// Feature flags should work regardless of telemetry opt-out
			advanced_disable_decide: false,
			// Autocapture should respect telemetry settings
			autocapture: false,
		})
		setIsActive(true)
	}, [isSelfHostedOrUnknown])

	useEffect(() => {
		if (!isActive || !distinctId || !version) {
			return
		}

		posthog.set_config({
			before_send: (payload) => {
				// Only filter out events if telemetry is disabled, but allow feature flag requests
				if (!isTelemetryEnabled && payload?.event !== "$feature_flag_called") {
					return null
				}

				if (payload?.properties) {
					payload.properties.extension_version = version
					payload.properties.distinct_id = distinctId
					if (extensionVariant === "legacy" || extensionVariant === "next") {
						payload.properties.extension_variant = extensionVariant
						if (rolloutVersion) {
							payload.properties.rollout_version = rolloutVersion
						}
					}
				}
				return payload
			},
		})

		const optedIn = posthog.has_opted_in_capturing()
		const optedOut = posthog.has_opted_out_capturing()
		const args = {
			email: userInfo?.email,
			name: userInfo?.displayName,
		}
		posthog.identify(distinctId, args)

		if (isTelemetryEnabled && !optedIn) {
			posthog.opt_in_capturing()
		} else if (!isTelemetryEnabled && !optedOut) {
			// Then opt out of capturing other events
			posthog.opt_out_capturing()
		}
	}, [isActive, isTelemetryEnabled, distinctId, version])

	return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
