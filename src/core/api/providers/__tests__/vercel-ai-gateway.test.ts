import "should"
import { openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import sinon from "sinon"
import { VercelAIGatewayHandler } from "../vercel-ai-gateway"

describe("VercelAIGatewayHandler", () => {
	afterEach(() => {
		sinon.restore()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	describe("getModel", () => {
		it("should return configured model and info when both are provided", () => {
			const customModelInfo = {
				...openRouterDefaultModelInfo,
				maxTokens: 123456,
			}

			const handler = new VercelAIGatewayHandler({
				openRouterModelId: "google/gemini-3.1-pro-preview",
				openRouterModelInfo: customModelInfo,
			})

			const result = handler.getModel()
			result.id.should.equal("google/gemini-3.1-pro-preview")
			result.info.should.deepEqual(customModelInfo)
		})

		it("should preserve configured model ID when model info is missing", () => {
			const handler = new VercelAIGatewayHandler({
				openRouterModelId: "google/gemini-3.1-pro-preview",
			})

			const result = handler.getModel()
			result.id.should.equal("google/gemini-3.1-pro-preview")
			result.info.should.deepEqual(openRouterDefaultModelInfo)
		})

		it("should fall back to default model when model ID is missing", () => {
			const handler = new VercelAIGatewayHandler({})
			const result = handler.getModel()

			result.id.should.equal(openRouterDefaultModelId)
			result.info.should.deepEqual(openRouterDefaultModelInfo)
		})
	})

	describe("createMessage", () => {
		it("should handle usage-only chunks when delta is missing", async () => {
			const handler = new VercelAIGatewayHandler({
				vercelAiGatewayApiKey: "test-api-key",
			})
			const fakeClient = {
				chat: {
					completions: {
						create: sinon.stub().resolves(
							createAsyncIterable([
								{
									choices: [{}],
									usage: {
										prompt_tokens: 11,
										completion_tokens: 7,
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

			chunks.should.deepEqual([
				{
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					inputTokens: 11,
					outputTokens: 7,
					totalCost: 0,
				},
			])
		})
	})
})
