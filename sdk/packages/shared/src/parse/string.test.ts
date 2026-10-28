import { describe, expect, it } from "vitest";
import {
	sliceUtf16,
	stripUtf8Bom,
	trimNonEmpty,
	truncateSplit,
	truncateStr,
} from "./string";

describe("trimNonEmpty", () => {
	it("returns trimmed strings and omits empty values", () => {
		expect(trimNonEmpty("  session-id  ")).toBe("session-id");
		expect(trimNonEmpty("   ")).toBeUndefined();
		expect(trimNonEmpty("")).toBeUndefined();
		expect(trimNonEmpty(undefined)).toBeUndefined();
		expect(trimNonEmpty(null)).toBeUndefined();
	});
});

describe("stripUtf8Bom", () => {
	it("removes a leading BOM character", () => {
		expect(stripUtf8Bom("\uFEFF---\nname: foo\n---\n")).toBe(
			"---\nname: foo\n---\n",
		);
	});

	it("leaves text without a BOM unchanged", () => {
		expect(stripUtf8Bom("---\nname: foo\n---\n")).toBe("---\nname: foo\n---\n");
	});

	it("only strips a BOM at the start of the string", () => {
		expect(stripUtf8Bom("a\uFEFFb")).toBe("a\uFEFFb");
	});

	it("handles empty strings", () => {
		expect(stripUtf8Bom("")).toBe("");
	});
});

describe("string truncation", () => {
	it.each([
		["truncateStr", () => truncateStr("a😀bc", 3), "a…"],
		["truncateSplit prefix", () => truncateSplit("a😀bc/rest", "/", 3), "a…"],
		["truncateSplit fallback", () => truncateSplit("/a😀bc", "/", 4), "/a…"],
	])("%s does not split a surrogate pair", (_name, truncate, expected) => {
		const result = truncate();
		expect(Buffer.from(result).toString("utf8")).toBe(result);
		expect(result).toBe(expected);
	});

	it("omits a pair when only one code unit fits", () => {
		expect(truncateStr("😀ab", 2)).toBe("…");
		expect(truncateSplit("😀ab/rest", "/", 2)).toBe("…");
	});

	it("preserves ASCII and no-truncation behavior", () => {
		expect(truncateStr("abcdef", 4)).toBe("abc…");
		expect(truncateSplit("abcdef/rest", "/", 4)).toBe("abc…");
		expect(truncateStr("a😀", 3)).toBe("a😀");
		expect(truncateSplit("a😀", "/", 3)).toBe("a😀");
	});
});

describe("sliceUtf16", () => {
	it.each([
		[0, 2, "a"],
		[2, 4, "b"],
		[1, 3, "😀"],
		[2, 2, ""],
		[3, 1, ""],
		[-2, undefined, "b"],
		[0, -2, "a"],
		[-100, 100, "a😀b"],
		[0.9, 2.9, "a"],
		[Number.NaN, Number.POSITIVE_INFINITY, "a😀b"],
	])("slices inward at offsets %s to %s", (start, end, expected) => {
		const result = sliceUtf16("a😀b", start, end);
		expect(result).toBe(expected);
		expect(Buffer.from(result).toString("utf8")).toBe(result);
	});

	it.each([
		[0, 2],
		[2, undefined],
	])("preserves consecutive pairs at offsets %s to %s", (start, end) => {
		expect(sliceUtf16("😀😀", start, end)).toBe("😀");
	});

	it("does not remove existing lone surrogates", () => {
		expect(sliceUtf16("\uD83Dx\uDE00", 0)).toBe("\uD83Dx\uDE00");
	});
});
