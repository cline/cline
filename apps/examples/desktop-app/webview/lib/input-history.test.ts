// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
	INPUT_HISTORY_STORAGE_KEY,
	MAX_INPUT_HISTORY_ENTRIES,
	parseInputHistoryStorage,
	prependInputHistoryEntry,
	readInputHistoryFromWindow,
	writeInputHistoryToWindow,
} from "./input-history";

describe("parseInputHistoryStorage", () => {
	it("returns empty for null, invalid JSON, and non-array payloads", () => {
		expect(parseInputHistoryStorage(null)).toEqual([]);
		expect(parseInputHistoryStorage("")).toEqual([]);
		expect(parseInputHistoryStorage("not json")).toEqual([]);
		expect(
			parseInputHistoryStorage(JSON.stringify({ prompt: "nope" })),
		).toEqual([]);
		expect(parseInputHistoryStorage(JSON.stringify("string"))).toEqual([]);
	});

	it("keeps only non-empty strings and caps the list", () => {
		const raw = JSON.stringify(["kept", 42, null, "   ", "also kept", ""]);
		expect(parseInputHistoryStorage(raw)).toEqual(["kept", "also kept"]);
		const overflow = Array.from(
			{ length: MAX_INPUT_HISTORY_ENTRIES + 5 },
			(_, index) => `entry ${index}`,
		);
		expect(parseInputHistoryStorage(JSON.stringify(overflow))).toHaveLength(
			MAX_INPUT_HISTORY_ENTRIES,
		);
	});

	it("dedupes keeping the first occurrence, which is the newest", () => {
		const raw = JSON.stringify(["second", "first", "second", "first"]);
		expect(parseInputHistoryStorage(raw)).toEqual(["second", "first"]);
	});
});

describe("prependInputHistoryEntry", () => {
	it("ignores whitespace-only prompts", () => {
		const history = ["kept"];
		expect(prependInputHistoryEntry(history, "   ")).toEqual(["kept"]);
	});

	it("moves an existing entry to the front instead of duplicating it", () => {
		const history = ["newest", "middle", "oldest"];
		expect(prependInputHistoryEntry(history, "oldest")).toEqual([
			"oldest",
			"newest",
			"middle",
		]);
		expect(prependInputHistoryEntry(history, " brand new ")).toEqual([
			"brand new",
			"newest",
			"middle",
			"oldest",
		]);
	});

	it("trims to the cap, dropping the oldest entries", () => {
		const history = Array.from(
			{ length: MAX_INPUT_HISTORY_ENTRIES },
			(_, index) => `entry ${index}`,
		);
		const next = prependInputHistoryEntry(history, "the newest");
		expect(next).toHaveLength(MAX_INPUT_HISTORY_ENTRIES);
		expect(next[0]).toBe("the newest");
		expect(next).not.toContain("entry 19");
	});
});

describe("input history window storage", () => {
	beforeEach(() => {
		window.localStorage.removeItem(INPUT_HISTORY_STORAGE_KEY);
	});

	it("round-trips through localStorage", () => {
		expect(readInputHistoryFromWindow()).toEqual([]);
		writeInputHistoryToWindow(["one", "two"]);
		expect(readInputHistoryFromWindow()).toEqual(["one", "two"]);
		expect(window.localStorage.getItem(INPUT_HISTORY_STORAGE_KEY)).toBe(
			JSON.stringify(["one", "two"]),
		);
	});

	it("treats corrupted stored data as empty", () => {
		window.localStorage.setItem(INPUT_HISTORY_STORAGE_KEY, "{oops");
		expect(readInputHistoryFromWindow()).toEqual([]);
	});
});
