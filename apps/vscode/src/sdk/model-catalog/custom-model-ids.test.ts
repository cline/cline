import { describe, expect, it } from "vitest"
import { providerAllowsCustomModelIds } from "./custom-model-ids"

describe("providerAllowsCustomModelIds", () => {
	it("allows Atomic Chat model IDs outside the generated catalog", () => {
		expect(providerAllowsCustomModelIds("atomic-chat")).toBe(true)
	})
})
