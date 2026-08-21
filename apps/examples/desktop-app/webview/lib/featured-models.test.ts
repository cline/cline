import { describe, expect, it } from "vitest";
import { buildModelPickerData } from "@/lib/featured-models";
import type {
	ProviderModel,
	ProviderModelFeatured,
} from "@/lib/provider-schema";

function model(
	id: string,
	name?: string,
	featured?: ProviderModelFeatured,
	description?: string,
): ProviderModel {
	return { id, name: name ?? id, featured, description };
}

describe("buildModelPickerData", () => {
	it("builds recommended / free / all sections for the cline provider", () => {
		const { options, sections } = buildModelPickerData("cline", [
			model("zzz/last-model", "ZZZ Last"),
			model(
				"deepseek/deepseek-v4-flash",
				"DeepSeek V4 Flash",
				{ tier: "free", rank: 0, tags: [] },
				"Fast and efficient",
			),
			model(
				"anthropic/claude-opus-5",
				"Claude Opus 5",
				{ tier: "recommended", rank: 0, tags: ["NEW"] },
				"Most intelligent model",
			),
			model("aaa/first-model", "AAA First"),
		]);

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

	it("orders featured tiers by feed rank, not list order", () => {
		const { options } = buildModelPickerData("cline", [
			model("openai/gpt-5.6-sol", "GPT-5.6 Sol", {
				tier: "recommended",
				rank: 1,
				tags: [],
			}),
			model("moonshotai/kimi-k3", "Kimi K3", {
				tier: "recommended",
				rank: 0,
				tags: ["NEW"],
			}),
		]);
		expect(options.map((option) => option.label)).toEqual([
			"Kimi K3",
			"GPT-5.6 Sol",
		]);
	});

	it("builds subscribed / free sections for cline-pass and hides stale catalog leftovers", () => {
		const { options, sections } = buildModelPickerData("cline-pass", [
			model("cline-pass/kimi-k3", "Kimi K3", {
				tier: "subscribed",
				rank: 0,
				tags: [],
			}),
			model("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", {
				tier: "free",
				rank: 0,
				tags: [],
			}),
			// Bundled/cached entry no longer part of the plan's offer.
			model("nvidia/nemotron-ultra", "Nemotron Ultra"),
		]);
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
		const { options, sections } = buildModelPickerData("cline-pass", [
			model("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", {
				tier: "free",
				rank: 0,
				tags: [],
			}),
			model("nvidia/nemotron-ultra", "Nemotron Ultra"),
		]);
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

	it("falls back to a flat name-sorted list when nothing is featured", () => {
		const { options, sections } = buildModelPickerData("cline", [
			model("zzz/last", "ZZZ"),
			model("aaa/first", "AAA"),
		]);
		expect(sections).toBeUndefined();
		expect(options.map((option) => option.label)).toEqual(["AAA", "ZZZ"]);
		expect(options[0]?.section).toBeUndefined();
	});

	it("renders other providers as a flat list with display names", () => {
		const { options, sections } = buildModelPickerData("anthropic", [
			model("claude-sonnet-4-6", "Claude Sonnet 4.6"),
		]);
		expect(sections).toBeUndefined();
		expect(options).toEqual([
			{ label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
		]);
	});
});
