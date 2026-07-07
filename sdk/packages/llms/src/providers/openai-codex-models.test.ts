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
			["gpt-5.4", true],
			["gpt-5.5", true],
			["gpt-5.5-codex", true],
			["gpt-6.0", true],
			["gpt-10.1", true],
		])("allows %s (newer than 5.3)", (id, allowed) => {
			expect(filterOne(id) !== undefined).toBe(allowed);
		});

		it.each([
			["gpt-5.3", "at the 5.3 cutoff"],
			["gpt-5.1", "older than 5.3"],
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
		it("scales maxInputTokens down to the effective Codex budget", () => {
			const maxInputTokens = 200_000;
			const result = filterOne("gpt-6.0", { maxInputTokens });
			expect(result?.maxInputTokens).toBe(
				maxInputTokens * CODEX_EFFECTIVE_CONTEXT_WINDOW_PERCENT,
			);
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
			"gpt-6.0",
		]);
	});
});
