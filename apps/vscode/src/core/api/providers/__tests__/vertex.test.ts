import "should"
import { vertexGlobalModels } from "@shared/api"
import { VertexHandler } from "../vertex"

describe("VertexHandler", () => {
	it("supports Gemini 3.5 Flash model metadata", () => {
		const handler = new VertexHandler({
			vertexProjectId: "test-project",
			vertexRegion: "global",
			apiModelId: "gemini-3.5-flash",
		})

		const model = handler.getModel()
		model.id.should.equal("gemini-3.5-flash")
		model.info.contextWindow!.should.equal(1_048_576)
		model.info.inputPrice!.should.equal(1.5)
		model.info.outputPrice!.should.equal(9)
		model.info.cacheReadsPrice!.should.equal(0.15)
		model.info.supportsGlobalEndpoint!.should.equal(true)
		model.info.supportsReasoning!.should.equal(true)
		vertexGlobalModels.should.have.property("gemini-3.5-flash")
	})
})
