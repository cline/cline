import { type ParsedKey, parseKeypress } from "@opentui/core";
import { describe, expect, it } from "vitest";
import {
	getPrintableKeyText,
	normalizePastedAnswer,
	removeLastGrapheme,
} from "./ask-question-input";

function parse(input: string): ParsedKey {
	const key = parseKeypress(input);
	if (!key) throw new Error(`OpenTUI did not parse ${JSON.stringify(input)}`);
	return key;
}

describe("getPrintableKeyText", () => {
	it.each([
		["a", "a"],
		["A", "A"],
		["1", "1"],
		["!", "!"],
		[" ", " "],
		["é", "é"],
		["😀", "😀"],
	])("preserves printable terminal input %j", (input, expected) => {
		expect(getPrintableKeyText(parse(input))).toBe(expected);
	});

	it.each([
		"\u0010",
		"\u001bx",
		"\u001b[A",
		"\u007f",
	])("ignores shortcut and navigation input %j", (input) => {
		expect(getPrintableKeyText(parse(input))).toBeNull();
	});

	it.each([
		"super",
		"hyper",
	] as const)("ignores printable input with the %s modifier", (modifier) => {
		expect(
			getPrintableKeyText({
				ctrl: false,
				meta: false,
				super: modifier === "super",
				hyper: modifier === "hyper",
				sequence: "a",
			}),
		).toBeNull();
	});
});

describe("removeLastGrapheme", () => {
	it.each([
		["", ""],
		["abc", "ab"],
		["a𠮷", "a"],
		["a😀", "a"],
		["aé", "a"],
		["a🇯🇵", "a"],
		["a👨‍👩‍👧‍👦", "a"],
	])("removes the last complete grapheme from %j", (input, expected) => {
		expect(removeLastGrapheme(input)).toBe(expected);
	});
});

describe("normalizePastedAnswer", () => {
	it.each([
		["", ""],
		["hello", "hello"],
		["  hello world  ", "hello world"],
		["first line\nsecond line", "first line second line"],
		["first line\r\nsecond line\r\n", "first line second line"],
		["\n\n\r\n", ""],
		["foo   \n   bar", "foo bar"],
		["\x1b[31mred\x1b[0m text", "red text"],
	])("normalizes %j to %j", (input, expected) => {
		expect(normalizePastedAnswer(input)).toBe(expected);
	});
});

