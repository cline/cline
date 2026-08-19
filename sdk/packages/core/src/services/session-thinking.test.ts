import { describe, expect, it } from "vitest";
import {
	applySessionThinkingConnectionUpdate,
	hasCurrentSessionThinkingMetadata,
	readSessionThinkingMetadata,
	resolveSessionThinkingMetadata,
	withSessionThinkingMetadata,
} from "./session-thinking";

describe("resolveSessionThinkingMetadata", () => {
	it("records the level the user picked", () => {
		expect(
			resolveSessionThinkingMetadata({
				thinking: true,
				reasoningEffort: "high",
			}),
		).toEqual({ enabled: true, level: "high" });
	});

	it("treats an effort or budget alone as thinking enabled", () => {
		expect(resolveSessionThinkingMetadata({ reasoningEffort: "low" })).toEqual({
			enabled: true,
			level: "low",
		});
		expect(
			resolveSessionThinkingMetadata({ thinkingBudgetTokens: 4096 }),
		).toEqual({ enabled: true, budgetTokens: 4096 });
	});

	it("normalizes the level and drops unknown values", () => {
		expect(
			resolveSessionThinkingMetadata({
				thinking: true,
				reasoningEffort: "HIGH",
			}),
		).toEqual({ enabled: true, level: "high" });
		expect(
			resolveSessionThinkingMetadata({
				thinking: true,
				reasoningEffort: "turbo",
			}),
		).toEqual({ enabled: true });
	});

	it("records an explicit no-thinking choice", () => {
		expect(resolveSessionThinkingMetadata({})).toEqual({ enabled: false });
		expect(
			resolveSessionThinkingMetadata({
				thinking: false,
				reasoningEffort: "none",
			}),
		).toEqual({ enabled: false });
	});

	it("ignores non-positive budgets", () => {
		expect(
			resolveSessionThinkingMetadata({
				thinking: false,
				thinkingBudgetTokens: 0,
			}),
		).toEqual({ enabled: false });
	});
});

describe("applySessionThinkingConnectionUpdate", () => {
	it("keeps inherited reasoning on a partial budget update", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true, level: "high" },
				{ thinkingBudgetTokens: 2048 },
			),
		).toEqual({ enabled: true, level: "high", budgetTokens: 2048 });
	});

	it("keeps an existing budget on a level-only update", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true, budgetTokens: 4096 },
				{ reasoningEffort: "low" },
			),
		).toEqual({ enabled: true, level: "low", budgetTokens: 4096 });
	});

	it("keeps the current level when only the boolean is toggled on", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true, level: "medium" },
				{ thinking: true },
			),
		).toEqual({ enabled: true, level: "medium" });
	});

	it("clears level and budget when thinking is disabled", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true, level: "high", budgetTokens: 8192 },
				{ thinking: false },
			),
		).toEqual({ enabled: false });
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true, level: "high" },
				{ thinking: null, reasoningEffort: null, thinkingBudgetTokens: null },
			),
		).toEqual({ enabled: false });
	});

	it("disables the level-only state when its effort is cleared", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true, level: "high" },
				{ reasoningEffort: "none" },
			),
		).toEqual({ enabled: false });
	});

	it("stays enabled without a level when the boolean was explicit", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: true },
				{ thinkingBudgetTokens: null },
			),
		).toEqual({ enabled: true });
	});

	it("enables thinking from a disabled state via an effort", () => {
		expect(
			applySessionThinkingConnectionUpdate(
				{ enabled: false },
				{ reasoningEffort: "medium" },
			),
		).toEqual({ enabled: true, level: "medium" });
	});
});

describe("session thinking metadata round-trip", () => {
	it("stores the level under `thinking` without disturbing other keys", () => {
		const metadata = withSessionThinkingMetadata(
			{ title: "saved title", git: { branch: "main" } },
			{ enabled: true, level: "medium" },
		);
		expect(metadata).toEqual({
			title: "saved title",
			git: { branch: "main" },
			thinking: { enabled: true, level: "medium" },
		});
		expect(readSessionThinkingMetadata(metadata)).toEqual({
			enabled: true,
			level: "medium",
		});
	});

	it("overwrites a previously stored level", () => {
		const metadata = withSessionThinkingMetadata(
			{ thinking: { enabled: true, level: "high", budgetTokens: 8192 } },
			{ enabled: false },
		);
		expect(readSessionThinkingMetadata(metadata)).toEqual({ enabled: false });
	});

	it("reports missing metadata as unknown rather than disabled", () => {
		expect(readSessionThinkingMetadata(undefined)).toBeUndefined();
		expect(readSessionThinkingMetadata({ title: "x" })).toBeUndefined();
		expect(readSessionThinkingMetadata({ thinking: "high" })).toBeUndefined();
	});
});

describe("hasCurrentSessionThinkingMetadata", () => {
	it("detects matching and differing state", () => {
		const stored = { thinking: { enabled: true, level: "high" } };
		expect(
			hasCurrentSessionThinkingMetadata(stored, {
				enabled: true,
				level: "high",
			}),
		).toBe(true);
		expect(
			hasCurrentSessionThinkingMetadata(stored, {
				enabled: true,
				level: "low",
			}),
		).toBe(false);
		expect(hasCurrentSessionThinkingMetadata(stored, { enabled: false })).toBe(
			false,
		);
	});

	it("never matches when nothing was stored", () => {
		expect(
			hasCurrentSessionThinkingMetadata(undefined, { enabled: false }),
		).toBe(false);
	});
});
