import { describe, expect, it } from "vitest";
import {
	buildFeaturedModelEntries,
	CLINE_PASS_FREE_SECTION_DESCRIPTION,
	findFeaturedModelOption,
	freeTierDescriptionFor,
} from "./cline-model-entries";

const model = (id: string) => ({ id, name: id, description: "", tags: [] });

describe("featured model reasoning metadata", () => {
	it.each([
		["z-ai/glm-5.3-flash", "zai/glm-5.3-flash"],
		["zai/glm-5.3-flash", "z-ai/glm-5.3-flash"],
	])("resolves %s against catalog key %s", (feedId, catalogId) => {
		const option = { key: catalogId, supportsReasoning: true };
		const entries = buildFeaturedModelEntries("cline", {
			recommended: [],
			free: [model(feedId)],
			clinePass: [],
		});
		const entry = entries[0];
		if (entry.kind !== "model") throw new Error("Expected a free model");
		expect(findFeaturedModelOption([option], entry.model.id)).toBe(option);
		expect(entry.model.id).toBe(feedId);
	});

	it("prefers exact metadata when both spellings exist", () => {
		const exact = { key: "z-ai/glm-5.3-flash", supportsReasoning: false };
		const alias = { key: "zai/glm-5.3-flash", supportsReasoning: true };
		expect(findFeaturedModelOption([alias, exact], exact.key)).toBe(exact);
	});

	it("does not borrow capabilities from a different vendor or model variant", () => {
		const options = [
			{ key: "other/glm-5.3-flash", supportsReasoning: true },
			{ key: "zai/glm-5.3-flash:free", supportsReasoning: true },
		];
		expect(
			findFeaturedModelOption(options, "z-ai/glm-5.3-flash"),
		).toBeUndefined();
		expect(findFeaturedModelOption([], "unknown/model")).toBeUndefined();
	});
});

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
