import "should"
import { nvidiaDefaultModelId, nvidiaDefaultModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { NvidiaHandler } from "../nvidia"

describe("NvidiaHandler", () => {
	it("passes through an explicit model id with sane OpenAI-compatible defaults", () => {
		const modelId = "nvidia/custom-model"
		const handler = new NvidiaHandler({
			nvidiaApiKey: "test-api-key",
			apiModelId: modelId,
		})

		const model = handler.getModel()

		model.id.should.equal(modelId)
		model.info.should.deepEqual(openAiModelInfoSaneDefaults)
	})

	it("uses default metadata when the configured model is the NVIDIA default", () => {
		const handler = new NvidiaHandler({
			nvidiaApiKey: "test-api-key",
			apiModelId: nvidiaDefaultModelId,
		})

		const model = handler.getModel()

		model.id.should.equal(nvidiaDefaultModelId)
		model.info.should.deepEqual(nvidiaDefaultModelInfo)
	})

	it("uses the default NVIDIA NIM model when no model id is configured", () => {
		const handler = new NvidiaHandler({
			nvidiaApiKey: "test-api-key",
		})

		const model = handler.getModel()

		model.id.should.equal(nvidiaDefaultModelId)
		model.info.should.deepEqual(nvidiaDefaultModelInfo)
	})
})
