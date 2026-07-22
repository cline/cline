import { describe, expect, it } from "vitest"
import { parseProviderId } from "./provider-id"
import { vertexModelSupportsGlobalEndpoint } from "./vertex-global-endpoint"

describe("vertexModelSupportsGlobalEndpoint", () => {
	it("accepts Claude Fable 5 on the global Vertex endpoint", () => {
		const vertex = parseProviderId("vertex")

		for (const modelId of ["claude-fable-5", "claude-fable-5@default", "claude-fable-5:1m"]) {
			expect(vertexModelSupportsGlobalEndpoint(vertex, modelId)).toBe(true)
		}
	})

	it("rejects unsupported models and non-Vertex providers", () => {
		expect(vertexModelSupportsGlobalEndpoint(parseProviderId("vertex"), "custom-model")).toBe(false)
		expect(vertexModelSupportsGlobalEndpoint(parseProviderId("anthropic"), "claude-fable-5")).toBe(false)
	})
})
