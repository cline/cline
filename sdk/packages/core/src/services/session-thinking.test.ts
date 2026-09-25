import { describe, expect, it } from "vitest";
import {
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
