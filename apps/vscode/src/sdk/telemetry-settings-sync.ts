import { existsSync } from "node:fs"
import { readGlobalSettings, setTelemetryOptOutGlobally } from "@cline/core"
import { resolveGlobalSettingsPath } from "@cline/shared/storage"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { Logger } from "@/shared/services/Logger"

interface TelemetryStateManager {
	getGlobalSettingsKey(key: "telemetrySetting"): TelemetrySetting | boolean | undefined
	getRemoteConfigSettings(): { telemetrySetting?: TelemetrySetting }
	setGlobalState(key: "telemetrySetting", value: TelemetrySetting): void
}

export function telemetrySettingFromSharedGlobalSettings(): TelemetrySetting {
	return readGlobalSettings().telemetryOptOut ? "disabled" : "enabled"
}

function normalizeLegacyTelemetrySetting(value: TelemetrySetting | boolean | undefined): TelemetrySetting | undefined {
	if (value === false) {
		return "disabled"
	}
	if (value === true) {
		return "enabled"
	}
	if (value === "disabled" || value === "enabled" || value === "unset") {
		return value
	}
	return undefined
}

export function syncTelemetrySettingFromSharedGlobalSettings(stateManager: TelemetryStateManager): void {
	try {
		const sharedSettingsPath = resolveGlobalSettingsPath()
		if (!existsSync(sharedSettingsPath)) {
			const legacyTelemetrySetting = normalizeLegacyTelemetrySetting(stateManager.getGlobalSettingsKey("telemetrySetting"))
			if (legacyTelemetrySetting !== undefined) {
				// One-time migration from the legacy VS Code globalState.json field into
				// the CLI/shared global settings file. Older builds stored this as a
				// boolean where false meant telemetry was disabled.
				// Do not emit opt-out telemetry for migration; this is not a new explicit
				// user action.
				setTelemetryOptOutGlobally(legacyTelemetrySetting === "disabled")
			}
		}

		const telemetrySetting = telemetrySettingFromSharedGlobalSettings()
		const remoteTelemetrySetting = stateManager.getRemoteConfigSettings().telemetrySetting
		if (remoteTelemetrySetting === undefined && stateManager.getGlobalSettingsKey("telemetrySetting") !== telemetrySetting) {
			// Keep the legacy in-memory state mirrored so existing VS Code telemetry
			// providers that still read StateManager observe the shared setting.
			stateManager.setGlobalState("telemetrySetting", telemetrySetting)
		}
	} catch (error) {
		Logger.warn(`[SdkController] Failed to sync shared telemetry setting: ${error}`)
	}
}
