import { ProviderSettings, ClineMessage } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { MessageEnhancer } from "../messageEnhancer"
import * as singleCompletionHandlerModule from "../../../utils/single-completion-handler"
import { ProviderSettingsManager } from "../../config/ProviderSettingsManager"

// Mock dependencies
vi.mock("../../../utils/single-completion-handler")
vi.mock("@roo-code/telemetry")

describe("MessageEnhancer", () => {
	let mockProviderSettingsManager: ProviderSettingsManager
	let mockSingleCompletionHandler: ReturnType<typeof vi.fn>

	const mockApiConfiguration: ProviderSettings = {
		apiProvider: "openai",
		apiKey: "test-key",
		apiModelId: "gpt-4",
	}

	const mockListApiConfigMeta = [
		{ id: "config1", name: "Config 1" },
		{ id: "config2", name: "Config 2" },
	]

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Mock provider settings manager
		mockProviderSettingsManager = {
			getProfile: vi.fn().mockResolvedValue({
				name: "Enhancement Config",
				apiProvider: "anthropic",
				apiKey: "enhancement-key",
				apiModelId: "claude-3",
			}),
		} as any

		// Mock single completion handler
		mockSingleCompletionHandler = vi.fn().mockResolvedValue("Enhanced prompt text")
		vi.mocked(singleCompletionHandlerModule).singleCompletionHandler = mockSingleCompletionHandler

		// Mock TelemetryService
		vi.mocked(TelemetryService).hasInstance = vi.fn().mockReturnValue(true)
		// Mock the instance getter
		Object.defineProperty(TelemetryService, "instance", {
			get: vi.fn().mockReturnValue({
				capturePromptEnhanced: vi.fn(),
			}),
			configurable: true,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("enhanceMessage", () => {
		it("should enhance a simple message successfully", async () => {
			const result = await MessageEnhancer.enhanceMessage({
				text: "Write a function to calculate fibonacci",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				providerSettingsManager: mockProviderSettingsManager,
			})

			expect(result.success).toBe(true)
			expect(result.enhancedText).toBe("Enhanced prompt text")
			expect(result.error).toBeUndefined()

			// Verify single completion handler was called with correct prompt
			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(
				mockApiConfiguration,
				expect.stringContaining("Write a function to calculate fibonacci"),
			)
		})

		it("should use enhancement API config when provided", async () => {
			const result = await MessageEnhancer.enhanceMessage({
				text: "Test prompt",
				apiConfiguration: mockApiConfiguration,
				customSupportPrompts: {},
				listApiConfigMeta: mockListApiConfigMeta,
				enhancementApiConfigId: "config2",
				providerSettingsManager: mockProviderSettingsManager,
			})

			expect(result.success).toBe(true)
			expect(mockProviderSettingsManager.getProfile).toHaveBeenCalledWith({ id: "config2" })

			// Verify the enhancement config was used instead of default
			const expectedConfig = {
				apiProvider: "anthropic",
				apiKey: "enhancement-key",
				apiModelId: "claude-3",
			}
			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(expectedConfig, expect.any(String))
		})

		it("should include task history when enabled", async () => {
			const mockClineMessages: ClineMessage[] = [
				{ type: "ask", text: "Create a React component", ts: 1000 },
				{ type: "say", say: "text", text: "I'll create a React component for you", ts: 2000 },
				{ type: "ask", text: "Add props to the component", ts: 3000 },
				{ type: "say", say: "reasoning", text: "Using tool", ts: 4000 }, // Should be filtered out
			]

			const result = await MessageEnhancer.enhanceMessage({
				text: "Improve the component",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				includeTaskHistoryInEnhance: true,
				currentClineMessages: mockClineMessages,
				providerSettingsManager: mockProviderSettingsManager,
			})

			expect(result.success).toBe(true)

			// Verify the prompt includes task history
			const calledPrompt = mockSingleCompletionHandler.mock.calls[0][1]
			expect(calledPrompt).toContain("Improve the component")
			expect(calledPrompt).toContain("previous conversation context")
			expect(calledPrompt).toContain("User: Create a React component")
			expect(calledPrompt).toContain("Assistant: I'll create a React component for you")
			expect(calledPrompt).toContain("User: Add props to the component")
			expect(calledPrompt).not.toContain("Using tool") // reasoning messages should be filtered
		})

		it("should limit task history to last 10 messages", async () => {
			// Create 15 messages
			const mockClineMessages: ClineMessage[] = Array.from({ length: 15 }, (_, i) => ({
				type: i % 2 === 0 ? "ask" : "say",
				say: i % 2 === 1 ? "text" : undefined,
				text: `Message ${i + 1}`,
				ts: i * 1000,
			})) as ClineMessage[]

			await MessageEnhancer.enhanceMessage({
				text: "Test",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				includeTaskHistoryInEnhance: true,
				currentClineMessages: mockClineMessages,
				providerSettingsManager: mockProviderSettingsManager,
			})

			const calledPrompt = mockSingleCompletionHandler.mock.calls[0][1]

			// Should include messages 6-15 (last 10)
			expect(calledPrompt).toContain("Message 6")
			expect(calledPrompt).toContain("Message 15")
			expect(calledPrompt).not.toContain("Message 5")
		})

		it("should truncate long messages in task history", async () => {
			const longText = "A".repeat(600) // 600 characters
			const mockClineMessages: ClineMessage[] = [{ type: "ask", text: longText, ts: 1000 }]

			await MessageEnhancer.enhanceMessage({
				text: "Test",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				includeTaskHistoryInEnhance: true,
				currentClineMessages: mockClineMessages,
				providerSettingsManager: mockProviderSettingsManager,
			})

			const calledPrompt = mockSingleCompletionHandler.mock.calls[0][1]

			// Should truncate to 500 chars + "..."
			expect(calledPrompt).toContain("A".repeat(500) + "...")
			expect(calledPrompt).not.toContain("A".repeat(501))
		})

		it("should use custom support prompts when provided", async () => {
			const customSupportPrompts = {
				ENHANCE: "Custom enhancement template: ${userInput}",
			}

			await MessageEnhancer.enhanceMessage({
				text: "Test prompt",
				apiConfiguration: mockApiConfiguration,
				customSupportPrompts,
				listApiConfigMeta: mockListApiConfigMeta,
				providerSettingsManager: mockProviderSettingsManager,
			})

			const calledPrompt = mockSingleCompletionHandler.mock.calls[0][1]
			expect(calledPrompt).toBe("Custom enhancement template: Test prompt")
		})

		it("should handle errors gracefully", async () => {
			mockSingleCompletionHandler.mockRejectedValue(new Error("API error"))

			const result = await MessageEnhancer.enhanceMessage({
				text: "Test",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				providerSettingsManager: mockProviderSettingsManager,
			})

			expect(result.success).toBe(false)
			expect(result.error).toBe("API error")
			expect(result.enhancedText).toBeUndefined()
		})

		it("should handle non-Error exceptions", async () => {
			mockSingleCompletionHandler.mockRejectedValue("String error")

			const result = await MessageEnhancer.enhanceMessage({
				text: "Test",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				providerSettingsManager: mockProviderSettingsManager,
			})

			expect(result.success).toBe(false)
			expect(result.error).toBe("String error")
		})

		it("should fall back to default config if enhancement config is invalid", async () => {
			mockProviderSettingsManager.getProfile = vi.fn().mockResolvedValue({
				name: "Invalid Config",
				// Missing apiProvider
			})

			await MessageEnhancer.enhanceMessage({
				text: "Test",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				enhancementApiConfigId: "config2",
				providerSettingsManager: mockProviderSettingsManager,
			})

			// Should use the default config
			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(mockApiConfiguration, expect.any(String))
		})

		it("should handle empty task history gracefully", async () => {
			const result = await MessageEnhancer.enhanceMessage({
				text: "Test",
				apiConfiguration: mockApiConfiguration,
				listApiConfigMeta: mockListApiConfigMeta,
				includeTaskHistoryInEnhance: true,
				currentClineMessages: [],
				providerSettingsManager: mockProviderSettingsManager,
			})

			expect(result.success).toBe(true)

			const calledPrompt = mockSingleCompletionHandler.mock.calls[0][1]
			// Should not include task history section
			expect(calledPrompt).not.toContain("previous conversation context")
		})
	})

	describe("captureTelemetry", () => {
		it("should capture telemetry when TelemetryService is available", () => {
			const mockTaskId = "task-123"
			const mockCaptureEvent = vi.fn()
			vi.mocked(TelemetryService.instance).captureEvent = mockCaptureEvent

			MessageEnhancer.captureTelemetry(mockTaskId, true)

			expect(TelemetryService.hasInstance).toHaveBeenCalled()
			expect(mockCaptureEvent).toHaveBeenCalledWith(expect.any(String), {
				taskId: mockTaskId,
				includeTaskHistory: true,
			})
		})

		it("should handle missing TelemetryService gracefully", () => {
			vi.mocked(TelemetryService).hasInstance = vi.fn().mockReturnValue(false)

			// Should not throw
			expect(() => MessageEnhancer.captureTelemetry("task-123", true)).not.toThrow()
		})

		it("should work without task ID", () => {
			const mockCaptureEvent = vi.fn()
			vi.mocked(TelemetryService.instance).captureEvent = mockCaptureEvent

			MessageEnhancer.captureTelemetry(undefined, false)

			expect(mockCaptureEvent).toHaveBeenCalledWith(expect.any(String), {
				includeTaskHistory: false,
			})
		})

		it("should default includeTaskHistory to false when not provided", () => {
			const mockCaptureEvent = vi.fn()
			vi.mocked(TelemetryService.instance).captureEvent = mockCaptureEvent

			MessageEnhancer.captureTelemetry("task-123")

			expect(mockCaptureEvent).toHaveBeenCalledWith(expect.any(String), {
				taskId: "task-123",
				includeTaskHistory: false,
			})
		})
	})

	describe("extractTaskHistory", () => {
		it("should filter and format messages correctly", () => {
			const messages: ClineMessage[] = [
				{ type: "ask", text: "User message 1", ts: 1000 },
				{ type: "say", say: "text", text: "Assistant message 1", ts: 2000 },
				{ type: "say", say: "reasoning", text: "Tool use", ts: 3000 },
				{ type: "ask", text: "", ts: 4000 }, // Empty text
				{ type: "say", say: "text", text: undefined, ts: 5000 }, // No text
				{ type: "ask", text: "User message 2", ts: 6000 },
			]

			// Access private method through any type assertion for testing
			const history = (MessageEnhancer as any).extractTaskHistory(messages)

			expect(history).toContain("User: User message 1")
			expect(history).toContain("Assistant: Assistant message 1")
			expect(history).toContain("User: User message 2")
			expect(history).not.toContain("Tool use")
			expect(history.split("\n").length).toBe(3) // Only 3 valid messages
		})

		it("should handle malformed messages gracefully", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Create messages that will cause errors when accessed
			const malformedMessages = [
				null,
				undefined,
				{ type: "ask" }, // Missing required properties
				"not an object",
			] as any

			// Access private method through any type assertion for testing
			const history = (MessageEnhancer as any).extractTaskHistory(malformedMessages)

			// Should return empty string and log error
			expect(history).toBe("")
			expect(consoleSpy).toHaveBeenCalledWith("Failed to extract task history:", expect.any(Error))

			consoleSpy.mockRestore()
		})

		it("should handle messages with circular references", () => {
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Create a message with circular reference
			const circularMessage: any = { type: "ask", text: "Test" }
			circularMessage.self = circularMessage

			const messages = [circularMessage] as ClineMessage[]

			// Access private method through any type assertion for testing
			const history = (MessageEnhancer as any).extractTaskHistory(messages)

			// Should handle gracefully
			expect(history).toBe("User: Test")

			consoleSpy.mockRestore()
		})
	})
})
