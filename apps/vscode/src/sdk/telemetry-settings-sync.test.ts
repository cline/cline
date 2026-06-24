import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { TelemetrySetting } from "@shared/TelemetrySetting"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { syncTelemetrySettingFromSharedGlobalSettings } from "./telemetry-settings-sync"

const state = vi.hoisted(() => ({
	telemetrySetting: undefined as TelemetrySetting | boolean | undefined,
	remoteTelemetrySetting: undefined as TelemetrySetting | undefined,
	setGlobalState: vi.fn(),
}))

vi.mock("@cline/core", () => ({
	readGlobalSettings: () => {
		const filePath = process.env.CLINE_GLOBAL_SETTINGS_PATH
		if (!filePath || !existsSync(filePath)) {
			return { autoUpdateEnabled: true, telemetryOptOut: false }
		}
		return { autoUpdateEnabled: true, telemetryOptOut: false, ...JSON.parse(readFileSync(filePath, "utf8")) }
	},
	setTelemetryOptOutGlobally: (telemetryOptOut: boolean) => {
		const filePath = process.env.CLINE_GLOBAL_SETTINGS_PATH
		if (!filePath) {
			throw new Error("CLINE_GLOBAL_SETTINGS_PATH is not set")
		}
		mkdirSync(dirname(filePath), { recursive: true })
		writeFileSync(filePath, `${JSON.stringify({ autoUpdateEnabled: true, telemetryOptOut }, null, 2)}\n`)
	},
}))

function makeStateManager() {
	return {
		getGlobalSettingsKey: vi.fn(() => state.telemetrySetting),
		getRemoteConfigSettings: vi.fn(() => ({ telemetrySetting: state.remoteTelemetrySetting })),
		setGlobalState: state.setGlobalState,
	}
}

describe("syncTelemetrySettingFromSharedGlobalSettings", () => {
	let previousSettingsPath: string | undefined
	let tempDir: string
	let settingsPath: string

	beforeEach(() => {
		previousSettingsPath = process.env.CLINE_GLOBAL_SETTINGS_PATH
		tempDir = mkdtempSync(join(tmpdir(), "cline-vscode-telemetry-sync-"))
		settingsPath = join(tempDir, "global-settings.json")
		process.env.CLINE_GLOBAL_SETTINGS_PATH = settingsPath
		state.telemetrySetting = undefined
		state.remoteTelemetrySetting = undefined
		state.setGlobalState.mockReset()
	})

	afterEach(() => {
		if (previousSettingsPath === undefined) {
			delete process.env.CLINE_GLOBAL_SETTINGS_PATH
		} else {
			process.env.CLINE_GLOBAL_SETTINGS_PATH = previousSettingsPath
		}
		rmSync(tempDir, { force: true, recursive: true })
	})

	it("migrates legacy boolean false to shared telemetry opt-out", () => {
		state.telemetrySetting = false

		syncTelemetrySettingFromSharedGlobalSettings(makeStateManager())

		expect(state.setGlobalState).toHaveBeenCalledWith("telemetrySetting", "disabled")
		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({ telemetryOptOut: true })
	})

	it("migrates legacy string disabled to shared telemetry opt-out", () => {
		state.telemetrySetting = "disabled"

		syncTelemetrySettingFromSharedGlobalSettings(makeStateManager())

		expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toMatchObject({ telemetryOptOut: true })
	})
})
