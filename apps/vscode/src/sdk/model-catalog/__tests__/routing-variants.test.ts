import { describe, expect, it } from "vitest"
import { lookupCatalogModel } from "../routing-variants"

describe("lookupCatalogModel", () => {
	const catalog = new Map([
		["z-ai/glm-5.3-flash", { name: "GLM 5.3 Flash", contextWindow: 1_048_576 }],
		["z-ai/glm-5.3-flash:exacto", { name: "Explicit exacto entry", contextWindow: 2_000_000 }],
		["meta-llama/llama-3.3-70b-instruct:free", { name: "Llama Free", contextWindow: 128_000 }],
	])

	const lookup = (id: string) => catalog.get(id)

	it("returns exact match when present in catalog", () => {
		expect(lookupCatalogModel("z-ai/glm-5.3-flash", lookup)).toEqual({
			name: "GLM 5.3 Flash",
			contextWindow: 1_048_576,
		})
	})

	it("prefers exact match over routing variant fallback", () => {
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:exacto", lookup)).toEqual({
			name: "Explicit exacto entry",
			contextWindow: 2_000_000,
		})
	})

	it("falls back to base model for routing variants", () => {
		for (const suffix of [":floor", ":nitro", ":online"]) {
			expect(lookupCatalogModel(`z-ai/glm-5.3-flash${suffix}`, lookup)).toEqual({
				name: "GLM 5.3 Flash",
				contextWindow: 1_048_576,
			})
		}
	})

	it("does not fall back for catalog variants like :free or unknown suffixes", () => {
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:free", lookup)).toBeUndefined()
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:batch", lookup)).toBeUndefined()
		expect(lookupCatalogModel("z-ai/glm-5.3-flash:unknown", lookup)).toBeUndefined()
	})

	it("returns undefined for unlisted models without suffixes", () => {
		expect(lookupCatalogModel("unknown/model", lookup)).toBeUndefined()
	})
})
