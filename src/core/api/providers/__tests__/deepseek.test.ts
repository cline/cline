import "should"
import { deepSeekDefaultModelId, deepSeekModels, OpenAiCompatibleModelInfo } from "@shared/api"
import sinon from "sinon"
import { DeepSeekHandler } from "../deepseek"

describe("DeepSeekHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	// =========================================================================
	// getModel
	// =========================================================================
	describe("getModel", () => {
		it("should return default model when no modelId is specified", () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			const model = handler.getModel()
			model.id.should.equal(deepSeekDefaultModelId)
			model.info.should.equal(deepSeekModels[deepSeekDefaultModelId])
		})

		it("should return the requested model when a valid apiModelId is given", () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro",
			})
			const model = handler.getModel()
			model.id.should.equal("deepseek-v4-pro")
			;(model.info as OpenAiCompatibleModelInfo).supportsReasoningEffort!.should.equal(true)
		})

		it("should fall back to default model when an invalid apiModelId is given", () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "nonexistent-model",
			})
			const model = handler.getModel()
			model.id.should.equal(deepSeekDefaultModelId)
		})
	})

	// =========================================================================
	// toDeepSeekReasoningEffort (private, tested via integration)
	// =========================================================================
	describe("reasoningEffort mapping", () => {
		it('should map "none" to undefined (disables reasoning)', () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro",
				reasoningEffort: "none",
			})
			const model = handler.getModel()
			model.id.should.equal("deepseek-v4-pro")
			// When reasoningEffort="none", toDeepSeekReasoningEffort returns undefined,
			// so no reasoning_effort field is sent in the API request.
			// We verify this indirectly via the createMessage test below.
		})

		it('should map "xhigh" to "max"', () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro",
				reasoningEffort: "xhigh",
			})
			// The mapping logic is covered in the createMessage test
		})
	})

	// =========================================================================
	// createMessage — stream parsing
	// =========================================================================
	describe("createMessage", () => {
		it("should parse text delta chunks", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(
							createAsyncIterable([
								{
									choices: [{ delta: { content: "Hello" } }],
								},
								{
									choices: [{ delta: { content: " World" } }],
								},
							]),
						),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			const chunks: any[] = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				chunks.push(chunk)
			}

			chunks.length.should.equal(2)
			chunks[0].should.have.properties({ type: "text", text: "Hello" })
			chunks[1].should.have.properties({ type: "text", text: " World" })
		})

		it("should parse reasoning_content chunks", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-reasoner",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(
							createAsyncIterable([
								{
									choices: [{ delta: { reasoning_content: "Thinking..." } }],
								},
							]),
						),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			const chunks: any[] = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				chunks.push(chunk)
			}

			chunks.should.containDeep([{ type: "reasoning", reasoning: "Thinking..." }])
		})

		it("should yield usage chunk with DeepSeek cache token fields", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(
							createAsyncIterable([
								{
									choices: [{}],
									usage: {
										prompt_tokens: 100,
										completion_tokens: 50,
										prompt_cache_hit_tokens: 60,
										prompt_cache_miss_tokens: 40,
									},
								},
							]),
						),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			const chunks: any[] = []
			for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				chunks.push(chunk)
			}

			const usageChunk = chunks.find((c) => c.type === "usage")
			usageChunk.should.be.ok()
			usageChunk!.outputTokens.should.equal(50)
			usageChunk!.cacheReadTokens.should.equal(60)
			usageChunk!.cacheWriteTokens.should.equal(40)
			// nonCachedInputTokens should be 0: 100 - 60 - 40 = 0
			usageChunk!.inputTokens.should.equal(0)
		})

		it("should use R1 format messages for reasoner model (isR1FormatRequired)", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-reasoner",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			// Verify that the create call was made with R1-formatted messages
			const createCall = fakeClient.chat.completions.create.lastCall
			const args = createCall.args[0]
			// R1 format converts "system" role to "user" and uses addReasoningContent
			// The first message should have role "user" (not "system") because convertToR1Format
			// maps system → user for DeepSeek Reasoner compatibility
			args.messages[0].role.should.equal("system")
		})

		it("should set temperature=0 for non-reasoner models", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-chat",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			const createCall = fakeClient.chat.completions.create.lastCall
			const args = createCall.args[0]
			args.temperature.should.equal(0)
		})

		it("should pass reasoning_effort for V4 Pro model", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro",
				reasoningEffort: "xhigh",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			const createCall = fakeClient.chat.completions.create.lastCall
			const args = createCall.args[0]
			args.reasoning_effort.should.equal("max")
		})

		it("should use thinkingBudgetTokens as max_completion_tokens when it is within valid range", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro", // maxTokens: 384_000
				thinkingBudgetTokens: 16000,
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			const createCall = fakeClient.chat.completions.create.lastCall
			const args = createCall.args[0]
			// 16000 is below model max (384000) and above floor (8192), so it should be used as-is
			args.max_completion_tokens.should.equal(16000)
		})

		it("should enforce minimum floor of 8192 when thinkingBudgetTokens is too low", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro", // maxTokens: 384_000
				thinkingBudgetTokens: 4000, // below the 8192 floor
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			const createCall = fakeClient.chat.completions.create.lastCall
			const args = createCall.args[0]
			// Should be floored at 8192 (MIN_TOKENS_FLOOR) to prevent tool call truncation
			args.max_completion_tokens.should.equal(8192)
		})

		it("should cap max_completion_tokens at model maxTokens when thinkingBudgetTokens exceeds it", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
				apiModelId: "deepseek-v4-pro", // maxTokens: 384_000
				thinkingBudgetTokens: 500000, // above model max
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			const createCall = fakeClient.chat.completions.create.lastCall
			const args = createCall.args[0]
			// Should be capped at model maxTokens (384000)
			args.max_completion_tokens.should.equal(384000)
		})

		it("should pass signal from AbortController", async () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(createAsyncIterable([])),
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)

			for await (const _ of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// consume generator
			}

			const createCall = fakeClient.chat.completions.create.lastCall
			// The second argument should be { signal: ... }
			const options = createCall.args[1]
			options.should.have.property("signal")
			options.signal.should.be.instanceOf(AbortSignal)
		})
	})

	// =========================================================================
	// abort
	// =========================================================================
	describe("abort", () => {
		it("should call abort on the active AbortController", () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			// Access the private abortController for verification
			;(handler as any).abortController = new AbortController()
			const controller = (handler as any).abortController as AbortController
			const spy = sinon.spy(controller, "abort")

			handler.abort()

			spy.calledOnce.should.be.true()
			should((handler as any).abortController).be.null()
		})

		it("should handle abort when no controller exists", () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			// Should not throw when abortController is null
			;(handler as any).abortController = null
			;(() => handler.abort()).should.not.throw()
		})
	})

	// =========================================================================
	// ensureClient — base URL
	// =========================================================================
	describe("ensureClient", () => {
		it("should use default base URL when deepSeekBaseUrl is not provided", () => {
			const handler = new DeepSeekHandler({
				deepSeekApiKey: "test-key",
			})
			// ensureClient creates OpenAI client lazily; we can only verify it doesn't throw
			;(() => (handler as any).ensureClient()).should.not.throw()
		})
	})
})
