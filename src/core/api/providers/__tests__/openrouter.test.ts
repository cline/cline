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

	it("should set parallel_tool_calls for non-Gemini models when setting is enabled", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
			enableParallelToolCalling: true,
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

	it("should disable parallel_tool_calls when setting is disabled", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
			enableParallelToolCalling: false,
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
		payload.parallel_tool_calls.should.equal(false)
	})

	it("should set parallel_tool_calls for Gemini 3 models when setting is enabled", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
			enableParallelToolCalling: true,
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
			id: "google/gemini-3-flash-preview",
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
})
