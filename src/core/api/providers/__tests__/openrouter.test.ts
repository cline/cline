import "should"
import { openRouterDefaultModelInfo } from "@shared/api"
import sinon from "sinon"
import { OpenRouterHandler } from "../openrouter"

describe("OpenRouterHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const tools = [{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } }] as any

	it("should handle usage-only chunks when delta is missing", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 13,
									completion_tokens: 5,
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "openai/gpt-4o-mini",
			info: openRouterDefaultModelInfo,
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				inputTokens: 13,
				outputTokens: 5,
				totalCost: 0,
			},
		])
	})

	it("should read cache_write_tokens from prompt_tokens_details", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 1000,
									completion_tokens: 200,
									prompt_tokens_details: {
										cached_tokens: 500,
										cache_write_tokens: 300,
									},
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "anthropic/claude-sonnet-4.6",
			info: openRouterDefaultModelInfo,
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 300,
				cacheReadTokens: 500,
				inputTokens: 200,
				outputTokens: 200,
				totalCost: 0,
			},
		])
	})

	it("should fall back to cache_creation_input_tokens when cache_write_tokens is missing", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 1000,
									completion_tokens: 200,
									cache_creation_input_tokens: 300,
									prompt_tokens_details: {
										cached_tokens: 500,
									},
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "anthropic/claude-sonnet-4.6",
			info: openRouterDefaultModelInfo,
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 300,
				cacheReadTokens: 500,
				inputTokens: 200,
				outputTokens: 200,
				totalCost: 0,
			},
		])
	})

	it("should subtract cache read and cache write tokens in generation fallback", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
		})
		handler.lastGenerationId = "gen-123"

		sinon.stub(handler, "fetchGenerationDetails").returns(
			(async function* () {
				yield {
					native_tokens_prompt: 1000,
					native_tokens_cached: 500,
					native_tokens_cache_write: 300,
					native_tokens_completion: 200,
					total_cost: 1.23,
				}
			})() as any,
		)

		const usage = await handler.getApiStreamUsage()

		should.exist(usage)
		usage!.should.deepEqual({
			type: "usage",
			cacheWriteTokens: 300,
			cacheReadTokens: 500,
			inputTokens: 200,
			outputTokens: 200,
			totalCost: 1.23,
		})
	})

	type ParallelToolCallsTestCase = {
		modelId: string
		enableParallelToolCalling: boolean
		expectedParallelToolCalls: boolean
	}

	const parallelToolCallsTestCases: ParallelToolCallsTestCase[] = [
		{
			modelId: "openai/gpt-4o-mini",
			enableParallelToolCalling: true,
			expectedParallelToolCalls: true,
		},
		{
			modelId: "openai/gpt-4o-mini",
			enableParallelToolCalling: false,
			expectedParallelToolCalls: false,
		},
		{
			modelId: "google/gemini-3-flash-preview",
			enableParallelToolCalling: true,
			expectedParallelToolCalls: true,
		},
	]

	for (const testCase of parallelToolCallsTestCases) {
		const settingLabel = testCase.enableParallelToolCalling ? "enabled" : "disabled"
		it(`should set parallel_tool_calls=${testCase.expectedParallelToolCalls} for ${testCase.modelId} when setting is ${settingLabel}`, async () => {
			const handler = new OpenRouterHandler({
				openRouterApiKey: "test-api-key",
				enableParallelToolCalling: testCase.enableParallelToolCalling,
			})
			const createStub = sinon.stub().resolves(createAsyncIterable([]))
			const fakeClient = {
				chat: {
					completions: {
						create: createStub,
					},
				},
			}
			sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
			sinon.stub(handler, "getModel").returns({
				id: testCase.modelId,
				info: openRouterDefaultModelInfo,
			})

			for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
				// drain stream
			}

			const payload = createStub.firstCall.args[0]
			payload.parallel_tool_calls.should.equal(testCase.expectedParallelToolCalls)
		})
	}
})
