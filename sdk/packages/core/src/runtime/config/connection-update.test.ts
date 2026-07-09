import { describe, expect, it } from "vitest";
import { buildConnectionUpdate } from "./connection-update";

describe("buildConnectionUpdate", () => {
	const base = {
		providerId: "openai",
		modelId: "codex-test",
		apiKey: "sk-test",
	};

	it("includes only the connection fields that are defined", () => {
		expect(buildConnectionUpdate(base)).toEqual(base);
		expect(
			buildConnectionUpdate({
				...base,
				baseUrl: "https://example.test",
				headers: { "x-a": "1" },
			}),
		).toEqual({
			...base,
			baseUrl: "https://example.test",
			headers: { "x-a": "1" },
		});
	});

	it("passes an empty string through so callers can clear a field", () => {
		expect(buildConnectionUpdate({ ...base, apiKey: "" })).toEqual({
			...base,
			apiKey: "",
		});
	});

	it("clears reasoning when thinking is explicitly false", () => {
		expect(
			buildConnectionUpdate({
				...base,
				thinking: false,
				reasoningEffort: "high",
				thinkingBudgetTokens: 1024,
			}),
		).toEqual({
			...base,
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});
	});

	it("enables reasoning with the selected effort", () => {
		expect(
			buildConnectionUpdate({
				...base,
				thinking: true,
				reasoningEffort: "low",
			}),
		).toEqual({
			...base,
			thinking: true,
			reasoningEffort: "low",
			thinkingBudgetTokens: null,
		});
	});

	it("clears stale effort and budget when thinking is enabled without them", () => {
		expect(buildConnectionUpdate({ ...base, thinking: true })).toEqual({
			...base,
			thinking: true,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});
	});

	it("keeps a provided budget when thinking is enabled explicitly", () => {
		expect(
			buildConnectionUpdate({
				...base,
				thinking: true,
				thinkingBudgetTokens: 1024,
			}),
		).toEqual({
			...base,
			thinking: true,
			reasoningEffort: null,
			thinkingBudgetTokens: 1024,
		});
	});

	it("enables thinking when only an effort is provided", () => {
		expect(
			buildConnectionUpdate({ ...base, reasoningEffort: "medium" }),
		).toEqual({ ...base, thinking: true, reasoningEffort: "medium" });
	});

	it("enables thinking and truncates a fractional budget", () => {
		expect(
			buildConnectionUpdate({ ...base, thinkingBudgetTokens: 2048.7 }),
		).toEqual({ ...base, thinking: true, thinkingBudgetTokens: 2048 });
	});

	it("leaves reasoning untouched when thinking is unset", () => {
		expect(buildConnectionUpdate(base)).toEqual(base);
	});
});
