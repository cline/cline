/**
 * Simple test to demonstrate the abstracted telemetry system
 * This shows how easy it is to switch between providers
 */

import { TelemetryProviderFactory } from "../TelemetryProviderFactory"
import { TelemetryService } from "../TelemetryService"

describe("Telemetry system is abstracted and can easily switch between providers", () => {
	// Mock user info for testing
	const mockUserInfo = {
		id: "test-user-123",
		email: "test@example.com",
		displayName: "Test User",
		createdAt: new Date().toISOString(),
		organizations: [],
	}

	it("should create PostHog provider and track events", async () => {
		console.log("=== Testing PostHog Provider ===")
		const posthogProvider = TelemetryProviderFactory.createProvider({
			type: "posthog",
		})

		const posthogTelemetryService = new TelemetryService(posthogProvider)
		posthogTelemetryService.captureTaskCreated("task-123", "anthropic")
		posthogTelemetryService.identifyAccount(mockUserInfo)
		posthogProvider.dispose()
	})

	it("should create No-Op provider and track events", async () => {
		console.log("\n=== Testing No-Op Provider ===")
		const noOpProvider = TelemetryProviderFactory.createProvider({
			type: "none",
		})

		const noOpTelemetryService = new TelemetryService(noOpProvider)
		noOpTelemetryService.captureTaskCreated("task-789", "google")
		noOpTelemetryService.identifyAccount(mockUserInfo)
		noOpProvider.dispose()
	})
})
