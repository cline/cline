import { describe, expect, it } from "vitest"
import { lookupCatalogModel } from "./routing-variants"

const catalog = new Map([
	["z-ai/glm-5.3-flash", { contextWindow: 1_048_576 }],
	["z-ai/glm-5.3-flash:free", { contextWindow: 131_072 }],
])
const lookup = (id: string) => catalog.get(id)

describe("lookupCatalogModel", () => {
	it("returns an exact catalog entry", () => {
		expect(lookupCatalogModel("z-ai/glm-5.3-flash", lookup)).toEqual({ contextWindow: 1_048_576 })
	})

	it("resolves routing variants to the base model entry", () => {
		for (const suffix of ["floor", "nitro", "exacto", "online"]) {
			expect(lookupCatalogModel(`z-ai/glm-5.3-flash:${suffix}`, lookup)).toEqual({ contextWindow: 1_048_576 })
		}
	})

	it("prefers an exact entry over the base model for a listed variant", () => {
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:free", lookup)).toEqual({ contextWindow: 131_072 })
	})

	it("does not strip catalog variants or unknown suffixes", () => {
		const baseOnly = (id: string) => (id === "z-ai/glm-5.3-flash" ? { contextWindow: 1_048_576 } : undefined)
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:free", baseOnly)).toBeUndefined()
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:batch", baseOnly)).toBeUndefined()
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:thinking", baseOnly)).toBeUndefined()
	})

	it("returns undefined when neither the id nor its base is listed", () => {
		expect(lookupCatalogModel("unknown/model:floor", lookup)).toBeUndefined()
		expect(lookupCatalogModel(":floor", lookup)).toBeUndefined()
	})
})
