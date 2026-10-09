import { describe, expect, it } from "vitest";
import {
	sliceHeadAtCodePointBoundary,
	sliceTailAtCodePointBoundary,
	stripUtf8Bom,
	trimNonEmpty,
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
/**
 * Indexes of unpaired UTF-16 surrogates (the halves a split code point leaves
 * behind). A string with none survives a UTF-8 round trip byte-for-byte, which
 * is what this suite asserts on the slices themselves.
 */
function loneSurrogateIndexes(text: string): number[] {
	const indexes: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const previous = text.charCodeAt(i - 1);
		const next = text.charCodeAt(i + 1);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				indexes.push(i);
			}
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			if (!(previous >= 0xd800 && previous <= 0xdbff)) {
				indexes.push(i);
			}
		}
	}
	return indexes;
}

/** Round-trips through UTF-8 the way a JSON body, log line or tty write does. */
function utf8RoundTrip(text: string): string {
	return Buffer.from(text, "utf8").toString("utf8");
}

const GAMEPAD = "\u{1F3AE}"; // 🎮 — one code point, two UTF-16 units
const GLOBE = "\u{1F30D}"; // 🌍 — ditto

describe("sliceHeadAtCodePointBoundary", () => {
	it("never ends on the high half of a surrogate pair", () => {
		// `keep` counts UTF-16 units, so every odd offset inside a run of
		// astral characters lands midway through one of them.
		const text = GAMEPAD.repeat(6);
		for (let keep = 0; keep <= text.length; keep++) {
			const head = sliceHeadAtCodePointBoundary(text, keep);
			expect(loneSurrogateIndexes(head)).toEqual([]);
			expect(utf8RoundTrip(head)).toBe(head);
		}
	});

	it("drops the straddled code point instead of half of it", () => {
		// 3 units cannot hold 🎮🎮 (4 units), so the cut retreats to one glyph.
		expect(sliceHeadAtCodePointBoundary(`${GAMEPAD}${GAMEPAD}`, 3)).toBe(
			GAMEPAD,
		);
		// An even cut sits between the pair members and needs no adjustment.
		expect(sliceHeadAtCodePointBoundary(`${GAMEPAD}${GAMEPAD}`, 2)).toBe(
			GAMEPAD,
		);
	});

	it("leaves text outside the cut unchanged", () => {
		expect(sliceHeadAtCodePointBoundary("plain ascii", 5)).toBe("plain");
		expect(sliceHeadAtCodePointBoundary("", 5)).toBe("");
		expect(sliceHeadAtCodePointBoundary("plain", 0)).toBe("");
		expect(sliceHeadAtCodePointBoundary("plain", -3)).toBe("");
		expect(sliceHeadAtCodePointBoundary("plain", 99)).toBe("plain");
	});

	it("does not invent surrogates out of already-unpaired input", () => {
		// A lone high surrogate that is not followed by a low surrogate is not a
		// pair being split, so the boundary must not be shifted for it.
		expect(sliceHeadAtCodePointBoundary("a\uD83Cb", 2)).toBe("a\uD83C");
	});
});

describe("sliceTailAtCodePointBoundary", () => {
	it("never starts on the low half of a surrogate pair", () => {
		const text = GLOBE.repeat(6);
		for (let keep = 0; keep <= text.length; keep++) {
			const tail = sliceTailAtCodePointBoundary(text, keep);
			expect(loneSurrogateIndexes(tail)).toEqual([]);
			expect(utf8RoundTrip(tail)).toBe(tail);
		}
	});

	it("skips past the straddled code point instead of keeping half of it", () => {
		// 3 units from the end start inside the first 🎮, so the tail begins at
		// the second one.
		expect(sliceTailAtCodePointBoundary(`${GLOBE}${GLOBE}`, 3)).toBe(GLOBE);
		expect(sliceTailAtCodePointBoundary(`${GLOBE}${GLOBE}`, 2)).toBe(GLOBE);
	});

	it("leaves text outside the cut unchanged", () => {
		expect(sliceTailAtCodePointBoundary("plain ascii", 3)).toBe("cii");
		expect(sliceTailAtCodePointBoundary("", 5)).toBe("");
		expect(sliceTailAtCodePointBoundary("plain", 0)).toBe("");
		expect(sliceTailAtCodePointBoundary("plain", -3)).toBe("");
		expect(sliceTailAtCodePointBoundary("plain", 99)).toBe("plain");
	});

	it("does not invent surrogates out of already-unpaired input", () => {
		expect(sliceTailAtCodePointBoundary("a\uDFAEb", 2)).toBe("\uDFAEb");
	});
});

describe("truncateStr", () => {
	it("does not split a code point at the cut", () => {
		const truncated = truncateStr(GAMEPAD.repeat(3), 4);
		expect(loneSurrogateIndexes(truncated)).toEqual([]);
		expect(utf8RoundTrip(truncated)).toBe(truncated);
		expect(truncated).toBe(`${GAMEPAD}…`);
	});

	it("leaves shorter strings alone", () => {
		expect(truncateStr("short", 40)).toBe("short");
	});
});
