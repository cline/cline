import { describe, expect, it } from "vitest"
import { providerAllowsCustomModelIds } from "./custom-model-ids"

describe("providerAllowsCustomModelIds", () => {
	it("allows Novita users to enter model ids from the Novita catalog", () => {
		expect(providerAllowsCustomModelIds("novita-ai")).toBe(true)
	})
})
