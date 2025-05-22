import React, { useEffect, type ReactNode, memo, useCallback, useRef } from "react" // Removed useMemo
import { PostHogProvider } from "posthog-js/react"
import posthog from "posthog-js"
// import equal from "fast-deep-equal" // We'll use shallow from zustand
// import { shallow } from "zustand/shallow" // Import shallow - not needed if selecting individually
import { posthogConfig } from "@shared/services/config/posthog-config"
import { useExtensionState } from "./store/extensionStore" // Changed import
import { logger } from "./utils/logger"

posthog.init(posthogConfig.apiKey, {
	api_host: posthogConfig.host,
	ui_host: posthogConfig.uiHost,
	disable_session_recording: true,
	capture_pageview: false,
	capture_dead_clicks: true,
})

function CustomPostHogProviderComponent({ children }: { children: ReactNode }) {
	const renderCountRef = useRef(0)
	renderCountRef.current += 1
	logger.debug(`[PostHogProvider] Component Render #${renderCountRef.current}`)

	const telemetrySetting = useExtensionState((state) => state.telemetrySetting)
	const vscMachineId = useExtensionState((state) => state.vscMachineId)
	const version = useExtensionState((state) => state.version)

	const prevTelemetryRef = useRef(telemetrySetting)
	const telemetryChanged = telemetrySetting !== prevTelemetryRef.current

	logger.debug(
		"[PostHogProvider] Selected telemetrySetting:",
		telemetrySetting,
		"vscMachineId:",
		vscMachineId,
		"version:",
		version,
	)
	logger.debug("[PostHogProvider] telemetrySetting changed since last render? ->", telemetryChanged)

	useEffect(() => {
		// Update ref after render
		prevTelemetryRef.current = telemetrySetting
	}, [telemetrySetting]) // Only update when telemetrySetting itself changes

	const isTelemetryEnabled = telemetrySetting !== "disabled"

	// Memoize beforeSendCb
	const beforeSendCb = useCallback(
		(payload: any) => {
			if (payload?.properties) {
				payload.properties.extension_version = version
			}
			return payload
		},
		[version], // Dependency: version
	)

	useEffect(() => {
		logger.debug("[PostHogProvider] useEffect RUNNING. Deps:", {
			isTelemetryEnabled,
			vscMachineId,
			versionForCb: version, // To see the version that determines beforeSendCb's identity
		})

		// It's crucial that vscMachineId and version are stable and available here.
		// If they are initially empty and then populate, this effect will run again.
		if (!vscMachineId || vscMachineId.length === 0 || !version || version.length === 0) {
			logger.warn("[PostHogProvider] useEffect: vscMachineId or version is empty/null. Skipping PostHog config.")
			return // Skip PostHog config if essential IDs are missing
		}

		posthog.set_config({
			before_send: beforeSendCb,
		})
		logger.debug("[PostHogProvider] useEffect: posthog.set_config called.")

		if (isTelemetryEnabled && !posthog.has_opted_in_capturing()) {
			posthog.opt_in_capturing()
			posthog.identify(vscMachineId)
			logger.info("[PostHogProvider] useEffect: Opted IN to capturing.")
		} else if (!isTelemetryEnabled && !posthog.has_opted_out_capturing()) {
			posthog.opt_out_capturing()
			logger.info("[PostHogProvider] useEffect: Opted OUT of capturing.")
		}
	}, [isTelemetryEnabled, vscMachineId, beforeSendCb, version])

	logger.debug("[PostHogProvider] Rendering <PostHogProvider client={posthog}>")
	return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}

export const CustomPostHogProvider = memo(CustomPostHogProviderComponent)
