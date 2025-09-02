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
	const MOCK_USER_INFO = {
		id: "test-user-123",
		email: "test@example.com",
		displayName: "Test User",
		createdAt: new Date().toISOString(),
		organizations: [],
	}
	const MOCK_METADATA = {
		extension_version: "1.2.3",
		platform: "Test-IDE",
		platform_version: "9.8.7-abc",
		os_type: "win32",
		os_version: "Windows 10 Pro",
		is_dev: "",
	}

	describe("Telemetry Service", () => {
		it("should include correct metadata with telemetry events", async () => {
			const noOpProvider = TelemetryProviderFactory.createProvider({
				type: "none",
			})

			// Spy on the provider's log method to verify metadata
			const logSpy = sinon.spy(noOpProvider, "log")
			const identifyUserSpy = sinon.spy(noOpProvider, "identifyUser")

			const telemetryService = new TelemetryService(noOpProvider, MOCK_METADATA)

			// Reset the spy to ignore the initial telemetry event from constructor
			logSpy.resetHistory()

			// Test that metadata is included in events
			telemetryService.captureTaskCreated("task-456", "openai")

			// Verify that log was called with correct arguments
			assert.ok(logSpy.calledOnce, "Log should be called once")
			const [eventName, properties] = logSpy.firstCall.args
			assert.strictEqual(eventName, "task.created", "Event name should be task.created")
			assert.deepStrictEqual(
				properties,
				{
					ulid: "task-456",
					apiProvider: "openai",
					...MOCK_METADATA,
				},
				"Task created event should include only the expected metadata properties",
			)

			// Test identify includes metadata
			telemetryService.identifyAccount(MOCK_USER_INFO)

			assert.ok(identifyUserSpy.calledOnce, "IdentifyUser should be called once")
			const [userInfo, metadata] = identifyUserSpy.firstCall.args
			assert.deepStrictEqual(userInfo, MOCK_USER_INFO, "User info should match")
			assert.deepStrictEqual(metadata, MOCK_METADATA, "Identify user should include only the expected metadata properties")

			// Test direct provider calls don't include metadata
			noOpProvider.log("direct_event", { custom: "data" })
			assert.ok(logSpy.calledWith("direct_event", { custom: "data" }), "Direct provider log should not add metadata")

			// Restore spies
			logSpy.restore()
			identifyUserSpy.restore()

			await noOpProvider.dispose()
		})
	})
	describe("PostHog Provider", () => {
		it("should create PostHog provider and track events", async () => {
			console.log("=== Testing PostHog Provider ===")
			const posthogProvider = TelemetryProviderFactory.createProvider({
				type: "posthog",
			})

			const posthogTelemetryService = new TelemetryService(posthogProvider, MOCK_METADATA)

			// Test various telemetry methods
			posthogTelemetryService.captureTaskCreated("task-123", "anthropic")
			posthogTelemetryService.identifyAccount(MOCK_USER_INFO)
			posthogTelemetryService.captureTaskCompleted("task-123")
			posthogTelemetryService.captureModelSelected("claude-3", "anthropic", "task-123")

			// Test provider methods directly
			posthogProvider.log("test_event", { test: "property" })
			posthogProvider.identifyUser(MOCK_USER_INFO, { additional: "data" })
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

			const noOpTelemetryService = new TelemetryService(noOpProvider, MOCK_METADATA)

			// Test various telemetry methods - should all be no-ops
			noOpTelemetryService.captureTaskCreated("task-789", "google")
			noOpTelemetryService.identifyAccount(MOCK_USER_INFO)
			noOpTelemetryService.captureTaskCompleted("task-789")
			noOpTelemetryService.captureModelSelected("gpt-4", "openai", "task-789")
			noOpTelemetryService.captureToolUsage("task-789", "write_to_file", "gpt-4", false, true)

			// Test provider methods directly
			noOpProvider.log("test_event", { test: "property" })
			noOpProvider.identifyUser(MOCK_USER_INFO, { additional: "data" })
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
			const telemetryService = new TelemetryService(unsupportedProvider, MOCK_METADATA)
			telemetryService.captureTaskCreated("task-456", "test")
			telemetryService.identifyAccount(MOCK_USER_INFO)

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
			let telemetryService = new TelemetryService(posthogProvider, MOCK_METADATA)

			telemetryService.captureTaskCreated("task-switch-1", "anthropic")
			console.log("Captured event with PostHog provider")

			await posthogProvider.dispose()

			// Switch to No-Op provider
			const noOpProvider = TelemetryProviderFactory.createProvider({
				type: "none",
			})
			telemetryService = new TelemetryService(noOpProvider, MOCK_METADATA)

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
