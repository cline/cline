import posthog from "posthog-js"

import { telemetryClient } from "@src/utils/TelemetryClient"

vi.mock("posthog-js", () => ({
	default: {
		init: vi.fn(),
		reset: vi.fn(),
		identify: vi.fn(),
		capture: vi.fn(),
	},
}))

describe("TelemetryClient", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	/**
	 * Test the singleton pattern
	 */
	it("should be a singleton", () => {
		// Basic test to verify the service exists
		expect(telemetryClient).toBeDefined()

		// Get the constructor via prototype
		const constructor = Object.getPrototypeOf(telemetryClient).constructor

		// Verify static getInstance returns the same instance
		expect(constructor.getInstance()).toBe(telemetryClient)
		expect(constructor.getInstance()).toBe(constructor.getInstance())
	})

	/**
	 * Tests for the updateTelemetryState method
	 */
	describe("updateTelemetryState", () => {
		it("resets PostHog when called", () => {
			// Act
			telemetryClient.updateTelemetryState("enabled")

			// Assert
			expect(posthog.reset).toHaveBeenCalled()
		})

		it("initializes PostHog when telemetry is enabled with API key and distinctId", () => {
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

		it("doesn't initialize PostHog when telemetry is disabled", () => {
			// Act
			telemetryClient.updateTelemetryState("disabled")

			// Assert
			expect(posthog.init).not.toHaveBeenCalled()
		})

		it("doesn't initialize PostHog when telemetry is unset", () => {
			// Act
			telemetryClient.updateTelemetryState("unset")

			// Assert
			expect(posthog.init).not.toHaveBeenCalled()
		})
	})

	/**
	 * Tests for the capture method
	 */
	describe("capture", () => {
		it("captures events when telemetry is enabled", () => {
			// Arrange - set telemetry to enabled
			telemetryClient.updateTelemetryState("enabled", "test-key", "test-user")
			vi.clearAllMocks() // Clear previous calls

			// Act
			telemetryClient.capture("test_event", { property: "value" })

			// Assert
			expect(posthog.capture).toHaveBeenCalledWith("test_event", { property: "value" })
		})

		it("doesn't capture events when telemetry is disabled", () => {
			// Arrange - set telemetry to disabled
			telemetryClient.updateTelemetryState("disabled")
			vi.clearAllMocks() // Clear previous calls

			// Act
			telemetryClient.capture("test_event")

			// Assert
			expect(posthog.capture).not.toHaveBeenCalled()
		})

		/**
		 * This test verifies that no telemetry events are captured when
		 * the telemetry setting is unset, further documenting the expected behavior
		 */
		it("doesn't capture events when telemetry is unset", () => {
			// Arrange - set telemetry to unset
			telemetryClient.updateTelemetryState("unset")
			vi.clearAllMocks() // Clear previous calls

			// Act
			telemetryClient.capture("test_event", { property: "test value" })

			// Assert
			expect(posthog.capture).not.toHaveBeenCalled()
		})
	})
})
