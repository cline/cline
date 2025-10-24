import { Anthropic } from "@anthropic-ai/sdk"
import { afterEach, beforeEach, describe, it } from "mocha"
import sinon from "sinon"
import "should"
import { ClaudeCodeHandler } from "@core/api/providers/claude-code"

describe("ClaudeCodeHandler", () => {
	let handler: ClaudeCodeHandler
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
		handler = new ClaudeCodeHandler({
			claudeCodePath: "/mock/path",
			apiModelId: "claude-opus-4-1-20250805",
		})
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("token counting", () => {
		it("should correctly handle token usage from assistant messages", async () => {
			// The 'input_tokens' field represents the TOTAL number of input tokens used.
			// See https://docs.anthropic.com/en/api/messages#usage-object

			// Mock the runClaudeCode function
			const runClaudeCodeModule = await import("@/integrations/claude-code/run")
			const runClaudeCodeStub = sandbox.stub(runClaudeCodeModule, "runClaudeCode")

			// Create a proper async generator mock for the Claude Code response
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

			runClaudeCodeStub.returns(mockGenerator() as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

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
			// Mock the runClaudeCode function
			const runClaudeCodeModule = await import("@/integrations/claude-code/run")
			const runClaudeCodeStub = sandbox.stub(runClaudeCodeModule, "runClaudeCode")

			// Create a proper async generator mock with missing/undefined usage fields
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

			runClaudeCodeStub.returns(mockGenerator() as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

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
			// Mock the runClaudeCode function
			const runClaudeCodeModule = await import("@/integrations/claude-code/run")
			const runClaudeCodeStub = sandbox.stub(runClaudeCodeModule, "runClaudeCode")

			// Create a proper async generator mock with missing usage object
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

			runClaudeCodeStub.returns(mockGenerator() as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

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

	describe("getModel", () => {
		it("should return the correct model when specified", () => {
			const handler = new ClaudeCodeHandler({
				apiModelId: "claude-sonnet-4-5-20250929",
			})

			const model = handler.getModel()
			model.id.should.equal("claude-sonnet-4-5-20250929")
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
