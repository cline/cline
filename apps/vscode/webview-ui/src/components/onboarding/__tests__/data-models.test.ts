import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/cline/state"
import { describe, expect, it } from "vitest"
import {
	CLINEPASS_GROUP,
	getClineUIOnboardingGroups,
	getOnboardingGroupDisplayName,
	getRecommendedModelsData,
} from "../data-models"

function model(id: string, group: string): OnboardingModel {
	return {
		id,
		name: id,
		group,
		badge: "",
		score: 0,
		latency: 0,
		info: undefined,
	} as OnboardingModel
}

function groupOf(models: OnboardingModel[]): OnboardingModelGroup {
	return { models } as OnboardingModelGroup
}

describe("getClineUIOnboardingGroups", () => {
	it("buckets ClinePass models into the clinePass group", () => {
		const result = getClineUIOnboardingGroups(
			groupOf([
				model("cline-pass/glm-5.2", CLINEPASS_GROUP),
				model("free-model", "free"),
				model("anthropic/claude", "frontier"),
				model("z-ai/glm", "open source"),
			]),
		)

		expect(result.clinePass).toHaveLength(1)
		expect(result.clinePass[0].group).toBe(CLINEPASS_GROUP)
		expect(result.clinePass[0].models.map((m) => m.id)).toEqual(["cline-pass/glm-5.2"])
		expect(result.free[0].models.map((m) => m.id)).toEqual(["free-model"])
		expect(result.power.flatMap((g) => g.models.map((m) => m.id))).toEqual(["anthropic/claude", "z-ai/glm"])
	})

	it("does not bucket cline-pass ids without a ClinePass group label", () => {
		const result = getClineUIOnboardingGroups(groupOf([model("cline-pass/glm-5.2", "frontier")]))

		expect(result.clinePass).toEqual([])
	})

	it("returns an empty clinePass group when no ClinePass models are present", () => {
		const result = getClineUIOnboardingGroups(groupOf([model("free-model", "free")]))
		expect(result.clinePass).toEqual([])
	})
})

describe("getRecommendedModelsData", () => {
	it("includes ClinePass-only responses without depending on feature-flag timing", () => {
		const result = getRecommendedModelsData({
			recommended: [],
			free: [],
			clinePass: [{ id: "cline-pass/glm-5.2", name: "GLM 5.1", description: "", tags: [] }],
		})

		expect(result?.clinePass.map((model) => model.id)).toEqual(["cline-pass/glm-5.2"])
	})

	it("keeps classic recommended/free responses and ClinePass responses", () => {
		const result = getRecommendedModelsData({
			recommended: [{ id: "anthropic/claude", name: "Claude", description: "", tags: [] }],
			free: [{ id: "free-model", name: "Free", description: "", tags: [] }],
			clinePass: [{ id: "cline-pass/glm-5.2", name: "GLM 5.1", description: "", tags: [] }],
		})

		expect(result?.recommended.map((model) => model.id)).toEqual(["anthropic/claude"])
		expect(result?.free.map((model) => model.id)).toEqual(["free-model"])
		expect(result?.clinePass.map((model) => model.id)).toEqual(["cline-pass/glm-5.2"])
	})

	it("returns undefined when every recommended bucket is empty", () => {
		const result = getRecommendedModelsData({ recommended: [], free: [], clinePass: [] })

		expect(result).toBeUndefined()
	})
})

describe("onboarding display labels", () => {
	it("renders the canonical ClinePass group as a user-facing product name", () => {
		expect(getOnboardingGroupDisplayName(CLINEPASS_GROUP)).toBe("ClinePass")
		expect(getOnboardingGroupDisplayName("frontier")).toBe("frontier")
	})
})
