import { useEffect, type ReactNode } from "react"
import { PostHogProvider } from "posthog-js/react"
import posthog from "posthog-js"
import { posthogConfig } from "@shared/services/config/posthog-config"
import { useExtensionState } from "./context/ExtensionStateContext"

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { telemetrySetting } = useExtensionState()
	const isTelemetryEnabled = telemetrySetting === "enabled"

	useEffect(() => {
		if (isTelemetryEnabled) {
			posthog.init(posthogConfig.apiKey, {
				api_host: posthogConfig.host,
				autocapture: false,
				disable_session_recording: true,
			})
		} else {
			posthog.opt_out_capturing()
		}
	}, [isTelemetryEnabled])

	return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
