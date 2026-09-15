import { describe, expect, it } from "vitest";
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
			["gpt-5.5", "explicitly allowed"],
			["gpt-5.3-codex-spark", "explicitly allowed"],
			["gpt-5.5-codex", "newer than 5.4"],
			["gpt-5.6-terra", "newer than 5.4"],
			["gpt-5.10", "minor version compared numerically"],
			["gpt-6-astra", "integer major version"],
			["gpt-6.0", "newer major version"],
			["gpt-10.1", "newer major version"],
		])("allows %s (%s)", (id) => {
			expect(filterOne(id)).toBeDefined();
		});

		it.each([
			["gpt-5.4", "retired for ChatGPT accounts"],
			["gpt-5.4-mini", "retired for ChatGPT accounts"],
			["gpt-5.6", "bare alias of the Sol variant"],
			["gpt-5.5-pro", "explicitly disallowed"],
			["gpt-5.3", "older than 5.4"],
			["gpt-5.3-codex", "older than 5.4"],
			["gpt-5.1", "older than 5.4"],
			["gpt-4.1", "older major version"],
			["gpt-5", "no minor version"],
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
			expect(filterOne("gpt-5.0", { family: undefined })).toBeUndefined();
		});
	});

	describe("context window adjustment", () => {
		it.each([
			"gpt-5.5",
			"gpt-5.6-terra",
			"gpt-6.0",
		])("scales %s maxInputTokens down to the effective Codex budget", (id) => {
			const maxInputTokens = 200_000;
			const result = filterOne(id, { maxInputTokens });
			expect(result?.maxInputTokens).toBe(
				maxInputTokens * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
			);
		});

		it("caps limits at the ChatGPT backend budget when the API catalog advertises more", () => {
			const result = filterOne("gpt-5.6-terra", {
				contextWindow: 1_050_000,
				maxInputTokens: 922_000,
				maxTokens: 900_000,
			});
			expect(result).toMatchObject({
				contextWindow: 400_000,
				maxInputTokens: 272_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
				maxTokens: 128_000,
			});
		});

		it("keeps smaller catalog limits untouched", () => {
			const result = filterOne("gpt-5.3-codex-spark", {
				contextWindow: 128_000,
				maxInputTokens: 100_000,
				maxTokens: 32_000,
			});
			expect(result).toMatchObject({
				contextWindow: 128_000,
				maxInputTokens: 100_000 * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
				maxTokens: 32_000,
			});
		});

		it("preserves undefined limits instead of producing NaN", () => {
			const result = filterOne("gpt-6.0", {
				contextWindow: undefined,
				maxInputTokens: undefined,
				maxTokens: undefined,
			});
			expect(result?.contextWindow).toBeUndefined();
			expect(result?.maxInputTokens).toBeUndefined();
			expect(result?.maxTokens).toBeUndefined();
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
			"gpt-5.4": makeModel("gpt-5.4"),
			"gpt-5.6": makeModel("gpt-5.6"),
			"gpt-5.6-sol": makeModel("gpt-5.6-sol"),
			"gpt-6.0": makeModel("gpt-6.0"),
			"gpt-5.1": makeModel("gpt-5.1"),
			"o4-mini": makeModel("o4-mini", { family: "o4" }),
		};
		expect(Object.keys(filterOpenAICodexModels(models)).sort()).toEqual([
			"gpt-5.5",
			"gpt-5.6-sol",
			"gpt-6.0",
		]);
	});
});
