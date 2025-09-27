/**
 * Tests for the abstracted multi-provider telemetry system
 * This demonstrates the multi-provider architecture that supports dual tracking,
 * validates provider switching capabilities, and ensures NoOpTelemetryProvider functionality
 */

import * as assert from "assert"
import * as sinon from "sinon"
import { HostProvider } from "@/hosts/host-provider"
import * as posthogConfigModule from "@/shared/services/config/posthog-config"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { NoOpTelemetryProvider, TelemetryProviderFactory, TelemetryProviderType } from "./TelemetryProviderFactory"
import { TelemetryService } from "./TelemetryService"

describe("Telemetry system is abstracted and can easily switch between providers", () => {
	// Setup and teardown for HostProvider mocking
	before(() => {
		setVscodeHostProviderMock()
	})

	after(() => {
		// Reset HostProvider after tests
		HostProvider.reset()
	})
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
			const noOpProvider = await TelemetryProviderFactory.createProvider({
				type: "no-op",
			})

			// Spy on the provider's log method to verify metadata
			const logSpy = sinon.spy(noOpProvider, "log")
			const identifyUserSpy = sinon.spy(noOpProvider, "identifyUser")

			const telemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

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

		it("should support multi-provider telemetry for dual tracking", async () => {
			// Create multiple providers for dual tracking scenario
			const noOpProvider1 = await TelemetryProviderFactory.createProvider({
				type: "no-op",
			})
			const noOpProvider2 = await TelemetryProviderFactory.createProvider({
				type: "no-op",
			})

			// Spy on both providers to verify they both receive events
			const logSpy1 = sinon.spy(noOpProvider1, "log")
			const logSpy2 = sinon.spy(noOpProvider2, "log")
			const identifyUserSpy1 = sinon.spy(noOpProvider1, "identifyUser")
			const identifyUserSpy2 = sinon.spy(noOpProvider2, "identifyUser")

			// Create TelemetryService with multiple providers
			const telemetryService = new TelemetryService([noOpProvider1, noOpProvider2], MOCK_METADATA)

			// Reset spies to ignore constructor events
			logSpy1.resetHistory()
			logSpy2.resetHistory()

			// Test that events are sent to both providers
			telemetryService.captureTaskCreated("multi-task-123", "anthropic")

			// Verify both providers received the event
			assert.ok(logSpy1.calledOnce, "First provider should receive the event")
			assert.ok(logSpy2.calledOnce, "Second provider should receive the event")

			// Verify event content is correct for both providers
			const [eventName1, properties1] = logSpy1.firstCall.args
			const [eventName2, properties2] = logSpy2.firstCall.args

			assert.strictEqual(eventName1, "task.created", "First provider should receive correct event name")
			assert.strictEqual(eventName2, "task.created", "Second provider should receive correct event name")

			const expectedProperties = {
				ulid: "multi-task-123",
				apiProvider: "anthropic",
				...MOCK_METADATA,
			}
			assert.deepStrictEqual(properties1, expectedProperties, "First provider should receive correct properties")
			assert.deepStrictEqual(properties2, expectedProperties, "Second provider should receive correct properties")

			// Test user identification with multiple providers
			telemetryService.identifyAccount(MOCK_USER_INFO)

			assert.ok(identifyUserSpy1.calledOnce, "First provider should receive user identification")
			assert.ok(identifyUserSpy2.calledOnce, "Second provider should receive user identification")

			// Verify provider count
			const providers = telemetryService.getProviders()
			assert.strictEqual(providers.length, 2, "Should have exactly 2 providers")

			// Cleanup
			logSpy1.restore()
			logSpy2.restore()
			identifyUserSpy1.restore()
			identifyUserSpy2.restore()
			await noOpProvider1.dispose()
			await noOpProvider2.dispose()
		})
	})
	describe("PostHog Provider", () => {
		it("should create PostHog provider and track events", async () => {
			console.log("=== Testing PostHog Provider ===")
			const posthogProvider = await TelemetryProviderFactory.createProvider({
				type: "posthog",
			})

			const posthogTelemetryService = new TelemetryService([posthogProvider], MOCK_METADATA)

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
			const noOpProvider = await TelemetryProviderFactory.createProvider({
				type: "no-op",
			})

			const noOpTelemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

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
			// Test unsupported type by casting to bypass TypeScript checking
			const unsupportedProvider = await TelemetryProviderFactory.createProvider({
				type: "unsupported_provider" as TelemetryProviderType,
			})

			// Should return NoOp provider
			assert.ok(
				unsupportedProvider instanceof NoOpTelemetryProvider,
				"Unsupported provider should be an instance of NoOpTelemetryProvider",
			)
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
			const telemetryService = new TelemetryService([unsupportedProvider], MOCK_METADATA)
			telemetryService.captureTaskCreated("task-456", "test")
			telemetryService.identifyAccount(MOCK_USER_INFO)

			await unsupportedProvider.dispose()
		})
	})

	describe("Factory Configuration", () => {
		it("should return default configuration", () => {
			// Mock PostHog config validation to return true for this test
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(true)

			const defaultConfig = TelemetryProviderFactory.getDefaultConfig()

			assert.deepStrictEqual(
				defaultConfig,
				{
					type: "posthog",
				},
				"Should return PostHog as default configuration",
			)

			// Restore the stub
			isPostHogConfigValidStub.restore()
		})

		it("should handle provider switching seamlessly", async () => {
			console.log("\n=== Testing Provider Switching ===")

			// Start with PostHog provider
			const posthogProvider = await TelemetryProviderFactory.createProvider({
				type: "posthog",
			})
			let telemetryService = new TelemetryService([posthogProvider], MOCK_METADATA)

			telemetryService.captureTaskCreated("task-switch-1", "anthropic")
			console.log("Captured event with PostHog provider")

			await posthogProvider.dispose()

			// Switch to No-Op provider
			const noOpProvider = await TelemetryProviderFactory.createProvider({
				type: "no-op",
			})
			telemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

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
