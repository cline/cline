import { describe, test, expect, vi, beforeEach } from "vitest"
import { ClaudeCodeHandler } from "../claude-code"
import { ApiHandlerOptions } from "../../../shared/api"
import { ClaudeCodeMessage } from "../../../integrations/claude-code/types"

// Mock the runClaudeCode function
vi.mock("../../../integrations/claude-code/run", () => ({
	runClaudeCode: vi.fn(),
}))

// Mock the message filter
vi.mock("../../../integrations/claude-code/message-filter", () => ({
	filterMessagesForClaudeCode: vi.fn((messages) => messages),
}))

const { runClaudeCode } = await import("../../../integrations/claude-code/run")
const { filterMessagesForClaudeCode } = await import("../../../integrations/claude-code/message-filter")
const mockRunClaudeCode = vi.mocked(runClaudeCode)
const mockFilterMessages = vi.mocked(filterMessagesForClaudeCode)

describe("ClaudeCodeHandler", () => {
	let handler: ClaudeCodeHandler

	beforeEach(() => {
		vi.clearAllMocks()
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-3-5-sonnet-20241022",
		}
		handler = new ClaudeCodeHandler(options)
	})

	test("should create handler with correct model configuration", () => {
		const model = handler.getModel()
		expect(model.id).toBe("claude-3-5-sonnet-20241022")
		expect(model.info.supportsImages).toBe(false)
		expect(model.info.supportsPromptCache).toBe(true) // Claude Code now supports prompt caching
	})

	test("should use default model when invalid model provided", () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "invalid-model",
		}
		const handlerWithInvalidModel = new ClaudeCodeHandler(options)
		const model = handlerWithInvalidModel.getModel()

		expect(model.id).toBe("claude-sonnet-4-20250514") // default model
	})

	test("should override maxTokens when claudeCodeMaxOutputTokens is provided", () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-sonnet-4-20250514",
			claudeCodeMaxOutputTokens: 8000,
		}
		const handlerWithMaxTokens = new ClaudeCodeHandler(options)
		const model = handlerWithMaxTokens.getModel()

		expect(model.id).toBe("claude-sonnet-4-20250514")
		expect(model.info.maxTokens).toBe(8000) // Should use the configured value, not the default 64000
	})

	test("should override maxTokens for default model when claudeCodeMaxOutputTokens is provided", () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "invalid-model", // Will fall back to default
			claudeCodeMaxOutputTokens: 16384,
		}
		const handlerWithMaxTokens = new ClaudeCodeHandler(options)
		const model = handlerWithMaxTokens.getModel()

		expect(model.id).toBe("claude-sonnet-4-20250514") // default model
		expect(model.info.maxTokens).toBe(16384) // Should use the configured value
	})

	test("should filter messages and call runClaudeCode", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]
		const filteredMessages = [{ role: "user" as const, content: "Hello (filtered)" }]

		mockFilterMessages.mockReturnValue(filteredMessages)

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Empty generator for basic test
		}
		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify message filtering was called
		expect(mockFilterMessages).toHaveBeenCalledWith(messages)

		// Verify runClaudeCode was called with filtered messages
		expect(mockRunClaudeCode).toHaveBeenCalledWith({
			systemPrompt,
			messages: filteredMessages,
			path: "claude",
			modelId: "claude-3-5-sonnet-20241022",
			maxOutputTokens: undefined, // No maxOutputTokens configured in this test
		})
	})

	test("should pass maxOutputTokens to runClaudeCode when configured", async () => {
		const options: ApiHandlerOptions = {
			claudeCodePath: "claude",
			apiModelId: "claude-3-5-sonnet-20241022",
			claudeCodeMaxOutputTokens: 16384,
		}
		const handlerWithMaxTokens = new ClaudeCodeHandler(options)

		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]
		const filteredMessages = [{ role: "user" as const, content: "Hello (filtered)" }]

		mockFilterMessages.mockReturnValue(filteredMessages)

		// Mock empty async generator
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Empty generator for basic test
		}
		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handlerWithMaxTokens.createMessage(systemPrompt, messages)

		// Need to start iterating to trigger the call
		const iterator = stream[Symbol.asyncIterator]()
		await iterator.next()

		// Verify runClaudeCode was called with maxOutputTokens
		expect(mockRunClaudeCode).toHaveBeenCalledWith({
			systemPrompt,
			messages: filteredMessages,
			path: "claude",
			modelId: "claude-3-5-sonnet-20241022",
			maxOutputTokens: 16384,
		})
	})

	test("should handle thinking content properly", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields thinking content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "thinking",
							thinking: "I need to think about this carefully...",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "I need to think about this carefully...",
		})
	})

	test("should handle redacted thinking content", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields redacted thinking content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "redacted_thinking",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(1)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "[Redacted thinking block]",
		})
	})

	test("should handle mixed content types", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields mixed content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "thinking",
							thinking: "Let me think about this...",
						},
						{
							type: "text",
							text: "Here's my response!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "reasoning",
			text: "Let me think about this...",
		})
		expect(results[1]).toEqual({
			type: "text",
			text: "Here's my response!",
		})
	})

	test("should handle string chunks from generator", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields string chunks
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield "This is a string chunk"
			yield "Another string chunk"
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "This is a string chunk",
		})
		expect(results[1]).toEqual({
			type: "text",
			text: "Another string chunk",
		})
	})

	test("should handle usage and cost tracking with paid usage", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator with init, assistant, and result messages
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Init message indicating paid usage
			yield {
				type: "system" as const,
				subtype: "init" as const,
				session_id: "session_123",
				tools: [],
				mcp_servers: [],
				apiKeySource: "/login managed key",
			}

			// Assistant message
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: "Hello there!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
						cache_read_input_tokens: 5,
						cache_creation_input_tokens: 3,
					},
				} as any,
				session_id: "session_123",
			}

			// Result message
			yield {
				type: "result" as const,
				subtype: "success" as const,
				total_cost_usd: 0.05,
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 800,
				num_turns: 1,
				result: "success",
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have text chunk and usage chunk
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello there!",
		})
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 3,
			totalCost: 0.05, // Paid usage, so cost is included
		})
	})

	test("should handle usage tracking with subscription (free) usage", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator with subscription usage
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			// Init message indicating subscription usage
			yield {
				type: "system" as const,
				subtype: "init" as const,
				session_id: "session_123",
				tools: [],
				mcp_servers: [],
				apiKeySource: "none", // Subscription usage
			}

			// Assistant message
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: "Hello there!",
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}

			// Result message
			yield {
				type: "result" as const,
				subtype: "success" as const,
				total_cost_usd: 0.05,
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 800,
				num_turns: 1,
				result: "success",
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should have text chunk and usage chunk
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({
			type: "text",
			text: "Hello there!",
		})
		expect(results[1]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0, // Subscription usage, so cost is 0
		})
	})

	test("should handle API errors properly", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]

		// Mock async generator that yields an API error
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "text",
							text: 'API Error: 400 {"error":{"message":"Invalid model name"}}',
						},
					],
					stop_reason: "stop_sequence",
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const iterator = stream[Symbol.asyncIterator]()

		// Should throw an error
		await expect(iterator.next()).rejects.toThrow()
	})

	test("should log warning for unsupported tool_use content", async () => {
		const systemPrompt = "You are a helpful assistant"
		const messages = [{ role: "user" as const, content: "Hello" }]
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Mock async generator that yields tool_use content
		const mockGenerator = async function* (): AsyncGenerator<ClaudeCodeMessage | string> {
			yield {
				type: "assistant" as const,
				message: {
					id: "msg_123",
					type: "message",
					role: "assistant",
					model: "claude-3-5-sonnet-20241022",
					content: [
						{
							type: "tool_use",
							id: "tool_123",
							name: "test_tool",
							input: { test: "data" },
						},
					],
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 10,
						output_tokens: 20,
					},
				} as any,
				session_id: "session_123",
			}
		}

		mockRunClaudeCode.mockReturnValue(mockGenerator())

		const stream = handler.createMessage(systemPrompt, messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		// Should log error for unsupported tool_use
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("tool_use is not supported yet"))

		consoleSpy.mockRestore()
	})
})
