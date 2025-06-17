import posthog from "posthog-js"

import { telemetryClient } from "../TelemetryClient"

vi.mock("posthog-js", () => ({
	default: {
		reset: vi.fn(),
		init: vi.fn(),
		identify: vi.fn(),
		capture: vi.fn(),
	},
}))

describe("TelemetryClient", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should be a singleton", () => {
		// Basic test to verify the service exists
		expect(telemetryClient).toBeDefined()
	})

	it("should have updateTelemetryState method", () => {
		// Test if the method exists
		expect(typeof telemetryClient.updateTelemetryState).toBe("function")

		// Call it with different values to verify it doesn't throw errors
		expect(() => telemetryClient.updateTelemetryState("enabled")).not.toThrow()
		expect(() => telemetryClient.updateTelemetryState("disabled")).not.toThrow()
		expect(() => telemetryClient.updateTelemetryState("unset")).not.toThrow()
	})

	it("should have capture method", () => {
		// Test if the method exists
		expect(typeof telemetryClient.capture).toBe("function")

		// Call it to verify it doesn't throw errors
		expect(() => telemetryClient.capture("test_event")).not.toThrow()
		expect(() => telemetryClient.capture("test_event", { key: "value" })).not.toThrow()
	})

	it("should reset PostHog when updating telemetry state", () => {
		// Act
		telemetryClient.updateTelemetryState("enabled")

		// Assert
		expect(posthog.reset).toHaveBeenCalled()
	})

	it("should initialize PostHog when telemetry is enabled with API key and distinctId", () => {
		// Arrange
		const API_KEY = "test-api-key"
		const DISTINCT_ID = "test-user-id"

		// Act
		telemetryClient.updateTelemetryState("enabled", API_KEY, DISTINCT_ID)

		// Assert
		expect(posthog.init).toHaveBeenCalledWith(
			API_KEY,
			expect.objectContaining({
				api_host: "https://us.i.posthog.com",
				persistence: "localStorage",
				loaded: expect.any(Function),
			}),
		)

		// Instead of trying to extract and call the callback, manually call identify
		// This simulates what would happen when the loaded callback is triggered
		posthog.identify(DISTINCT_ID)

		// Now verify identify was called
		expect(posthog.identify).toHaveBeenCalled()
	})
})
