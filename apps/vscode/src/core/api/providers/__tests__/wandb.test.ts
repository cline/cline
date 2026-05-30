import { getProviderCollectionSync } from "@cline/llms"
import "should"
import { adaptSdkModelInfo } from "@/sdk/model-catalog/shape-adapter"
import { WandbHandler } from "../wandb"

const wandbSdk = getProviderCollectionSync("wandb")
function sdkInfo(modelId: string) {
	const raw = wandbSdk?.models[modelId]
	if (!raw) {
		throw new Error(`SDK wandb catalog missing ${modelId}`)
	}
	return adaptSdkModelInfo(raw)
}

describe("WandbHandler", () => {
	it("returns SDK catalog metadata when model id is recognized", () => {
		const modelId = Object.keys(wandbSdk?.models ?? {})[0]
		if (!modelId) {
			throw new Error("SDK wandb catalog is empty; cannot run this assertion")
		}
		const handler = new WandbHandler({
			wandbApiKey: "test-api-key",
			apiModelId: modelId,
		})

		const model = handler.getModel()
		model.id.should.equal(modelId)
		model.info.should.deepEqual(sdkInfo(modelId))
	})

	it("uses the SDK-declared default model when no model id is configured", () => {
		const handler = new WandbHandler({ wandbApiKey: "test-api-key" })
		const expectedDefaultId = wandbSdk?.provider.defaultModelId
		if (!expectedDefaultId) {
			throw new Error("SDK wandb provider has no defaultModelId; cannot run this assertion")
		}

		const model = handler.getModel()
		model.id.should.equal(expectedDefaultId)
		model.info.should.deepEqual(sdkInfo(expectedDefaultId))
	})
})
