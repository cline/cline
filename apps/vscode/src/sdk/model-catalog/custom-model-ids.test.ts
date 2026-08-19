import { describe, expect, it } from "vitest"
import { providerAllowsCustomModelIds } from "./custom-model-ids"

describe("providerAllowsCustomModelIds", () => {
	it("allows custom Vertex model IDs", () => {
		expect(providerAllowsCustomModelIds("vertex")).toBe(true)
	})

	it("keeps closed catalog providers closed", () => {
		expect(providerAllowsCustomModelIds("anthropic")).toBe(false)
		expect(providerAllowsCustomModelIds("gemini")).toBe(false)
	})
})
