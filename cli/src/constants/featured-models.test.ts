import { describe, expect, it } from "vitest"
import { getAllFeaturedModels, mapRecommendedModelsToFeaturedModels } from "./featured-models"

describe("featured models", () => {
	it("includes display names for all featured models", () => {
		const models = getAllFeaturedModels()

		for (const model of models) {
			expect(model.name).toBeTruthy()
		}
	})

	it("fills free model metadata from fallback when upstream payload is sparse", () => {
		const models = mapRecommendedModelsToFeaturedModels({
			recommended: [],
			free: [{ id: "trinity-large-preview:free", name: "trinity-large-preview:free", description: "", tags: [] }],
		})

		expect(models.free[0]?.name).toBe("Arcee AI Trinity Large Preview")
		expect(models.free[0]?.description).toBe("Arcee AI's advanced large preview model in the Trinity series")
		expect(models.free[0]?.labels).toContain("FREE")
	})
})
