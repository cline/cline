import { describe, expect, it } from "vitest"
import { getAllFeaturedModels, mapRecommendedModelsToFeaturedModels, withFeaturedModelFallback } from "./featured-models"

describe("featured models", () => {
	it("includes display names for all featured models", () => {
		const models = getAllFeaturedModels()

		for (const model of models) {
			expect(model.name).toBeTruthy()
		}
	})

	it("does not add fallback free models when upstream free models are empty", () => {
		const models = mapRecommendedModelsToFeaturedModels({
			recommended: [],
			free: [],
		})

		expect(models.free).toEqual([])
	})

	it("only falls back recommended models", () => {
		const models = withFeaturedModelFallback({
			recommended: [],
			free: [],
		})

		expect(models.recommended.length).toBeGreaterThan(0)
		expect(models.free).toEqual([])
	})

	it("adds the free label to upstream free models when tags are omitted", () => {
		const models = mapRecommendedModelsToFeaturedModels({
			recommended: [],
			free: [{ id: "trinity-large-preview:free", name: "trinity-large-preview:free", description: "", tags: [] }],
		})

		expect(models.free[0]?.name).toBe("trinity-large-preview:free")
		expect(models.free[0]?.description).toBe("")
		expect(models.free[0]?.labels).toContain("FREE")
	})
})
