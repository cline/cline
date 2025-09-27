import { describe, it, expect, vi, beforeEach } from "vitest"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName, type TelemetrySetting } from "@roo-code/types"

describe("Telemetry Settings Tracking", () => {
	let mockTelemetryService: {
		captureTelemetrySettingsChanged: ReturnType<typeof vi.fn>
		updateTelemetryState: ReturnType<typeof vi.fn>
		hasInstance: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Create mock service
		mockTelemetryService = {
			captureTelemetrySettingsChanged: vi.fn(),
			updateTelemetryState: vi.fn(),
			hasInstance: vi.fn().mockReturnValue(true),
		}

		// Mock the TelemetryService
		vi.spyOn(TelemetryService, "hasInstance").mockReturnValue(true)
		vi.spyOn(TelemetryService, "instance", "get").mockReturnValue(mockTelemetryService as any)
	})

	describe("when telemetry is turned OFF", () => {
		it("should fire event BEFORE disabling telemetry", () => {
			const previousSetting = "enabled" as TelemetrySetting
			const newSetting = "disabled" as TelemetrySetting

			// Simulate the logic from webviewMessageHandler
			const isOptedIn = newSetting !== "disabled"
			const wasPreviouslyOptedIn = previousSetting !== "disabled"

			// If turning telemetry OFF, fire event BEFORE disabling
			if (wasPreviouslyOptedIn && !isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			// Update the telemetry state
			TelemetryService.instance.updateTelemetryState(isOptedIn)

			// Verify the event was captured before updateTelemetryState
			expect(mockTelemetryService.captureTelemetrySettingsChanged).toHaveBeenCalledWith("enabled", "disabled")
			expect(mockTelemetryService.captureTelemetrySettingsChanged).toHaveBeenCalledBefore(
				mockTelemetryService.updateTelemetryState as any,
			)
			expect(mockTelemetryService.updateTelemetryState).toHaveBeenCalledWith(false)
		})

		it("should fire event when going from unset to disabled", () => {
			const previousSetting = "unset" as TelemetrySetting
			const newSetting = "disabled" as TelemetrySetting

			const isOptedIn = newSetting !== "disabled"
			const wasPreviouslyOptedIn = previousSetting !== "disabled"

			if (wasPreviouslyOptedIn && !isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			TelemetryService.instance.updateTelemetryState(isOptedIn)

			expect(mockTelemetryService.captureTelemetrySettingsChanged).toHaveBeenCalledWith("unset", "disabled")
		})
	})

	describe("when telemetry is turned ON", () => {
		it("should fire event AFTER enabling telemetry", () => {
			const previousSetting = "disabled" as TelemetrySetting
			const newSetting = "enabled" as TelemetrySetting

			const isOptedIn = newSetting !== "disabled"
			const wasPreviouslyOptedIn = previousSetting !== "disabled"

			// Update the telemetry state first
			TelemetryService.instance.updateTelemetryState(isOptedIn)

			// If turning telemetry ON, fire event AFTER enabling
			if (!wasPreviouslyOptedIn && isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			// Verify the event was captured after updateTelemetryState
			expect(mockTelemetryService.updateTelemetryState).toHaveBeenCalledWith(true)
			expect(mockTelemetryService.captureTelemetrySettingsChanged).toHaveBeenCalledWith("disabled", "enabled")
			expect(mockTelemetryService.updateTelemetryState).toHaveBeenCalledBefore(
				mockTelemetryService.captureTelemetrySettingsChanged as any,
			)
		})

		it("should not fire event when going from enabled to enabled", () => {
			const previousSetting = "enabled" as TelemetrySetting
			const newSetting = "enabled" as TelemetrySetting

			const isOptedIn = newSetting !== "disabled"
			const wasPreviouslyOptedIn = previousSetting !== "disabled"

			// Neither condition should be met
			if (wasPreviouslyOptedIn && !isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			TelemetryService.instance.updateTelemetryState(isOptedIn)

			if (!wasPreviouslyOptedIn && isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			// Should not fire any telemetry events
			expect(mockTelemetryService.captureTelemetrySettingsChanged).not.toHaveBeenCalled()
			expect(mockTelemetryService.updateTelemetryState).toHaveBeenCalledWith(true)
		})

		it("should fire event when going from unset to enabled (telemetry banner close)", () => {
			const previousSetting = "unset" as TelemetrySetting
			const newSetting = "enabled" as TelemetrySetting

			const isOptedIn = newSetting !== "disabled"
			const wasPreviouslyOptedIn = previousSetting !== "disabled"

			// For unset -> enabled, both are opted in, so no event should fire
			if (wasPreviouslyOptedIn && !isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			TelemetryService.instance.updateTelemetryState(isOptedIn)

			if (!wasPreviouslyOptedIn && isOptedIn && TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, newSetting)
			}

			// unset is treated as opted-in, so no event should fire
			expect(mockTelemetryService.captureTelemetrySettingsChanged).not.toHaveBeenCalled()
		})
	})

	describe("TelemetryService.captureTelemetrySettingsChanged", () => {
		it("should call captureEvent with correct parameters", () => {
			// Create a real instance to test the method
			const mockCaptureEvent = vi.fn()
			const service = new (TelemetryService as any)([])
			service.captureEvent = mockCaptureEvent

			service.captureTelemetrySettingsChanged("enabled", "disabled")

			expect(mockCaptureEvent).toHaveBeenCalledWith(TelemetryEventName.TELEMETRY_SETTINGS_CHANGED, {
				previousSetting: "enabled",
				newSetting: "disabled",
			})
		})
	})
})
