import "should"
import { VertexHandler } from "../vertex"

describe("VertexHandler", () => {
	it("returns SDK-known Vertex Claude metadata for a known id", () => {
		const handler = new VertexHandler({
			vertexProjectId: "test-project",
			vertexRegion: "global",
			apiModelId: "claude-opus-4-7@default",
		})

		const model = handler.getModel()
		model.id.should.equal("claude-opus-4-7@default")
		// SDK populates context window and pricing for Claude Vertex
		// variants. We only assert presence/typing here so the test
		// doesn't track changing list prices over time.
		model.info.contextWindow!.should.be.a.Number().and.greaterThan(0)
		// Host-side override carries `supportsGlobalEndpoint` for
		// global-capable Claude variants. See
		// apps/vscode/src/sdk/model-catalog/vertex-global-endpoint.ts.
		model.info.supportsGlobalEndpoint!.should.equal(true)
	})

	it("does not flag pre-4.x Claude variants as global-endpoint capable", () => {
		const handler = new VertexHandler({
			vertexProjectId: "test-project",
			vertexRegion: "global",
			apiModelId: "claude-3-5-sonnet@20241022",
		})

		const model = handler.getModel()
		model.id.should.equal("claude-3-5-sonnet@20241022")
		// The allowlist excludes Claude 3.5; the field should be absent
		// (or falsy) because the host override only runs for matched ids.
		should(model.info.supportsGlobalEndpoint).not.be.true()
	})
})
