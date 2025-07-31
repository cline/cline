import { posthogConfig } from "@shared/services/config/posthog-config"
import posthog from "posthog-js"
import { PostHogProvider } from "posthog-js/react"
import { type ReactNode, useEffect } from "react"
import { useExtensionState } from "./context/ExtensionStateContext"

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { telemetrySetting, distinctId, version } = useExtensionState()
	const isTelemetryEnabled = telemetrySetting !== "disabled"

	// NOTE: This is a hack to stop recording webview click events temporarily.
	// Remove this to re-enable.
	const temporaryDisabled = true

	useEffect(() => {
		if (temporaryDisabled) {
			return
		}

		posthog.init(posthogConfig.apiKey, {
			api_host: posthogConfig.host,
			ui_host: posthogConfig.uiHost,
			disable_session_recording: true,
			capture_pageview: false,
			capture_dead_clicks: true,
			// Feature flags should work regardless of telemetry opt-out
			advanced_disable_decide: false,
			// Autocapture should respect telemetry settings
			autocapture: false,
		})
	}, [])

	useEffect(() => {
		if (temporaryDisabled || distinctId.length === 0 || version.length === 0) {
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
				}
				return payload
			},
		})

		const optedIn = posthog.has_opted_in_capturing()
		const optedOut = posthog.has_opted_out_capturing()

		if (isTelemetryEnabled && !optedIn) {
			posthog.opt_in_capturing()
			posthog.identify(distinctId)
		} else if (!isTelemetryEnabled && !optedOut) {
			// For feature flags to work, we need to identify the user even when telemetry is disabled
			posthog.identify(distinctId)
			// Then opt out of capturing other events
			posthog.opt_out_capturing()
		}
	}, [isTelemetryEnabled, distinctId, version])

	return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
