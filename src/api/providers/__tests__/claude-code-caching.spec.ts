import { describe, it, expect, vi, beforeEach } from "vitest"
import { ClaudeCodeHandler } from "../claude-code"
import { runClaudeCode } from "../../../integrations/claude-code/run"
import type { ApiHandlerOptions } from "../../../shared/api"
import type { ClaudeCodeMessage } from "../../../integrations/claude-code/types"
import type { ApiStreamUsageChunk } from "../../transform/stream"
import type { Anthropic } from "@anthropic-ai/sdk"

// Mock the runClaudeCode function
vi.mock("../../../integrations/claude-code/run", () => ({
	runClaudeCode: vi.fn(),
}))

describe("ClaudeCodeHandler - Caching Support", () => {
	let handler: ClaudeCodeHandler
	const mockOptions: ApiHandlerOptions = {
		apiKey: "test-key",
		apiModelId: "claude-3-5-sonnet-20241022",
		claudeCodePath: "/test/path",
	}

	beforeEach(() => {
		handler = new ClaudeCodeHandler(mockOptions)
		vi.clearAllMocks()
	})

	it("should collect cache read tokens from API response", async () => {
		const mockStream = async function* (): AsyncGenerator<string | ClaudeCodeMessage> {
			// Initial system message
			yield {
				type: "system",
				subtype: "init",
				session_id: "test-session",
				tools: [],
				mcp_servers: [],
				apiKeySource: "user",
			} as ClaudeCodeMessage

			// Assistant message with cache tokens
			const message: Anthropic.Messages.Message = {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [{ type: "text", text: "Hello!", citations: [] }],
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 80, // 80 tokens read from cache
					cache_creation_input_tokens: 20, // 20 new tokens cached
				},
				stop_reason: "end_turn",
				stop_sequence: null,
			}

			yield {
				type: "assistant",
				message,
				session_id: "test-session",
			} as ClaudeCodeMessage

			// Result with cost
			yield {
				type: "result",
				subtype: "success",
				result: "success",
				total_cost_usd: 0.001,
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 900,
				num_turns: 1,
				session_id: "test-session",
			} as ClaudeCodeMessage
		}

		vi.mocked(runClaudeCode).mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		// Find the usage chunk
		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.inputTokens).toBe(100)
		expect(usageChunk!.outputTokens).toBe(50)
		expect(usageChunk!.cacheReadTokens).toBe(80)
		expect(usageChunk!.cacheWriteTokens).toBe(20)
	})

	it("should accumulate cache tokens across multiple messages", async () => {
		const mockStream = async function* (): AsyncGenerator<string | ClaudeCodeMessage> {
			yield {
				type: "system",
				subtype: "init",
				session_id: "test-session",
				tools: [],
				mcp_servers: [],
				apiKeySource: "user",
			} as ClaudeCodeMessage

			// First message chunk
			const message1: Anthropic.Messages.Message = {
				id: "msg_1",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [{ type: "text", text: "Part 1", citations: [] }],
				usage: {
					input_tokens: 50,
					output_tokens: 25,
					cache_read_input_tokens: 40,
					cache_creation_input_tokens: 10,
				},
				stop_reason: null,
				stop_sequence: null,
			}

			yield {
				type: "assistant",
				message: message1,
				session_id: "test-session",
			} as ClaudeCodeMessage

			// Second message chunk
			const message2: Anthropic.Messages.Message = {
				id: "msg_2",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [{ type: "text", text: "Part 2", citations: [] }],
				usage: {
					input_tokens: 50,
					output_tokens: 25,
					cache_read_input_tokens: 30,
					cache_creation_input_tokens: 20,
				},
				stop_reason: "end_turn",
				stop_sequence: null,
			}

			yield {
				type: "assistant",
				message: message2,
				session_id: "test-session",
			} as ClaudeCodeMessage

			yield {
				type: "result",
				subtype: "success",
				result: "success",
				total_cost_usd: 0.002,
				is_error: false,
				duration_ms: 2000,
				duration_api_ms: 1800,
				num_turns: 1,
				session_id: "test-session",
			} as ClaudeCodeMessage
		}

		vi.mocked(runClaudeCode).mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.inputTokens).toBe(100) // 50 + 50
		expect(usageChunk!.outputTokens).toBe(50) // 25 + 25
		expect(usageChunk!.cacheReadTokens).toBe(70) // 40 + 30
		expect(usageChunk!.cacheWriteTokens).toBe(30) // 10 + 20
	})

	it("should handle missing cache token fields gracefully", async () => {
		const mockStream = async function* (): AsyncGenerator<string | ClaudeCodeMessage> {
			yield {
				type: "system",
				subtype: "init",
				session_id: "test-session",
				tools: [],
				mcp_servers: [],
				apiKeySource: "user",
			} as ClaudeCodeMessage

			// Message without cache tokens
			const message: Anthropic.Messages.Message = {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [{ type: "text", text: "Hello!", citations: [] }],
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: null,
					cache_creation_input_tokens: null,
				},
				stop_reason: "end_turn",
				stop_sequence: null,
			}

			yield {
				type: "assistant",
				message,
				session_id: "test-session",
			} as ClaudeCodeMessage

			yield {
				type: "result",
				subtype: "success",
				result: "success",
				total_cost_usd: 0.001,
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 900,
				num_turns: 1,
				session_id: "test-session",
			} as ClaudeCodeMessage
		}

		vi.mocked(runClaudeCode).mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.inputTokens).toBe(100)
		expect(usageChunk!.outputTokens).toBe(50)
		expect(usageChunk!.cacheReadTokens).toBe(0)
		expect(usageChunk!.cacheWriteTokens).toBe(0)
	})

	it("should report zero cost for subscription usage", async () => {
		const mockStream = async function* (): AsyncGenerator<string | ClaudeCodeMessage> {
			// Subscription usage has apiKeySource: "none"
			yield {
				type: "system",
				subtype: "init",
				session_id: "test-session",
				tools: [],
				mcp_servers: [],
				apiKeySource: "none",
			} as ClaudeCodeMessage

			const message: Anthropic.Messages.Message = {
				id: "msg_123",
				type: "message",
				role: "assistant",
				model: "claude-3-5-sonnet-20241022",
				content: [{ type: "text", text: "Hello!", citations: [] }],
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cache_read_input_tokens: 80,
					cache_creation_input_tokens: 20,
				},
				stop_reason: "end_turn",
				stop_sequence: null,
			}

			yield {
				type: "assistant",
				message,
				session_id: "test-session",
			} as ClaudeCodeMessage

			yield {
				type: "result",
				subtype: "success",
				result: "success",
				total_cost_usd: 0.001, // This should be ignored for subscription usage
				is_error: false,
				duration_ms: 1000,
				duration_api_ms: 900,
				num_turns: 1,
				session_id: "test-session",
			} as ClaudeCodeMessage
		}

		vi.mocked(runClaudeCode).mockReturnValue(mockStream())

		const stream = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])

		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const usageChunk = chunks.find((c) => c.type === "usage" && "totalCost" in c) as ApiStreamUsageChunk | undefined
		expect(usageChunk).toBeDefined()
		expect(usageChunk!.totalCost).toBe(0) // Should be 0 for subscription usage
	})
})
