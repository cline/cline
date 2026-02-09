import "should"
import { openRouterDefaultModelId, openRouterDefaultModelInfo } from "@shared/api"
import { VercelAIGatewayHandler } from "../vercel-ai-gateway"

describe("VercelAIGatewayHandler", () => {
	describe("getModel", () => {
		it("should return configured model and info when both are provided", () => {
			const customModelInfo = {
				...openRouterDefaultModelInfo,
				maxTokens: 123456,
			}

			const handler = new VercelAIGatewayHandler({
				openRouterModelId: "google/gemini-3-pro-preview",
				openRouterModelInfo: customModelInfo,
			})

			const result = handler.getModel()
			result.id.should.equal("google/gemini-3-pro-preview")
			result.info.should.deepEqual(customModelInfo)
		})

		it("should preserve configured model ID when model info is missing", () => {
			const handler = new VercelAIGatewayHandler({
				openRouterModelId: "google/gemini-3-pro-preview",
			})

			const result = handler.getModel()
			result.id.should.equal("google/gemini-3-pro-preview")
			result.info.should.deepEqual(openRouterDefaultModelInfo)
		})

		it("should fall back to default model when model ID is missing", () => {
			const handler = new VercelAIGatewayHandler({})
			const result = handler.getModel()

			result.id.should.equal(openRouterDefaultModelId)
			result.info.should.deepEqual(openRouterDefaultModelInfo)
		})
	})
})
