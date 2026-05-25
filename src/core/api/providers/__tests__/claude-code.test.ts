import { describe, it } from "mocha"
import "should"
import { ClaudeCodeHandler } from "@core/api/providers/claude-code"
import { ClineStorageMessage } from "@/shared/messages/content"

function makeHandler(mockGen: () => AsyncGenerator<any>) {
	return new ClaudeCodeHandler({
		claudeCodePath: "/mock/path",
		apiModelId: "claude-opus-4-1-20250805",
		_runClaudeCode: mockGen as any,
	})
}

describe("ClaudeCodeHandler", () => {
	describe("token counting", () => {
		it("should correctly handle token usage from assistant messages", async () => {
			// The 'input_tokens' field represents the TOTAL number of input tokens used.
			// See https://docs.anthropic.com/en/api/messages#usage-object

			async function* mockGenerator() {
				// First yield the system init
				yield {
					type: "system",
					subtype: "init",
					apiKeySource: "api",
				}

				// Yield assistant message with usage data
				// Example: If base input is 70 tokens, cache read is 20, and cache creation is 10,
				// then input_tokens from Anthropic API will be 100 (70 + 20 + 10)
				yield {
					type: "assistant",
					message: {
						content: [
							{
								type: "text",
								text: "Test response",
							},
						],
						usage: {
							input_tokens: 100, // Total including cache (per Anthropic docs)
							output_tokens: 50,
							cache_read_input_tokens: 20, // Already included in input_tokens
							cache_creation_input_tokens: 10, // Already included in input_tokens
						},
						stop_reason: "end_turn",
					},
				}

				// Yield result with cost
				yield {
					type: "result",
					result: {},
					total_cost_usd: 0.005,
				}
			}

			const handler = makeHandler(mockGenerator)
			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const usageData: any[] = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "usage") {
					usageData.push({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						cacheWriteTokens: chunk.cacheWriteTokens,
						totalCost: chunk.totalCost,
					})
				}
			}

			// Verify token counting follows Anthropic API specification
			usageData.should.have.length(1)
			usageData[0].should.deepEqual({
				inputTokens: 100, // Total including cache tokens (per Anthropic API docs)
				outputTokens: 50,
				cacheReadTokens: 20, // Tracked separately for reporting
				cacheWriteTokens: 10, // Tracked separately for reporting
				totalCost: 0.005,
			})

			// CRITICAL ASSERTION: Verify that input_tokens is NOT inflated by re-adding cache tokens
			// The bug would have caused inputTokens to be incorrectly calculated as 130 (100 + 20 + 10)
			// The fix ensures it remains 100, as per Anthropic's specification
			usageData[0].inputTokens.should.equal(100) // Correct: matches API response
			usageData[0].inputTokens.should.not.equal(130) // Would be wrong: double-counting cache tokens
		})

		it("should handle missing usage fields with nullish coalescing", async () => {
			async function* mockGenerator() {
				yield {
					type: "assistant",
					message: {
						content: [
							{
								type: "text",
								text: "Test response",
							},
						],
						usage: {
							input_tokens: 100,
							output_tokens: 50,
							// cache fields are undefined/missing
						},
						stop_reason: "end_turn",
					},
				}

				yield {
					type: "result",
					result: {},
					total_cost_usd: 0.005,
				}
			}

			const handler = makeHandler(mockGenerator)
			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const usageData: any[] = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "usage") {
					usageData.push({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						cacheWriteTokens: chunk.cacheWriteTokens,
					})
				}
			}

			// Verify that undefined cache tokens default to 0
			usageData.should.have.length(1)
			usageData[0].should.deepEqual({
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0, // Should default to 0
				cacheWriteTokens: 0, // Should default to 0
			})
		})

		it("should handle completely missing usage object", async () => {
			async function* mockGenerator() {
				yield {
					type: "assistant",
					message: {
						content: [
							{
								type: "text",
								text: "Test response",
							},
						],
						// usage is undefined
						usage: undefined,
						stop_reason: "end_turn",
					},
				}

				// Need to yield a result chunk to trigger usage data emission
				yield {
					type: "result",
					result: {},
					total_cost_usd: 0,
				}
			}

			const handler = makeHandler(mockGenerator)
			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const usageData: any[] = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "usage") {
					usageData.push({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
						cacheReadTokens: chunk.cacheReadTokens,
						cacheWriteTokens: chunk.cacheWriteTokens,
					})
				}
			}

			// All token counts should default to 0 when usage is undefined
			usageData.should.have.length(1)
			usageData[0].should.deepEqual({
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			})
		})
	})

	describe("error handling", () => {
		it("should not crash when assistant message has empty content array", async () => {
			async function* mockGenerator() {
				yield {
					type: "assistant",
					message: {
						content: [], // empty content — triggered TypeError in older code
						usage: {
							input_tokens: 10,
							output_tokens: 0,
						},
						stop_reason: "end_turn",
					},
				}

				yield {
					type: "result",
					result: {},
					total_cost_usd: 0,
				}
			}

			const handler = makeHandler(mockGenerator)
			const chunks: any[] = []
			// Should not throw
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				chunks.push(chunk)
			}

			const usageChunk = chunks.find((c) => c.type === "usage")
			usageChunk.should.be.ok()
			usageChunk.inputTokens.should.equal(10)
		})

		it("should yield usage when result chunk has no 'result' property (CLI v2.1+ success format)", async () => {
			async function* mockGenerator() {
				yield {
					type: "assistant",
					message: {
						content: [{ type: "text", text: "Hello" }],
						usage: { input_tokens: 10, output_tokens: 5 },
						stop_reason: "end_turn",
					},
				}

				// CLI v2.1+ omits the 'result' string property on success
				yield {
					type: "result",
					subtype: "success",
					is_error: false,
					total_cost_usd: 0.001,
					duration_ms: 1000,
					duration_api_ms: 900,
					num_turns: 1,
					session_id: "test",
				}
			}

			const handler = makeHandler(mockGenerator)
			const chunks: any[] = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				chunks.push(chunk)
			}

			const usageChunk = chunks.find((c) => c.type === "usage")
			usageChunk.should.be.ok()
			usageChunk.totalCost.should.equal(0.001)
		})

		it("should not throw on error_max_turns and should yield usage (normal --max-turns 1 behaviour)", async () => {
			async function* mockGenerator() {
				yield {
					type: "assistant",
					message: {
						content: [{ type: "tool_use", id: "t1", name: "write_to_file", input: {} }],
						usage: { input_tokens: 20, output_tokens: 10 },
						stop_reason: "tool_use",
					},
				}

				yield {
					type: "result",
					subtype: "error_max_turns",
					is_error: true,
					total_cost_usd: 0.002,
					duration_ms: 2000,
					duration_api_ms: 1800,
					num_turns: 2,
					session_id: "test",
				}
			}

			const handler = makeHandler(mockGenerator)
			let thrownError: Error | undefined
			const chunks: any[] = []
			try {
				for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
					chunks.push(chunk)
				}
			} catch (err) {
				thrownError = err as Error
			}

			;(thrownError === undefined).should.be.true()
			const usageChunk = chunks.find((c) => c.type === "usage")
			usageChunk.should.be.ok()
			usageChunk.totalCost.should.equal(0.002)
		})

		it("should throw when result has is_error=true (e.g. rate limit with no assistant message)", async () => {
			async function* mockGenerator() {
				yield {
					type: "system",
					subtype: "init",
					apiKeySource: "none",
				}

				yield {
					type: "system",
					subtype: "rate_limit_event",
					message: "Rate limit hit",
					retryAfterSeconds: 30,
				}

				// No assistant message — CLI hit rate limit and gave up
				yield {
					type: "result",
					subtype: "error",
					is_error: true,
					result: "Rate limit exceeded",
					total_cost_usd: 0,
					duration_ms: 1000,
					duration_api_ms: 500,
					num_turns: 0,
					session_id: "test",
				}
			}

			const handler = makeHandler(mockGenerator)
			let thrownError: Error | undefined
			try {
				for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
					// consume
				}
			} catch (err) {
				thrownError = err as Error
			}

			thrownError!.message.should.containEql("Rate limit exceeded")
		})

		it("should ignore rate_limit_event system messages without throwing", async () => {
			async function* mockGenerator() {
				yield {
					type: "system",
					subtype: "init",
					apiKeySource: "none",
				}

				// Newer Claude Code CLI emits this during rate limiting
				yield {
					type: "system",
					subtype: "rate_limit_event",
					message: "Rate limit hit, retrying...",
					retryAfterSeconds: 30,
				}

				yield {
					type: "assistant",
					message: {
						content: [{ type: "text", text: "Response after retry" }],
						usage: { input_tokens: 20, output_tokens: 10 },
						stop_reason: "end_turn",
					},
				}

				yield {
					type: "result",
					result: {},
					total_cost_usd: 0,
				}
			}

			const handler = makeHandler(mockGenerator)
			const textChunks: string[] = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				if (chunk.type === "text") textChunks.push(chunk.text)
			}

			textChunks.should.deepEqual(["Response after retry"])
		})
	})

	describe("getModel", () => {
		it("should return the correct model when specified", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-sonnet-4-5-20250929",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-sonnet-4-5-20250929")
		})

		it("should support Opus 4.6 1m model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-opus-4-6[1m]",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-opus-4-6[1m]")
			model.info.contextWindow.should.equal(1_000_000)
		})

		it("should support Opus 4.7 model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-opus-4-7",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-opus-4-7")
			model.info.contextWindow.should.equal(200_000)
		})

		it("should support Opus 4.7 1m model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-opus-4-7[1m]",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-opus-4-7[1m]")
			model.info.contextWindow.should.equal(1_000_000)
		})

		it("should support Opus 1m alias model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "opus[1m]",
			})

			const model = handler.getModel()
			model.id.should.equal("opus[1m]")
			model.info.contextWindow.should.equal(1_000_000)
		})

		it("should support Sonnet 1m alias model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "sonnet[1m]",
			})

			const model = handler.getModel()
			model.id.should.equal("sonnet[1m]")
			model.info.contextWindow.should.equal(1_000_000)
		})

		it("should support Sonnet 4.5 1m model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-sonnet-4-5-20250929[1m]",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-sonnet-4-5-20250929[1m]")
			model.info.contextWindow.should.equal(1_000_000)
		})

		it("should support Sonnet 4.6 1m model id", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-sonnet-4-6[1m]",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-sonnet-4-6[1m]")
			model.info.contextWindow.should.equal(1_000_000)
		})

		it("should return default model when not specified", () => {
			const handler = new ClaudeCodeHandler({})

			const model = handler.getModel()
			// The default model should be set
			model.id.should.be.type("string")
			model.info.should.be.type("object")
		})
	})
})
