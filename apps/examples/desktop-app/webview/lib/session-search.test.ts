import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import {
	clampMatchIndex,
	findMatchOffsets,
	findSessionMatches,
	formatMatchCount,
	isActiveSearchQuery,
	isSearchableMessage,
	locateOffsetInSegments,
	matchesSearchQuery,
	stepMatchIndex,
} from "@/lib/session-search";

function message(role: ChatMessage["role"]): ChatMessage {
	return {
		id: `${role}_1`,
		sessionId: "session_1",
		role,
		content: "content",
		createdAt: 0,
	};
}

describe("isSearchableMessage", () => {
	it("searches the roles that render as prose", () => {
		for (const role of ["user", "assistant", "error"] as const) {
			expect(isSearchableMessage(message(role))).toBe(true);
		}
	});

	it("skips tool and status roles that have no prose bubble", () => {
		for (const role of ["tool", "status", "system"] as const) {
			expect(isSearchableMessage(message(role))).toBe(false);
		}
	});
});

describe("isActiveSearchQuery", () => {
	it("treats blank and whitespace-only queries as inactive", () => {
		expect(isActiveSearchQuery("")).toBe(false);
		expect(isActiveSearchQuery("   ")).toBe(false);
		expect(isActiveSearchQuery("\t\n")).toBe(false);
	});

	it("treats any non-blank query as active", () => {
		expect(isActiveSearchQuery("a")).toBe(true);
		expect(isActiveSearchQuery("  padded  ")).toBe(true);
	});
});

describe("matchesSearchQuery", () => {
	it("matches substrings regardless of case", () => {
		expect(matchesSearchQuery("Refactor the Parser", "parser")).toBe(true);
		expect(matchesSearchQuery("refactor the parser", "PARSER")).toBe(true);
		expect(matchesSearchQuery("refactor the parser", "fact")).toBe(true);
	});

	it("does not match a missing substring", () => {
		expect(matchesSearchQuery("refactor the parser", "lexer")).toBe(false);
	});

	it("treats the query literally rather than as a regular expression", () => {
		expect(matchesSearchQuery("cost is 12 dollars", "1.")).toBe(false);
		expect(matchesSearchQuery("literal a.b match", "a.b")).toBe(true);
	});

	it("never matches on an inactive query", () => {
		expect(matchesSearchQuery("anything", "")).toBe(false);
		expect(matchesSearchQuery("anything", "   ")).toBe(false);
	});
});

describe("findSessionMatches", () => {
	const entries = [
		{ messageId: "m1", text: "Fix the parser bug" },
		{ messageId: "m2", text: "Unrelated note" },
		{ messageId: "m3", text: "PARSER rewrite, parser cleanup, parser tests" },
	];

	it("returns matches in transcript order with sequential ordinals", () => {
		expect(findSessionMatches(entries, "parser")).toEqual([
			{ messageId: "m1", ordinal: 0 },
			{ messageId: "m3", ordinal: 1 },
		]);
	});

	it("counts a message once even when it contains the query repeatedly", () => {
		expect(findSessionMatches([entries[2]], "parser")).toHaveLength(1);
	});

	it("returns nothing for an inactive query", () => {
		expect(findSessionMatches(entries, "  ")).toEqual([]);
	});

	it("returns nothing when no entry matches", () => {
		expect(findSessionMatches(entries, "lexer")).toEqual([]);
	});
});

describe("findMatchOffsets", () => {
	it("returns every occurrence as half-open offsets", () => {
		expect(findMatchOffsets("parser and parser", "parser")).toEqual([
			{ start: 0, end: 6 },
			{ start: 11, end: 17 },
		]);
	});

	it("finds occurrences regardless of case", () => {
		expect(findMatchOffsets("PARSER parser", "Parser")).toEqual([
			{ start: 0, end: 6 },
			{ start: 7, end: 13 },
		]);
	});

	it("does not return overlapping occurrences", () => {
		expect(findMatchOffsets("aaaa", "aa")).toEqual([
			{ start: 0, end: 2 },
			{ start: 2, end: 4 },
		]);
	});

	it("slices the exact matched text", () => {
		const text = "the parser here";
		const [offset] = findMatchOffsets(text, "PARSER");
		expect(text.slice(offset.start, offset.end)).toBe("parser");
	});

	it("returns nothing for inactive queries or empty text", () => {
		expect(findMatchOffsets("parser", "")).toEqual([]);
		expect(findMatchOffsets("parser", "   ")).toEqual([]);
		expect(findMatchOffsets("", "parser")).toEqual([]);
	});

	it("returns nothing when the query is longer than the text", () => {
		expect(findMatchOffsets("ab", "abcdef")).toEqual([]);
	});
});

describe("locateOffsetInSegments", () => {
	// Segments of 5, 0 and 4 characters: "hello" + "" + "here".
	const lengths = [5, 0, 4];

	it("locates an offset inside the first segment", () => {
		expect(locateOffsetInSegments(lengths, 0)).toEqual({
			segmentIndex: 0,
			offsetInSegment: 0,
		});
		expect(locateOffsetInSegments(lengths, 4)).toEqual({
			segmentIndex: 0,
			offsetInSegment: 4,
		});
	});

	it("locates an offset in a later segment, skipping empty ones", () => {
		expect(locateOffsetInSegments(lengths, 5)).toEqual({
			segmentIndex: 2,
			offsetInSegment: 0,
		});
		expect(locateOffsetInSegments(lengths, 7)).toEqual({
			segmentIndex: 2,
			offsetInSegment: 2,
		});
	});

	it("anchors a boundary offset to the earlier segment when preferring ends", () => {
		expect(
			locateOffsetInSegments(lengths, 5, { preferSegmentEnd: true }),
		).toEqual({ segmentIndex: 0, offsetInSegment: 5 });
	});

	it("resolves an offset at the very end of the text", () => {
		expect(locateOffsetInSegments(lengths, 9)).toEqual({
			segmentIndex: 2,
			offsetInSegment: 4,
		});
		expect(
			locateOffsetInSegments(lengths, 9, { preferSegmentEnd: true }),
		).toEqual({ segmentIndex: 2, offsetInSegment: 4 });
	});

	it("returns null for offsets outside the text", () => {
		expect(locateOffsetInSegments(lengths, 10)).toBeNull();
		expect(locateOffsetInSegments(lengths, -1)).toBeNull();
		expect(locateOffsetInSegments([], 0)).toBeNull();
	});
});

describe("stepMatchIndex", () => {
	it("advances forward and wraps past the last match", () => {
		expect(stepMatchIndex(0, 3, "next")).toBe(1);
		expect(stepMatchIndex(1, 3, "next")).toBe(2);
		expect(stepMatchIndex(2, 3, "next")).toBe(0);
	});

	it("advances backward and wraps past the first match", () => {
		expect(stepMatchIndex(2, 3, "previous")).toBe(1);
		expect(stepMatchIndex(1, 3, "previous")).toBe(0);
		expect(stepMatchIndex(0, 3, "previous")).toBe(2);
	});

	it("stays put when there is a single match", () => {
		expect(stepMatchIndex(0, 1, "next")).toBe(0);
		expect(stepMatchIndex(0, 1, "previous")).toBe(0);
	});

	it("returns zero when there are no matches", () => {
		expect(stepMatchIndex(0, 0, "next")).toBe(0);
		expect(stepMatchIndex(4, 0, "previous")).toBe(0);
	});

	it("recovers from an index left over from a longer match list", () => {
		expect(stepMatchIndex(9, 3, "next")).toBe(0);
		expect(stepMatchIndex(9, 3, "previous")).toBe(1);
	});
});

describe("clampMatchIndex", () => {
	it("keeps valid indexes untouched", () => {
		expect(clampMatchIndex(0, 3)).toBe(0);
		expect(clampMatchIndex(2, 3)).toBe(2);
	});

	it("clamps indexes that fall outside the match list", () => {
		expect(clampMatchIndex(7, 3)).toBe(2);
		expect(clampMatchIndex(-1, 3)).toBe(0);
		expect(clampMatchIndex(1, 0)).toBe(0);
	});
});

describe("formatMatchCount", () => {
	it("renders a one-based position out of the total", () => {
		expect(formatMatchCount(0, 12, "parser")).toBe("1 of 12");
		expect(formatMatchCount(2, 12, "parser")).toBe("3 of 12");
	});

	it("reports an empty result set", () => {
		expect(formatMatchCount(0, 0, "parser")).toBe("No results");
	});

	it("announces nothing until a query is entered", () => {
		expect(formatMatchCount(0, 0, "")).toBe("");
		expect(formatMatchCount(0, 0, "   ")).toBe("");
	});

	it("clamps a stale index rather than reporting past the total", () => {
		expect(formatMatchCount(9, 2, "parser")).toBe("2 of 2");
	});
});
