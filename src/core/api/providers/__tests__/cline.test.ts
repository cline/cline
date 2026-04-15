import "should"
import { openRouterDefaultModelInfo } from "@shared/api"
import axios from "axios"
import sinon from "sinon"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { ClineHandler } from "../cline"

describe("ClineHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const createHandler = (options: ConstructorParameters<typeof ClineHandler>[0]) => {
		sinon.stub(ClineAccountService, "getInstance").returns({} as any)
		sinon.stub(AuthService, "getInstance").returns({} as any)
		return new ClineHandler(options)
	}

	it("should handle usage-only chunks when delta is missing", async () => {
		const handler = createHandler({})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 17,
									completion_tokens: 9,
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").resolves(fakeClient as any)
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
				inputTokens: 17,
				outputTokens: 9,
				totalCost: 0,
			},
		])
	})

	it("should read cache write tokens from cache_creation_input_tokens", async () => {
		const handler = createHandler({})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 200,
									completion_tokens: 11,
									cache_creation_input_tokens: 40,
									prompt_tokens_details: {
										cached_tokens: 150,
									},
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").resolves(fakeClient as any)
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
				cacheWriteTokens: 40,
				cacheReadTokens: 150,
				inputTokens: 10,
				outputTokens: 11,
				totalCost: 0,
			},
		])
	})

	it("should forward enableParallelToolCalling to OpenRouter payload", async () => {
		const handler = createHandler({ enableParallelToolCalling: true })
		const createStub = sinon.stub().resolves(createAsyncIterable([]))
		const fakeClient = {
			chat: {
				completions: {
					create: createStub,
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").resolves(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "openai/gpt-4o-mini",
			info: openRouterDefaultModelInfo,
		})

		const tools = [
			{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } },
		] as any
		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			// drain stream
		}

		const payload = createStub.firstCall.args[0]
		payload.parallel_tool_calls.should.equal(true)
	})

	it("should subtract cache read and cache write tokens in generation fallback", async () => {
		const handler = createHandler({})
		handler.lastGenerationId = "gen-123"

		;(handler as any)._authService = { getAuthToken: async () => "test-token" }
		;(handler as any).clineAccountService = { baseUrl: "https://api.cline.bot" }

		sinon.stub(handler, "getModel").returns({
			id: "anthropic/claude-sonnet-4.6",
			info: openRouterDefaultModelInfo,
		})

		sinon.stub(axios, "get").resolves({
			data: {
				native_tokens_prompt: 1000,
				native_tokens_cached: 500,
				native_tokens_cache_write: 300,
				native_tokens_completion: 200,
				total_cost: 1.23,
			},
		} as any)

		const usage = await handler.getApiStreamUsage(new Set())

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
})
