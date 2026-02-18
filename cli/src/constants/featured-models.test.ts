import { describe, expect, it } from "vitest"
import { getAllFeaturedModels } from "./featured-models"

describe("featured models", () => {
	it("includes display names for all featured models", () => {
		const models = getAllFeaturedModels()

		for (const model of models) {
			expect(model.name).toBeTruthy()
		}
	})
})
