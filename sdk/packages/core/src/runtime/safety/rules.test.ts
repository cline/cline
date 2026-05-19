import { describe, expect, it } from "vitest";
import { mergeRulesForSystemPrompt } from "./rules";

describe("mergeRulesForSystemPrompt", () => {
	it("returns additional rules when watcher rules are absent", () => {
		expect(mergeRulesForSystemPrompt(undefined, "inline rules")).toBe(
			"inline rules",
		);
	});

	it("returns watcher rules when inline rules are absent", () => {
		expect(mergeRulesForSystemPrompt("watcher rules", undefined)).toBe(
			"watcher rules",
		);
	});

	it("appends inline rules after watcher rules", () => {
		expect(mergeRulesForSystemPrompt("watcher rules", "inline rules")).toBe(
			"watcher rules\n\ninline rules",
		);
	});
});
