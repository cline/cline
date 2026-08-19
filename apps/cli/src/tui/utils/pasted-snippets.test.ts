import { describe, expect, it } from "vitest";
import {
	countPastedTextLines,
	createUniquePastedTextSnippetMarker,
	expandPastedTextSnippets,
	formatPastedTextSnippetMarker,
	shouldCompactPastedText,
} from "./pasted-snippets";

describe("pasted text snippet helpers", () => {
	it("counts pasted lines across newline formats", () => {
		expect(countPastedTextLines("one\ntwo\r\nthree\rfour")).toBe(4);
		expect(countPastedTextLines("one\ntwo\nthree\nfour\n")).toBe(4);
	});

	it("compacts pastes at the large paste line threshold", () => {
		expect(shouldCompactPastedText("one\ntwo\nthree\nfour")).toBe(false);
		expect(shouldCompactPastedText("one\ntwo\nthree\nfour\n")).toBe(false);
		expect(shouldCompactPastedText("one\ntwo\nthree\nfour\nfive")).toBe(true);
	});

	it("formats a compact single-line marker with preview text", () => {
		expect(formatPastedTextSnippetMarker("alpha\nbeta\ngamma")).toBe(
			"[alpha beta gamma... Pasted +3 lines]",
		);
	});

	it("keeps markers unique when previews collide", () => {
		const marker = formatPastedTextSnippetMarker("alpha\nbeta\ngamma");

		expect(
			createUniquePastedTextSnippetMarker("alpha\nbeta\ngamma", [marker]),
		).toBe("[alpha beta gamma... Pasted +3 lines #2]");
	});

	it("expands pasted snippet markers before submission", () => {
		expect(
			expandPastedTextSnippets("before [snippet] after", [
				{ marker: "[snippet]", text: "line 1\nline 2" },
			]),
		).toBe("before line 1\nline 2 after");
	});
});
