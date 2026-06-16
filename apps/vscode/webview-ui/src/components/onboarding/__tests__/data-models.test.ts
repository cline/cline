import type { OnboardingModel, OnboardingModelGroup } from "@shared/proto/cline/state"
import { describe, expect, it } from "vitest"
import { getClineUIOnboardingGroups } from "../data-models"

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
	it("buckets Cline Pass models into the clinePass group", () => {
		const result = getClineUIOnboardingGroups(
			groupOf([
				model("cline-pass/glm-5.1", "cline pass"),
				model("free-model", "free"),
				model("anthropic/claude", "frontier"),
				model("z-ai/glm", "open source"),
			]),
		)

		expect(result.clinePass).toHaveLength(1)
		expect(result.clinePass[0].group).toBe("cline pass")
		expect(result.clinePass[0].models.map((m) => m.id)).toEqual(["cline-pass/glm-5.1"])
		expect(result.free[0].models.map((m) => m.id)).toEqual(["free-model"])
		expect(result.power.flatMap((g) => g.models.map((m) => m.id))).toEqual(["anthropic/claude", "z-ai/glm"])
	})

	it("returns an empty clinePass group when no Cline Pass models are present", () => {
		const result = getClineUIOnboardingGroups(groupOf([model("free-model", "free")]))
		expect(result.clinePass).toEqual([])
	})
})
