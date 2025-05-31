import { describe, it, beforeEach } from "mocha"
import { expect } from "chai"
import { GroqHandler } from "../groq"
import { groqDefaultModelId, groqModels } from "../../../shared/api"

describe("GroqHandler", () => {
	let handler: GroqHandler

	beforeEach(() => {
		handler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: groqDefaultModelId,
		})
	})

	it("should initialize with correct default model", () => {
		const model = handler.getModel()
		expect(model.id).to.equal(groqDefaultModelId)
		expect(model.info).to.deep.equal(groqModels[groqDefaultModelId])
	})

	it("should use specified model when provided", () => {
		const customHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "llama-3.1-8b-instant",
		})
		const model = customHandler.getModel()
		expect(model.id).to.equal("llama-3.1-8b-instant")
		expect(model.info).to.deep.equal(groqModels["llama-3.1-8b-instant"])
	})

	it("should fall back to default model for invalid model ID", () => {
		const customHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "invalid-model",
		})
		const model = customHandler.getModel()
		expect(model.id).to.equal(groqDefaultModelId)
		expect(model.info).to.deep.equal(groqModels[groqDefaultModelId])
	})

	it("should have correct model properties", () => {
		const model = handler.getModel()
		expect(model.info.maxTokens).to.be.greaterThan(0)
		expect(model.info.contextWindow).to.be.greaterThan(0)
		expect(model.info.supportsImages).to.equal(false)
		expect(model.info.supportsPromptCache).to.equal(false)
		expect(model.info.inputPrice).to.be.a("number")
		expect(model.info.outputPrice).to.be.a("number")
	})

	it("should include new Llama 4 models", () => {
		const llama4ScoutHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "meta-llama/llama-4-scout-17b-16e-instruct",
		})
		const model = llama4ScoutHandler.getModel()
		expect(model.id).to.equal("meta-llama/llama-4-scout-17b-16e-instruct")
		expect(model.info.inputPrice).to.equal(0.31)
		expect(model.info.outputPrice).to.equal(0.36)
		expect(model.info.description).to.include("Llama 4 Scout")
	})

	it("should include vision-capable models", () => {
		const llama4MaverickHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "meta-llama/llama-4-maverick-17b-128e-instruct",
		})
		const model = llama4MaverickHandler.getModel()
		expect(model.id).to.equal("meta-llama/llama-4-maverick-17b-128e-instruct")
		expect(model.info.supportsImages).to.equal(true)
		expect(model.info.inputPrice).to.equal(0.2)
		expect(model.info.outputPrice).to.equal(0.6)
	})

	it("should include updated pricing for all models", () => {
		// Test a few key models to ensure pricing is updated
		const testCases = [
			{ modelId: "llama-3.3-70b-versatile", expectedInput: 0.79, expectedOutput: 0.79 },
			{ modelId: "deepseek-r1-distill-llama-70b", expectedInput: 0.75, expectedOutput: 0.99 },
			{ modelId: "qwen-qwq-32b", expectedInput: 0.29, expectedOutput: 0.39 },
			{ modelId: "mistral-saba-24b", expectedInput: 0.79, expectedOutput: 0.79 },
		]

		testCases.forEach(({ modelId, expectedInput, expectedOutput }) => {
			const testHandler = new GroqHandler({
				groqApiKey: "test-key",
				apiModelId: modelId,
			})
			const model = testHandler.getModel()
			expect(model.info.inputPrice).to.equal(expectedInput, `Input price for ${modelId}`)
			expect(model.info.outputPrice).to.equal(expectedOutput, `Output price for ${modelId}`)
		})
	})

	it("should have comprehensive model descriptions", () => {
		// Check that all models have meaningful descriptions
		Object.entries(groqModels).forEach(([modelId, modelInfo]) => {
			expect(modelInfo.description).to.be.a("string")
			expect(modelInfo.description.length).to.be.greaterThan(10, `Description for ${modelId} should be meaningful`)
		})
	})

	it("should support dynamic model info from API", () => {
		const dynamicModelInfo = {
			maxTokens: 16384,
			contextWindow: 65536,
			supportsImages: true,
			supportsPromptCache: false,
			inputPrice: 0.5,
			outputPrice: 1.0,
			description: "Dynamic model from API",
		}

		const dynamicHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "compound-beta",
			groqModelInfo: dynamicModelInfo,
		})

		const model = dynamicHandler.getModel()
		expect(model.id).to.equal("compound-beta")
		expect(model.info).to.deep.equal(dynamicModelInfo)
	})

	it("should fall back to static models when dynamic info is not available", () => {
		const handlerWithoutDynamic = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "llama-3.3-70b-versatile",
			// No groqModelInfo provided
		})

		const model = handlerWithoutDynamic.getModel()
		expect(model.id).to.equal("llama-3.3-70b-versatile")
		expect(model.info).to.deep.equal(groqModels["llama-3.3-70b-versatile"])
	})

	it("should handle unknown models gracefully", () => {
		const unknownModelHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "unknown-model-id",
			// No groqModelInfo provided
		})

		const model = unknownModelHandler.getModel()
		expect(model.id).to.equal(groqDefaultModelId)
		expect(model.info).to.deep.equal(groqModels[groqDefaultModelId])
	})

	it("should prioritize dynamic model info over static models", () => {
		const dynamicModelInfo = {
			maxTokens: 99999, // Different from static
			contextWindow: 99999, // Different from static
			supportsImages: true, // Different from static
			supportsPromptCache: true, // Different from static
			inputPrice: 99.99, // Different from static
			outputPrice: 99.99, // Different from static
			description: "Dynamic override",
		}

		const overrideHandler = new GroqHandler({
			groqApiKey: "test-key",
			apiModelId: "llama-3.3-70b-versatile", // This exists in static models
			groqModelInfo: dynamicModelInfo,
		})

		const model = overrideHandler.getModel()
		expect(model.id).to.equal("llama-3.3-70b-versatile")
		expect(model.info).to.deep.equal(dynamicModelInfo)
		// Ensure it's not using static model info
		expect(model.info).to.not.deep.equal(groqModels["llama-3.3-70b-versatile"])
	})
})
