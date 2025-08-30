/**
 * Tests for the abstracted telemetry system
 * This demonstrates how easy it is to switch between providers
 * and validates the NoOpTelemetryProvider functionality
 */

import * as assert from "assert"
import * as sinon from "sinon"
import { TelemetryProviderFactory, type TelemetryProviderType } from "../TelemetryProviderFactory"
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

	describe("PostHog Provider", () => {
		it("should create PostHog provider and track events", async () => {
			console.log("=== Testing PostHog Provider ===")
			const posthogProvider = TelemetryProviderFactory.createProvider({
				type: "posthog",
			})

			const posthogTelemetryService = new TelemetryService(posthogProvider)

			// Test various telemetry methods
			posthogTelemetryService.captureTaskCreated("task-123", "anthropic")
			posthogTelemetryService.identifyAccount(mockUserInfo)
			posthogTelemetryService.captureTaskCompleted("task-123")
			posthogTelemetryService.captureModelSelected("claude-3", "anthropic", "task-123")

			// Test provider methods directly
			posthogProvider.log("test_event", { test: "property" })
			posthogProvider.identifyUser(mockUserInfo, { additional: "data" })
			posthogProvider.setOptIn(true)

			// Verify provider state
			const isEnabled = posthogProvider.isEnabled()
			const settings = posthogProvider.getSettings()

			console.log("PostHog Provider enabled:", isEnabled)
			console.log("PostHog Provider settings:", settings)

			await posthogProvider.dispose()
		})
	})

	describe("No-Op Provider", () => {
		it("should create No-Op provider and handle all operations safely", async () => {
			console.log("\n=== Testing No-Op Provider ===")
			const noOpProvider = TelemetryProviderFactory.createProvider({
				type: "none",
			})

			const noOpTelemetryService = new TelemetryService(noOpProvider)

			// Test various telemetry methods - should all be no-ops
			noOpTelemetryService.captureTaskCreated("task-789", "google")
			noOpTelemetryService.identifyAccount(mockUserInfo)
			noOpTelemetryService.captureTaskCompleted("task-789")
			noOpTelemetryService.captureModelSelected("gpt-4", "openai", "task-789")
			noOpTelemetryService.captureToolUsage("task-789", "write_to_file", "gpt-4", false, true)

			// Test provider methods directly
			noOpProvider.log("test_event", { test: "property" })
			noOpProvider.identifyUser(mockUserInfo, { additional: "data" })
			noOpProvider.setOptIn(true)
			noOpProvider.setOptIn(false)

			// Verify provider state
			const isEnabled = noOpProvider.isEnabled()
			const settings = noOpProvider.getSettings()

			// NoOp provider should always return false for isEnabled
			assert.strictEqual(isEnabled, false, "NoOp provider should always be disabled")

			// NoOp provider should return consistent settings
			assert.deepStrictEqual(
				settings,
				{
					extensionEnabled: false,
					hostEnabled: false,
					level: "off",
				},
				"NoOp provider should return consistent settings",
			)

			console.log("No-Op Provider enabled:", isEnabled)
			console.log("No-Op Provider settings:", settings)

			await noOpProvider.dispose()
		})

		it("should handle unsupported provider types by returning No-Op provider", async () => {
			console.log("\n=== Testing Unsupported Provider Type ===")

			// Spy on console.error to verify error logging
			const consoleSpy = sinon.stub(console, "error")

			// Test unsupported type by casting to bypass TypeScript checking
			const unsupportedProvider = TelemetryProviderFactory.createProvider({
				type: "unsupported_provider" as TelemetryProviderType,
			})

			// Should have logged an error
			assert.ok(
				consoleSpy.calledWith("Unsupported telemetry provider type: unsupported_provider"),
				"Should log error for unsupported provider type",
			)

			// Should return NoOp provider
			assert.strictEqual(unsupportedProvider.isEnabled(), false, "Unsupported provider should return NoOp provider")
			assert.deepStrictEqual(
				unsupportedProvider.getSettings(),
				{
					extensionEnabled: false,
					hostEnabled: false,
					level: "off",
				},
				"Unsupported provider should return NoOp settings",
			)

			// Should handle all operations safely
			const telemetryService = new TelemetryService(unsupportedProvider)
			telemetryService.captureTaskCreated("task-456", "test")
			telemetryService.identifyAccount(mockUserInfo)

			await unsupportedProvider.dispose()

			// Restore console.error
			consoleSpy.restore()
		})
	})

	describe("Factory Configuration", () => {
		it("should return default configuration", () => {
			const defaultConfig = TelemetryProviderFactory.getDefaultConfig()

			assert.deepStrictEqual(
				defaultConfig,
				{
					type: "posthog",
				},
				"Should return PostHog as default configuration",
			)
		})

		it("should handle provider switching seamlessly", async () => {
			console.log("\n=== Testing Provider Switching ===")

			// Start with PostHog provider
			const posthogProvider = TelemetryProviderFactory.createProvider({
				type: "posthog",
			})
			let telemetryService = new TelemetryService(posthogProvider)

			telemetryService.captureTaskCreated("task-switch-1", "anthropic")
			console.log("Captured event with PostHog provider")

			await posthogProvider.dispose()

			// Switch to No-Op provider
			const noOpProvider = TelemetryProviderFactory.createProvider({
				type: "none",
			})
			telemetryService = new TelemetryService(noOpProvider)

			telemetryService.captureTaskCreated("task-switch-2", "openai")
			console.log("Captured event with No-Op provider")

			// Verify different behaviors
			// PostHog provider may be enabled depending on configuration
			// NoOp provider should always be disabled
			assert.strictEqual(noOpProvider.isEnabled(), false, "NoOp provider should always be disabled")

			await noOpProvider.dispose()
		})
	})
})
