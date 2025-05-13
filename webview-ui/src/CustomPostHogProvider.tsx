import { useEffect, type ReactNode } from "react"
import { PostHogProvider } from "posthog-js/react"
import posthog from "posthog-js"
import { posthogConfig } from "@shared/services/config/posthog-config"
import { useExtensionState } from "./context/ExtensionStateContext"
import { vscode } from "./utils/vscode"

export function CustomPostHogProvider({ children }: { children: ReactNode }) {
	const { telemetrySetting, vscMachineId } = useExtensionState()
	const isTelemetryEnabled = telemetrySetting !== "disabled"

	useEffect(() => {
		posthog.init(posthogConfig.apiKey, {
			api_host: posthogConfig.host,
			ui_host: posthogConfig.uiHost,
			opt_out_capturing_by_default: true,
			disable_session_recording: true,
			capture_pageview: false,
			capture_dead_clicks: true,
			bootstrap: {
				distinctID: vscMachineId,
			},
		})

		if (isTelemetryEnabled) {
			posthog.opt_in_capturing()
		} else {
			posthog.opt_out_capturing()
		}
	}, [isTelemetryEnabled])

	return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
