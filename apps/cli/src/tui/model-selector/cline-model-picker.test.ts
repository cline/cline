import { describe, expect, it } from "vitest";
import {
	buildFeaturedModelEntries,
	CLINE_PASS_FREE_SECTION_DESCRIPTION,
	freeTierDescriptionFor,
} from "./cline-model-entries";

const model = (id: string) => ({ id, name: id, description: "", tags: [] });

describe("cline model picker entries", () => {
	it("builds Recommended/Free sections for the cline provider", () => {
		const entries = buildFeaturedModelEntries("cline", {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			clinePass: [model("cline-pass/glm-5.1")],
		});

		expect(entries).toEqual([
			{
				kind: "model",
				model: model("anthropic/claude-sonnet-5"),
				tier: "recommended",
			},
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
			{ kind: "browse" },
		]);
	});

	it("builds Subscribed/Free sections for the cline-pass provider", () => {
		const entries = buildFeaturedModelEntries("cline-pass", {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			clinePass: [model("cline-pass/glm-5.1"), model("cline-pass/kimi-k2.6")],
		});

		expect(entries).toEqual([
			{ kind: "model", model: model("cline-pass/glm-5.1"), tier: "subscribed" },
			{
				kind: "model",
				model: model("cline-pass/kimi-k2.6"),
				tier: "subscribed",
			},
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
		]);
	});

	it("adds the browse-all escape when the clinePass bucket is empty", () => {
		// The fetch fell back to the bundled list (no pass models); the sections
		// alone would leave a subscriber able to pick only free models.
		const entries = buildFeaturedModelEntries("cline-pass", {
			recommended: [],
			free: [model("deepseek/deepseek-v4-flash")],
			clinePass: [],
		});

		expect(entries).toEqual([
			{
				kind: "model",
				model: model("deepseek/deepseek-v4-flash"),
				tier: "free",
			},
			{ kind: "browse" },
		]);
	});

	it("attaches the quota explainer only to the ClinePass picker's free section", () => {
		const data = {
			recommended: [model("anthropic/claude-sonnet-5")],
			free: [model("deepseek/deepseek-v4-flash")],
			clinePass: [model("cline-pass/glm-5.1")],
		};

		expect(
			freeTierDescriptionFor(buildFeaturedModelEntries("cline-pass", data)),
		).toBe(CLINE_PASS_FREE_SECTION_DESCRIPTION);
		expect(
			freeTierDescriptionFor(buildFeaturedModelEntries("cline", data)),
		).toBe(undefined);
	});
});
