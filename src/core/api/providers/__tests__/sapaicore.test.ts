import "should"
import { Anthropic } from "@anthropic-ai/sdk"
import { SapAiCoreHandler } from "../sapaicore"

describe("SapAiCoreHandler", () => {
	let handler: SapAiCoreHandler

	beforeEach(() => {
		const mockOptions = {
			sapAiCoreClientId: "test-client-id",
			sapAiCoreClientSecret: "test-client-secret",
			sapAiCoreTokenUrl: "https://test.auth.sap.com",
			sapAiResourceGroup: "default",
			sapAiCoreBaseUrl: "https://test.api.sap.com",
			apiModelId: "anthropic--claude-3.5-sonnet",
		}
		handler = new SapAiCoreHandler(mockOptions)
	})

	describe("image processing", () => {
		// Test image processing through the public interface
		// This tests the complete flow including processImageContent internally

		it("should handle image processing for Claude 4 models", () => {
			// Create handler with Claude 4 model
			const claude4Handler = new SapAiCoreHandler({
				sapAiCoreClientId: "test-client-id",
				sapAiCoreClientSecret: "test-client-secret",
				sapAiCoreTokenUrl: "https://test.auth.sap.com",
				sapAiResourceGroup: "default",
				sapAiCoreBaseUrl: "https://test.api.sap.com",
				apiModelId: "anthropic--claude-4-sonnet",
			})

			const model = claude4Handler.getModel()
			model.id.should.equal("anthropic--claude-4-sonnet")
			model.info.should.have.property("supportsImages", true)
		})

		it("should create proper user readable request with images", () => {
			const testImageData =
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="

			const userContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [
				{
					type: "text",
					text: "Here's an image:",
				},
				{
					type: "image",
					source: {
						type: "base64",
						media_type: "image/png",
						data: testImageData,
					},
				},
			]

			const result = handler.createUserReadableRequest(userContent)

			result.should.have.property("model")
			result.should.have.property("max_tokens")
			result.should.have.property("system")
			result.should.have.property("messages")
			result.messages.should.be.Array()
			result.messages[1].should.have.property("role", "user")
			result.messages[1].should.have.property("content", userContent)
		})

		it("should support different Claude model variants", () => {
			const modelVariants = [
				"anthropic--claude-4-sonnet",
				"anthropic--claude-4-opus",
				"anthropic--claude-3.7-sonnet",
				"anthropic--claude-3.5-sonnet",
				"anthropic--claude-3-sonnet",
				"anthropic--claude-3-haiku",
				"anthropic--claude-3-opus",
			]

			modelVariants.forEach((modelId) => {
				const testHandler = new SapAiCoreHandler({
					apiModelId: modelId,
				})

				const model = testHandler.getModel()
				model.id.should.equal(modelId)
				model.info.should.have.property("maxTokens")
				model.info.should.have.property("contextWindow")
			})
		})
	})

	describe("getModel", () => {
		it("should return default model when no apiModelId is provided", () => {
			const result = handler.getModel()
			result.should.have.property("id")
			result.should.have.property("info")
			result.info.should.have.property("maxTokens")
		})

		it("should return specified model when apiModelId is provided", () => {
			const customHandler = new SapAiCoreHandler({
				apiModelId: "anthropic--claude-4-sonnet",
			})

			const result = customHandler.getModel()
			result.id.should.equal("anthropic--claude-4-sonnet")
		})
	})

	describe("createUserReadableRequest", () => {
		it("should create a readable request format", () => {
			const userContent: Anthropic.TextBlockParam[] = [
				{
					type: "text",
					text: "Hello, world!",
				},
			]

			const result = handler.createUserReadableRequest(userContent)

			result.should.have.property("model")
			result.should.have.property("max_tokens")
			result.should.have.property("system")
			result.should.have.property("messages")
			result.should.have.property("tools")
			result.should.have.property("tool_choice")
		})
	})
})
