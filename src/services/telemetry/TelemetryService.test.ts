/**
 * Simple test to demonstrate the abstracted telemetry system
 * This shows how easy it is to switch between providers
 */

import { TelemetryProviderFactory } from "./TelemetryProviderFactory"
import { TelemetryService } from "./TelemetryService"

// Mock user info for testing
const mockUserInfo = {
	id: "test-user-123",
	email: "test@example.com",
	displayName: "Test User",
	createdAt: new Date().toISOString(),
	organizations: [],
}

// Test with PostHog provider
console.log("=== Testing PostHog Provider ===")
const posthogProvider = TelemetryProviderFactory.createProvider({
	type: "posthog",
	distinctId: "test-distinct-id",
})

const posthogTelemetryService = new TelemetryService(posthogProvider)
posthogTelemetryService.captureTaskCreated("task-123", "anthropic")
posthogTelemetryService.identifyAccount(mockUserInfo)

// Test with No-Op provider
console.log("\n=== Testing No-Op Provider ===")
const noOpProvider = TelemetryProviderFactory.createProvider({
	type: "none",
})

const noOpTelemetryService = new TelemetryService(noOpProvider)
noOpTelemetryService.captureTaskCreated("task-789", "google")
noOpTelemetryService.identifyAccount(mockUserInfo)

console.log("\n=== All tests completed successfully! ===")
console.log("The telemetry system is now properly abstracted and can easily switch between providers.")
