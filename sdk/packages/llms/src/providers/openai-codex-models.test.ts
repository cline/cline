import { describe, expect, it } from "vitest";
import {
	getGeneratedModelsForProvider,
	getGeneratedProviderModels,
} from "../catalog/catalog.generated-access";
import type { ModelInfo } from "../catalog/types";
import {
	CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
	filterOpenAICodexModels,
} from "./openai-codex-models";

function makeModel(id: string, overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id,
		contextWindow: 400_000,
		maxInputTokens: 300_000,
		maxTokens: 100_000,
		family: id.replace(/^gpt-/, "gpt"),
		...overrides,
	};
}

function filterOne(
	id: string,
	overrides: Partial<ModelInfo> = {},
): ModelInfo | undefined {
	return filterOpenAICodexModels({ [id]: makeModel(id, overrides) })[id];
}

describe("filterOpenAICodexModels", () => {
	describe("model eligibility", () => {
		it.each([
			["gpt-5", false],
			["gpt-5.1", false],
			["gpt-5.3-codex", false],
			["gpt-5.10", false],
			["gpt-6", true],
			["gpt-5.4", true],
			["gpt-5.5", true],
			["gpt-5.5-codex", true],
			["gpt-6.0", true],
			["gpt-10.1", true],
		])("eligibility for %s (strictly > 5.3)", (id, allowed) => {
			expect(filterOne(id) !== undefined).toBe(allowed);
		});

		it.each([
			["gpt-4.1", "older major version"],
			["gpt-4.99-codex", "older major with large minor"],
			["gpt-5.4oops", "incomplete version token"],
			["gpt-5.4.1", "unsupported patch version"],
			["gpt-5.", "missing minor"],
			["gpt-99999999999999999999", "unsafe version number"],
			["astra-preview", "missing GPT version"],
			["chatgpt-5.5", "id does not start with gpt-"],
			["davinci", "not a gpt model"],
		])("rejects %s (%s)", (id) => {
			expect(filterOne(id)).toBeUndefined();
		});

		it.each([
			["o-series", "o4"],
			["pro variant", "gpt5.5-pro"],
			["nano variant", "gpt5.5-nano"],
		])("rejects %s families regardless of id version", (_label, family) => {
			expect(filterOne("gpt-6.0", { family })).toBeUndefined();
		});

		it("falls back to the id version check when family is missing", () => {
			expect(filterOne("gpt-6.0", { family: undefined })).toBeDefined();
			expect(filterOne("gpt-4.0", { family: undefined })).toBeUndefined();
		});
	});

	it.each([
		"gpt-5-pro",
		"gpt-5.4-nano",
		"gpt-6-codex-pro",
		"gpt-6-PRO",
	])("rejects %s by id even with missing or generic family", (id) => {
		for (const family of [undefined, "gpt5"]) {
			expect(filterOne(id, { family })).toBeUndefined();
		}
	});

	it("also rejects a variant in the model id when the catalog key is generic", () => {
		expect(
			filterOne("gpt-6", { id: "gpt-6-nano", family: "gpt6" }),
		).toBeUndefined();
	});

	describe("Astra catalog fallback", () => {
		it("exposes Astra in native and derived Codex catalogs", () => {
			const native = getGeneratedModelsForProvider("openai-native");
			const astra = native["gpt-6-astra"];
			expect(astra).toMatchObject({
				id: "gpt-6-astra",
				name: "GPT-6 Astra",
				family: "gpt-astra",
				contextWindow: 1_050_000,
				maxInputTokens: 922_000,
				maxTokens: 128_000,
				capabilities: [
					"images",
					"tools",
					"reasoning",
					"structured_output",
					"prompt-cache",
				],
			});
			expect(
				getGeneratedProviderModels()["openai-native"]["gpt-6-astra"],
			).toEqual(astra);
			expect(filterOpenAICodexModels(native)["gpt-6-astra"]).toEqual({
				...astra,
				maxInputTokens: 922_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
			});
			expect(native).not.toHaveProperty("astra");
			expect(filterOne("astra")).toBeUndefined();
		});
		it("supplies documented limits with the Codex input adjustment for an empty catalog", () => {
			expect(filterOpenAICodexModels({})).toEqual({
				"gpt-6-astra": expect.objectContaining({
					id: "gpt-6-astra",
					name: "GPT-6 Astra",
					contextWindow: 1_050_000,
					maxInputTokens: 922_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
					maxTokens: 128_000,
					reasoningOptions: [
						{
							type: "effort",
							values: ["low", "medium", "high", "xhigh", "max"],
						},
					],
					metadata: {
						source: "https://developers.openai.com/api/docs/models/gpt-6-astra",
					},
				}),
			});
		});

		it("preserves supplied Astra metadata and applies the Codex input budget", () => {
			const astra = makeModel("gpt-6-astra", {
				metadata: { source: "catalog" },
			});
			const snapshot = structuredClone(astra);
			expect(
				filterOpenAICodexModels({ "gpt-6-astra": astra })["gpt-6-astra"],
			).toEqual({
				...snapshot,
				maxInputTokens: 300_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
			});
			expect(astra).toEqual(snapshot);
		});

		it("does not resurrect a rejected Astra entry", () => {
			expect(
				filterOpenAICodexModels({
					"gpt-6-astra": makeModel("gpt-6-astra", { family: "gpt-pro" }),
				}),
			).toEqual({});
		});

		it("does not share mutable fallback metadata or reasoning options between calls", () => {
			const first = filterOpenAICodexModels({})["gpt-6-astra"];
			const snapshot = structuredClone(first);
			first.metadata!.source = "changed";
			first.reasoningOptions!.length = 0;
			expect(filterOpenAICodexModels({})["gpt-6-astra"]).toEqual(snapshot);
		});
	});

	describe("context window adjustment", () => {
		it.each([
			"gpt-5.4",
			"gpt-5.4-mini",
			"gpt-6.0",
		])("scales %s maxInputTokens down to the effective Codex budget — the backend cap applies to every model, not just gpt-5.5", (id) => {
			const maxInputTokens = 200_000;
			const result = filterOne(id, { maxInputTokens });
			expect(result?.maxInputTokens).toBe(
				maxInputTokens * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
			);
		});

		it.each([
			"gpt-5.50",
			"gpt-5.51-codex",
			"gpt-6-gpt-5.5",
		])("does not apply GPT-5.5 caps to %s", (id) => {
			expect(filterOne(id)).toMatchObject({
				contextWindow: 400_000,
				maxInputTokens: 300_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
				maxTokens: 100_000,
			});
		});

		it("leaves other limits untouched for non-5.5 models", () => {
			const result = filterOne("gpt-6.0", {
				contextWindow: 500_000,
				maxTokens: 64_000,
			});
			expect(result?.contextWindow).toBe(500_000);
			expect(result?.maxTokens).toBe(64_000);
		});

		it("preserves an undefined maxInputTokens instead of producing NaN", () => {
			const result = filterOne("gpt-6.0", { maxInputTokens: undefined });
			expect(result?.maxInputTokens).toBeUndefined();
		});

		it("overrides gpt-5.5 limits with the ChatGPT backend caps", () => {
			const result = filterOne("gpt-5.5-codex", {
				contextWindow: 1_000_000,
				maxInputTokens: 900_000,
				maxTokens: 900_000,
			});
			expect(result).toMatchObject({
				contextWindow: 400_000,
				maxInputTokens: 272_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
				maxTokens: 128_000,
			});
		});

		it("does not mutate the input models", () => {
			const model = makeModel("gpt-6.0");
			const snapshot = structuredClone(model);
			filterOpenAICodexModels({ "gpt-6.0": model });
			expect(model).toEqual(snapshot);
		});
	});

	it("keeps allowed models and drops disallowed ones from a mixed catalog", () => {
		const models: Record<string, ModelInfo> = {
			"gpt-5.5": makeModel("gpt-5.5"),
			"gpt-6.0": makeModel("gpt-6.0"),
			"gpt-5.1": makeModel("gpt-5.1"),
			"o4-mini": makeModel("o4-mini", { family: "o4" }),
		};
		expect(Object.keys(filterOpenAICodexModels(models)).sort()).toEqual([
			"gpt-5.5",
			"gpt-6-astra",
			"gpt-6.0",
		]);
	});
});
