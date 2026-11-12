import { describe, expect, it } from "vitest";
import { parsePositiveInt } from "./positive-int";

describe("parsePositiveInt", () => {
	it.each([
		["1", 1],
		["600", 600],
		[" 30 ", 30],
	])("accepts %j", (raw, expected) => {
		expect(parsePositiveInt(raw)).toBe(expected);
	});

	it.each([
		"10m",
		"1h",
		"1.5",
		"1e3",
		"3x",
		"0x10",
		"-1",
		"0",
		"",
		"abc",
		"99999999999999999999",
	])("rejects %j", (raw) => {
		expect(parsePositiveInt(raw)).toBeUndefined();
	});
});
