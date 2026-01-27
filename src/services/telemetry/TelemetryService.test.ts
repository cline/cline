/**
 * Tests for the abstracted multi-provider telemetry system
 * This demonstrates the multi-provider architecture that supports dual tracking,
 * validates provider switching capabilities, and ensures NoOpTelemetryProvider functionality
 * Tests for the abstracted multi-provider telemetry system
 * This demonstrates the multi-provider architecture that supports dual tracking,
 * validates provider switching capabilities, and ensures NoOpTelemetryProvider functionality
 */

import * as assert from "assert"
import * as sinon from "sinon"
import { ClineEndpoint } from "@/config"
import { HostProvider } from "@/hosts/host-provider"
import * as otelConfigModule from "@/shared/services/config/otel-config"
import * as posthogConfigModule from "@/shared/services/config/posthog-config"
import { setVscodeHostProviderMock } from "@/test/host-provider-test-utils"
import { NoOpTelemetryProvider, TelemetryProviderFactory } from "./TelemetryProviderFactory"
import { TelemetryMetadata, TelemetryService } from "./TelemetryService"

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
		displayName: "Test User",
		email: "test@example.com",
		createdAt: new Date().toISOString(),
		organizations: [],
	}
	const MOCK_METADATA: TelemetryMetadata = {
		extension_version: "1.2.3",
		cline_type: "cline-unit-test",
		platform: "Test-IDE",
		platform_version: "9.8.7-abc",
		os_type: "win32",
		os_version: "Windows 10 Pro",
		is_dev: "",
	}

	describe("Telemetry Service", () => {
		it("should include correct metadata with telemetry events", async () => {
			const noOpProvider = new NoOpTelemetryProvider()

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
					openAiCompatibleDomain: undefined,
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
			const noOpProvider1 = new NoOpTelemetryProvider()
			const noOpProvider2 = new NoOpTelemetryProvider()

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
				openAiCompatibleDomain: undefined,
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
			const providers = await TelemetryProviderFactory.createProviders()
			const posthogProvider = providers.find((p) => !(p instanceof NoOpTelemetryProvider)) || providers[0]

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
			const noOpProvider = new NoOpTelemetryProvider()

			const noOpTelemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

			// Test various telemetry methods - should all be no-ops
			noOpTelemetryService.captureTaskCreated("task-789", "google")
			noOpTelemetryService.identifyAccount(MOCK_USER_INFO)
			noOpTelemetryService.captureTaskCompleted("task-789")
			noOpTelemetryService.captureModelSelected("gpt-4", "openai", "task-789")
			noOpTelemetryService.captureToolUsage("task-789", "write_to_file", "gpt-4", "openai", false, true)

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
			// Test unsupported type - No-Op provider is the fallback
			const unsupportedProvider = new NoOpTelemetryProvider()

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
		it("should return default configurations", () => {
			// Mock PostHog config validation to return true for this test
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(true)
			const isSelfHostedStub = sinon.stub(ClineEndpoint, "isSelfHosted").returns(false)

			const defaultConfigs = TelemetryProviderFactory.getDefaultConfigs()

			// Should include at least PostHog
			assert.ok(defaultConfigs.length > 0, "Should return at least one configuration")
			assert.ok(
				defaultConfigs.some((c) => c.type === "posthog"),
				"Should include PostHog configuration",
			)

			// Restore the stubs
			isPostHogConfigValidStub.restore()
			isSelfHostedStub.restore()
		})

		it("should NOT include PostHog config when in selfHosted mode", () => {
			// Stub ClineEndpoint.isSelfHosted() to return true (selfHosted mode)
			const isSelfHostedStub = sinon.stub(ClineEndpoint, "isSelfHosted").returns(true)
			// Even if PostHog config is valid, it should be skipped
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(true)

			const configs = TelemetryProviderFactory.getDefaultConfigs()

			// Should NOT include PostHog when in selfHosted mode
			const hasPosthog = configs.some((c) => c.type === "posthog")
			assert.strictEqual(hasPosthog, false, "Should NOT include PostHog configuration in selfHosted mode")

			// Restore the stubs
			isSelfHostedStub.restore()
			isPostHogConfigValidStub.restore()
		})

		it("should include PostHog config when NOT in selfHosted mode and config is valid", () => {
			// Stub ClineEndpoint.isSelfHosted() to return false (normal mode)
			const isSelfHostedStub = sinon.stub(ClineEndpoint, "isSelfHosted").returns(false)
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(true)

			const configs = TelemetryProviderFactory.getDefaultConfigs()

			// Should include PostHog when NOT in selfHosted mode and config is valid
			const hasPosthog = configs.some((c) => c.type === "posthog")
			assert.strictEqual(hasPosthog, true, "Should include PostHog configuration when not in selfHosted mode")

			// Restore the stubs
			isSelfHostedStub.restore()
			isPostHogConfigValidStub.restore()
		})

		it("should NOT include build-time OTEL config when in selfHosted mode", () => {
			// Stub ClineEndpoint.isSelfHosted() to return true (selfHosted mode)
			const isSelfHostedStub = sinon.stub(ClineEndpoint, "isSelfHosted").returns(true)
			// Even if build-time OTEL config is valid, it should be skipped
			const getValidOtelConfigStub = sinon.stub(otelConfigModule, "getValidOpenTelemetryConfig").returns({
				enabled: true,
				metricsExporter: "otlp",
			})
			// Disable runtime OTEL to isolate test
			const getRuntimeOtelConfigStub = sinon.stub(otelConfigModule, "getValidRuntimeOpenTelemetryConfig").returns(null)
			// Disable PostHog to isolate test
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(false)

			const configs = TelemetryProviderFactory.getDefaultConfigs()

			// Should NOT include build-time OTEL when in selfHosted mode
			const hasOtel = configs.some((c) => c.type === "opentelemetry")
			assert.strictEqual(hasOtel, false, "Should NOT include build-time OTEL configuration in selfHosted mode")

			// Restore the stubs
			isSelfHostedStub.restore()
			getValidOtelConfigStub.restore()
			getRuntimeOtelConfigStub.restore()
			isPostHogConfigValidStub.restore()
		})

		it("should include build-time OTEL config when NOT in selfHosted mode", () => {
			// Stub ClineEndpoint.isSelfHosted() to return false (normal mode)
			const isSelfHostedStub = sinon.stub(ClineEndpoint, "isSelfHosted").returns(false)
			const getValidOtelConfigStub = sinon.stub(otelConfigModule, "getValidOpenTelemetryConfig").returns({
				enabled: true,
				metricsExporter: "otlp",
			})
			// Disable runtime OTEL to isolate test
			const getRuntimeOtelConfigStub = sinon.stub(otelConfigModule, "getValidRuntimeOpenTelemetryConfig").returns(null)
			// Disable PostHog to isolate test
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(false)

			const configs = TelemetryProviderFactory.getDefaultConfigs()

			// Should include build-time OTEL when NOT in selfHosted mode
			const hasOtel = configs.some((c) => c.type === "opentelemetry")
			assert.strictEqual(hasOtel, true, "Should include build-time OTEL configuration when not in selfHosted mode")

			// Restore the stubs
			isSelfHostedStub.restore()
			getValidOtelConfigStub.restore()
			getRuntimeOtelConfigStub.restore()
			isPostHogConfigValidStub.restore()
		})

		it("should STILL include runtime env OTEL config even in selfHosted mode", () => {
			// Stub ClineEndpoint.isSelfHosted() to return true (selfHosted mode)
			const isSelfHostedStub = sinon.stub(ClineEndpoint, "isSelfHosted").returns(true)
			// Disable build-time OTEL
			const getValidOtelConfigStub = sinon.stub(otelConfigModule, "getValidOpenTelemetryConfig").returns(null)
			// Enable runtime OTEL (user explicitly configured it)
			const getRuntimeOtelConfigStub = sinon.stub(otelConfigModule, "getValidRuntimeOpenTelemetryConfig").returns({
				enabled: true,
				metricsExporter: "otlp",
				otlpEndpoint: "http://user-collector:4317",
			})
			// Disable PostHog to isolate test
			const isPostHogConfigValidStub = sinon.stub(posthogConfigModule, "isPostHogConfigValid").returns(false)

			const configs = TelemetryProviderFactory.getDefaultConfigs()

			// Should STILL include runtime env OTEL even in selfHosted mode (user explicitly enabled it)
			const hasOtel = configs.some((c) => c.type === "opentelemetry")
			assert.strictEqual(hasOtel, true, "Should include runtime env OTEL configuration even in selfHosted mode")

			// Verify it has bypassUserSettings: true
			const otelConfig = configs.find((c) => c.type === "opentelemetry")
			assert.strictEqual(
				(otelConfig as any).bypassUserSettings,
				true,
				"Runtime env OTEL should have bypassUserSettings: true",
			)

			// Restore the stubs
			isSelfHostedStub.restore()
			getValidOtelConfigStub.restore()
			getRuntimeOtelConfigStub.restore()
			isPostHogConfigValidStub.restore()
		})

		it("should handle provider switching seamlessly", async () => {
			console.log("\n=== Testing Provider Switching ===")

			// Start with available providers
			const providers = await TelemetryProviderFactory.createProviders()
			let telemetryService = new TelemetryService(providers, MOCK_METADATA)

			telemetryService.captureTaskCreated("task-switch-1", "anthropic")
			console.log("Captured event with available providers")

			await Promise.all(providers.map((p) => p.dispose()))

			// Switch to No-Op provider
			const noOpProvider = new NoOpTelemetryProvider()
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

	describe("CLI Subagents Telemetry", () => {
		it("should capture subagent toggle events correctly", async () => {
			const noOpProvider = new NoOpTelemetryProvider()
			const logSpy = sinon.spy(noOpProvider, "log")
			const telemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

			// Reset spy to ignore constructor events
			logSpy.resetHistory()

			// Test enabling subagents
			telemetryService.captureSubagentToggle(true)

			assert.ok(logSpy.calledOnce, "Log should be called once for enable")
			const [eventName1, properties1] = logSpy.firstCall.args
			assert.ok(properties1, "Properties should be defined")
			assert.strictEqual(eventName1, "task.subagent_enabled", "Event should be subagent_enabled when enabled")
			assert.strictEqual(properties1.enabled, true, "Properties should include enabled: true")
			assert.ok(properties1.timestamp, "Properties should include timestamp")
			assert.strictEqual(typeof properties1.timestamp, "string", "Timestamp should be a string")

			// Reset spy for next test
			logSpy.resetHistory()

			// Test disabling subagents
			telemetryService.captureSubagentToggle(false)

			assert.ok(logSpy.calledOnce, "Log should be called once for disable")
			const [eventName2, properties2] = logSpy.firstCall.args
			assert.ok(properties2, "Properties should be defined")
			assert.strictEqual(eventName2, "task.subagent_disabled", "Event should be subagent_disabled when disabled")
			assert.strictEqual(properties2.enabled, false, "Properties should include enabled: false")
			assert.ok(properties2.timestamp, "Properties should include timestamp")

			logSpy.restore()
			await noOpProvider.dispose()
		})

		it("should capture subagent execution events correctly", async () => {
			const noOpProvider = new NoOpTelemetryProvider()
			const logSpy = sinon.spy(noOpProvider, "log")
			const telemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

			// Reset spy to ignore constructor events
			logSpy.resetHistory()

			// Test successful subagent execution
			telemetryService.captureSubagentExecution("task-123", 1500, 25, true)

			assert.ok(logSpy.calledOnce, "Log should be called once for successful execution")
			const [eventName1, properties1] = logSpy.firstCall.args
			assert.ok(properties1, "Properties should be defined")
			assert.strictEqual(eventName1, "task.subagent_completed", "Event should be subagent_completed when successful")
			assert.strictEqual(properties1.ulid, "task-123", "Properties should include task ULID")
			assert.strictEqual(properties1.durationMs, 1500, "Properties should include duration")
			assert.strictEqual(properties1.outputLines, 25, "Properties should include output line count")
			assert.strictEqual(properties1.success, true, "Properties should include success status")
			assert.ok(properties1.timestamp, "Properties should include timestamp")

			// Reset spy for next test
			logSpy.resetHistory()

			// Test failed subagent execution
			telemetryService.captureSubagentExecution("task-456", 3200, 150, false)

			assert.ok(logSpy.calledOnce, "Log should be called once for failed execution")
			const [eventName2, properties2] = logSpy.firstCall.args
			assert.ok(properties2, "Properties should be defined")
			assert.strictEqual(eventName2, "task.subagent_started", "Event should be subagent_started when failed")
			assert.strictEqual(properties2.ulid, "task-456", "Properties should include task ULID")
			assert.strictEqual(properties2.durationMs, 3200, "Properties should include duration")
			assert.strictEqual(properties2.outputLines, 150, "Properties should include output line count")
			assert.strictEqual(properties2.success, false, "Properties should include success status")

			logSpy.restore()
			await noOpProvider.dispose()
		})

		it("should respect subagents telemetry category settings", async () => {
			const noOpProvider = new NoOpTelemetryProvider()
			const logSpy = sinon.spy(noOpProvider, "log")
			const telemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

			// Reset spy to ignore constructor events
			logSpy.resetHistory()

			// Verify subagents category is enabled by default
			assert.strictEqual(
				telemetryService.isCategoryEnabled("subagents"),
				true,
				"Subagents category should be enabled by default",
			)

			// Test that events are captured when category is enabled
			telemetryService.captureSubagentToggle(true)
			assert.ok(logSpy.calledOnce, "Event should be captured when category is enabled")

			// Reset spy
			logSpy.resetHistory()

			// Test that events are captured for execution
			telemetryService.captureSubagentExecution("task-789", 2000, 10, true)
			assert.ok(logSpy.calledOnce, "Execution event should be captured when category is enabled")

			logSpy.restore()
			await noOpProvider.dispose()
		})
	})

	describe("Skills Telemetry", () => {
		it("should capture skill used events correctly", async () => {
			const noOpProvider = new NoOpTelemetryProvider()
			const logSpy = sinon.spy(noOpProvider, "log")
			const telemetryService = new TelemetryService([noOpProvider], MOCK_METADATA)

			logSpy.resetHistory()

			telemetryService.captureSkillUsed({
				ulid: "task-123",
				skillName: "my-skill",
				skillSource: "global",
				skillsAvailableGlobal: 2,
				skillsAvailableProject: 3,
				provider: "cline",
				modelId: "anthropic/claude-sonnet-4.5",
			})

			assert.ok(logSpy.calledOnce, "Log should be called once")
			const [eventName, properties] = logSpy.firstCall.args
			assert.strictEqual(eventName, "task.skill_used", "Event name should be task.skill_used")
			assert.ok(properties, "Properties should be defined")
			assert.strictEqual(properties.ulid, "task-123", "Properties should include task ULID")
			assert.strictEqual(properties.skillName, "my-skill", "Properties should include skillName")
			assert.strictEqual(properties.skillSource, "global", "Properties should include skillSource")
			assert.strictEqual(properties.skillsAvailableGlobal, 2, "Properties should include global skill count")
			assert.strictEqual(properties.skillsAvailableProject, 3, "Properties should include project skill count")
			assert.strictEqual(properties.provider, "cline", "Properties should include provider")
			assert.strictEqual(properties.modelId, "anthropic/claude-sonnet-4.5", "Properties should include modelId")

			logSpy.restore()
			await noOpProvider.dispose()
		})
	})
})
