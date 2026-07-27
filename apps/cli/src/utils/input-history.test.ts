import { describe, expect, it } from "vitest";
import { prependInputHistoryEntry } from "./input-history";

describe("input history entries", () => {
	it("prepends new prompts for most-recent-first navigation", () => {
		expect(prependInputHistoryEntry(["second", "first"], "third")).toEqual([
			"third",
			"second",
			"first",
		]);
	});

	it("moves duplicate prompts to the front", () => {
		expect(prependInputHistoryEntry(["second", "first"], "first")).toEqual([
			"first",
			"second",
		]);
	});

	it("trims whitespace-only prompts", () => {
		expect(prependInputHistoryEntry(["second"], "   ")).toEqual(["second"]);
	});

	it("caps entries at the requested maximum", () => {
		expect(prependInputHistoryEntry(["two", "one"], "three", 2)).toEqual([
			"three",
			"two",
		]);
	});
});
