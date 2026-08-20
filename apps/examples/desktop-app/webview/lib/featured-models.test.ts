import { describe, expect, it } from "vitest";
import {
	buildModelPickerData,
	EMPTY_FEATURED_MODELS,
	type FeaturedModelsData,
} from "@/lib/featured-models";
import type { ProviderModel } from "@/lib/provider-schema";

function model(id: string, name?: string): ProviderModel {
	return { id, name: name ?? id };
}

const FEATURED: FeaturedModelsData = {
	recommended: [
		{
			id: "anthropic/claude-opus-5",
			name: "Claude Opus 5",
			description: "Most intelligent model",
			tags: ["NEW"],
		},
		{
			id: "vendor/missing-model",
			name: "Missing Model",
			description: "",
			tags: ["NEW"],
		},
	],
	free: [
		{
			id: "deepseek/deepseek-v4-flash",
			name: "DeepSeek V4 Flash",
			description: "Fast and efficient",
			tags: [],
		},
	],
	clinePass: [
		{
			id: "cline-pass/kimi-k3",
			name: "Kimi K3",
			description: "Leading open weights model",
			tags: [],
		},
	],
};

describe("buildModelPickerData", () => {
	it("builds recommended / free / all sections for the cline provider", () => {
		const { options, sections } = buildModelPickerData(
			"cline",
			[
				model("zzz/last-model", "ZZZ Last"),
				model("anthropic/claude-opus-5", "Claude Opus 5"),
				model("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"),
				model("aaa/first-model", "AAA First"),
			],
			FEATURED,
		);

		expect(sections?.map((section) => section.id)).toEqual([
			"recommended",
			"free",
			"all",
		]);
		expect(options.map((option) => option.value)).toEqual([
			"anthropic/claude-opus-5",
			"deepseek/deepseek-v4-flash",
			"aaa/first-model",
			"zzz/last-model",
		]);
		expect(options[0]).toMatchObject({
			badge: "NEW",
			description: "Most intelligent model",
			label: "Claude Opus 5",
			section: "recommended",
		});
		expect(options[1]).toMatchObject({ badge: "Free", section: "free" });
		// The "all" tier is sorted by display name, not raw id.
		expect(options[2]?.label).toBe("AAA First");
	});

	it("drops featured entries that are missing from the catalog", () => {
		const { options } = buildModelPickerData(
			"cline",
			[model("anthropic/claude-opus-5", "Claude Opus 5")],
			FEATURED,
		);
		expect(
			options.some((option) => option.value === "vendor/missing-model"),
		).toBe(false);
	});

	it("resolves feed ids against catalog aliases by unique slug", () => {
		const { options } = buildModelPickerData(
			"cline",
			[model("z-ai/glm-5.2", "GLM 5.2")],
			{
				...EMPTY_FEATURED_MODELS,
				recommended: [
					{ id: "zai/glm-5.2", name: "GLM 5.2", description: "", tags: [] },
				],
			},
		);
		expect(options[0]).toMatchObject({
			section: "recommended",
			value: "z-ai/glm-5.2",
		});
	});

	it("builds subscribed / free sections for cline-pass and hides stale catalog leftovers", () => {
		const { options, sections } = buildModelPickerData(
			"cline-pass",
			[
				model("cline-pass/kimi-k3", "Kimi K3"),
				model("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"),
				// Bundled/cached entry no longer part of the plan's offer.
				model("nvidia/nemotron-ultra", "Nemotron Ultra"),
			],
			FEATURED,
		);
		expect(sections?.map((section) => section.id)).toEqual([
			"subscribed",
			"free",
		]);
		expect(options.map((option) => option.section)).toEqual([
			"subscribed",
			"free",
		]);
		expect(
			options.some((option) => option.value === "nvidia/nemotron-ultra"),
		).toBe(false);
	});

	it("falls back to the full cline-pass catalog when the subscribed tier is empty", () => {
		const { options, sections } = buildModelPickerData(
			"cline-pass",
			[
				model("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash"),
				model("nvidia/nemotron-ultra", "Nemotron Ultra"),
			],
			{ ...FEATURED, clinePass: [] },
		);
		expect(sections?.map((section) => section.id)).toEqual([
			"subscribed",
			"free",
			"all",
		]);
		expect(options.map((option) => option.value)).toEqual([
			"deepseek/deepseek-v4-flash",
			"nvidia/nemotron-ultra",
		]);
		expect(options[1]?.section).toBe("all");
	});

	it("falls back to a flat name-sorted list when the feed is empty", () => {
		const { options, sections } = buildModelPickerData(
			"cline",
			[model("zzz/last", "ZZZ"), model("aaa/first", "AAA")],
			EMPTY_FEATURED_MODELS,
		);
		expect(sections).toBeUndefined();
		expect(options.map((option) => option.label)).toEqual(["AAA", "ZZZ"]);
		expect(options[0]?.section).toBeUndefined();
	});

	it("renders other providers as a flat list with display names", () => {
		const { options, sections } = buildModelPickerData(
			"anthropic",
			[model("claude-sonnet-4-6", "Claude Sonnet 4.6")],
			FEATURED,
		);
		expect(sections).toBeUndefined();
		expect(options).toEqual([
			{ label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
		]);
	});
});
