import { describe, expect, it } from "vitest";
import {
	buildFeaturedModelEntries,
	CLINE_PASS_FREE_SECTION_DESCRIPTION,
	freeTierDescriptionFor,
	searchFeaturedModels,
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

describe("searchFeaturedModels", () => {
	const namedModel = (id: string, name: string, tags: string[] = []) => ({
		id,
		name,
		description: "",
		tags,
	});
	const entries = buildFeaturedModelEntries("cline", {
		recommended: [
			namedModel("anthropic/claude-sonnet-5", "Claude Sonnet 5", ["NEW"]),
		],
		free: [namedModel("cline-free/claude-haiku-4", "Claude Haiku 4", ["FREE"])],
		clinePass: [],
	});
	const allModels = [
		{ key: "anthropic/claude-opus-5", name: "Claude Opus 5" },
		{ key: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
		{ key: "deepseek/deepseek-v4", name: "DeepSeek V4" },
	];

	it("returns nothing for an empty query", () => {
		expect(searchFeaturedModels({ entries, allModels, query: "  " })).toEqual(
			[],
		);
	});

	it("searches the full catalog, not just the featured entries", () => {
		const rows = searchFeaturedModels({ entries, allModels, query: "opus" });
		// The catalog-only Opus appears; the recommended Sonnet also matches
		// (fuzzy id match) and stays on top per the featured-first ordering.
		expect(rows.map((row) => row.id)).toEqual([
			"anthropic/claude-sonnet-5",
			"anthropic/claude-opus-5",
		]);
	});

	it("keeps recommended matches on top and deduplicates catalog matches", () => {
		const rows = searchFeaturedModels({ entries, allModels, query: "claude" });
		expect(rows.map((row) => row.id)).toEqual([
			// Featured matches first, in section order (recommended before free)
			"anthropic/claude-sonnet-5",
			"cline-free/claude-haiku-4",
			// Then remaining catalog matches; the featured sonnet is not repeated
			"anthropic/claude-opus-5",
		]);
		expect(rows[0]?.tier).toBe("recommended");
		expect(rows[0]?.tags).toEqual(["NEW"]);
		expect(rows[2]?.tier).toBeUndefined();
	});

	it("ignores browse-all entries and misses", () => {
		const rows = searchFeaturedModels({
			entries,
			allModels,
			query: "deepseek",
		});
		expect(rows.map((row) => row.id)).toEqual(["deepseek/deepseek-v4"]);
	});
});
