import type {
	OnboardingModel,
	OnboardingModelGroup,
} from "@shared/proto/cline/state";
import { describe, expect, it } from "vitest";
import {
	getClineUIOnboardingGroups,
	getRecommendedModelsData,
} from "../data-models";

function model(id: string, group: string): OnboardingModel {
	return {
		id,
		name: id,
		group,
		badge: "",
		score: 0,
		latency: 0,
		info: undefined,
	} as OnboardingModel;
}

function groupOf(models: OnboardingModel[]): OnboardingModelGroup {
	return { models } as OnboardingModelGroup;
}

describe("getClineUIOnboardingGroups", () => {
	it("buckets ClinePass models into the clinePass group", () => {
		const result = getClineUIOnboardingGroups(
			groupOf([
				model("cline-pass/glm-5.1", "clinepass"),
				model("free-model", "free"),
				model("anthropic/claude", "frontier"),
				model("z-ai/glm", "open source"),
			]),
		);

		expect(result.clinePass).toHaveLength(1);
		expect(result.clinePass[0].group).toBe("clinepass");
		expect(result.clinePass[0].models.map((m) => m.id)).toEqual([
			"cline-pass/glm-5.1",
		]);
		expect(result.free[0].models.map((m) => m.id)).toEqual(["free-model"]);
		expect(result.power.flatMap((g) => g.models.map((m) => m.id))).toEqual([
			"anthropic/claude",
			"z-ai/glm",
		]);
	});

	it("returns an empty clinePass group when no ClinePass models are present", () => {
		const result = getClineUIOnboardingGroups(
			groupOf([model("free-model", "free")]),
		);
		expect(result.clinePass).toEqual([]);
	});
});

describe("getRecommendedModelsData", () => {
	it("ignores ClinePass-only responses when the ClinePass feature flag is disabled", () => {
		const result = getRecommendedModelsData(
			{
				recommended: [],
				free: [],
				clinePass: [
					{
						id: "cline-pass/glm-5.1",
						name: "GLM 5.1",
						description: "",
						tags: [],
					},
				],
			},
			false,
		);

		expect(result).toBeUndefined();
	});

	it("includes ClinePass models when the ClinePass feature flag is enabled", () => {
		const result = getRecommendedModelsData(
			{
				recommended: [],
				free: [],
				clinePass: [
					{
						id: "cline-pass/glm-5.1",
						name: "GLM 5.1",
						description: "",
						tags: [],
					},
				],
			},
			true,
		);

		expect(result?.clinePass.map((model) => model.id)).toEqual([
			"cline-pass/glm-5.1",
		]);
	});

	it("keeps classic recommended/free responses when the ClinePass feature flag is disabled", () => {
		const result = getRecommendedModelsData(
			{
				recommended: [
					{ id: "anthropic/claude", name: "Claude", description: "", tags: [] },
				],
				free: [{ id: "free-model", name: "Free", description: "", tags: [] }],
				clinePass: [
					{
						id: "cline-pass/glm-5.1",
						name: "GLM 5.1",
						description: "",
						tags: [],
					},
				],
			},
			false,
		);

		expect(result?.recommended.map((model) => model.id)).toEqual([
			"anthropic/claude",
		]);
		expect(result?.free.map((model) => model.id)).toEqual(["free-model"]);
		expect(result?.clinePass).toEqual([]);
	});
});
