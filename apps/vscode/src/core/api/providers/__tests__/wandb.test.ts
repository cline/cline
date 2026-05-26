import "should"
import { openAiModelInfoSaneDefaults, wandbDefaultModelId, wandbModels } from "@shared/api"
import { WandbHandler } from "../wandb"

describe("WandbHandler", () => {
	it("returns known catalog model metadata when model id is recognized", () => {
		const modelId = "meta-llama/Llama-3.3-70B-Instruct"
		const handler = new WandbHandler({
			wandbApiKey: "test-api-key",
			apiModelId: modelId,
		})

		const model = handler.getModel()

		model.id.should.equal(modelId)
		model.info.should.deepEqual(wandbModels[modelId])
	})

	it("passes through an explicit unknown model id instead of silently falling back", () => {
		const unknownModelId = "moonshotai/Kimi-K2.5"
		const handler = new WandbHandler({
			wandbApiKey: "test-api-key",
			apiModelId: unknownModelId,
		})

		const model = handler.getModel()

		model.id.should.equal(unknownModelId)
		model.info.should.deepEqual(openAiModelInfoSaneDefaults)
	})

	it("uses the default W&B model when no model id is configured", () => {
		const handler = new WandbHandler({
			wandbApiKey: "test-api-key",
		})

		const model = handler.getModel()

		model.id.should.equal(wandbDefaultModelId)
		model.info.should.deepEqual(wandbModels[wandbDefaultModelId])
	})
})
