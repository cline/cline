import "should"
import { checkContextWindowExceededError } from "@core/context/context-management/context-error-handling"
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

	it("should preserve status on wrapped OpenRouter stream errors for context-compaction detection", async () => {
		const handler = new OpenRouterHandler({
			openRouterApiKey: "test-api-key",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: sinon.stub().resolves(
						createAsyncIterable([
							{
								error: {
									code: 400,
									message:
										"This endpoint's maximum context length is 204800 tokens. However, you requested about 244027 tokens.",
								},
							},
						]),
					),
				},
			},
		}
		sinon.stub(handler as any, "ensureClient").returns(fakeClient as any)
		sinon.stub(handler, "getModel").returns({
			id: "z-ai/glm-5",
			info: openRouterDefaultModelInfo,
		})

		let thrown: unknown
		try {
			for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
				// stream should throw before yielding any chunk
			}
		} catch (error) {
			thrown = error
		}

		should.exist(thrown)
		;(thrown as any).status.should.equal(400)
		checkContextWindowExceededError(thrown).should.equal(true)
	})
})
