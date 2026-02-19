import "should"
import { openRouterDefaultModelInfo } from "@shared/api"
import sinon from "sinon"
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

	it("should handle usage-only chunks when delta is missing", async () => {
		const handler = Object.create(ClineHandler.prototype) as ClineHandler
		;(handler as any).options = {}
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
})
