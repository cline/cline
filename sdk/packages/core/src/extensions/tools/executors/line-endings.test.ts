import { describe, expect, it } from "vitest";
import { normalizeNewFileContent } from "./line-endings";

describe("normalizeNewFileContent", () => {
	it("converts LF content to CRLF when the platform EOL is CRLF", () => {
		expect(normalizeNewFileContent("one\ntwo\nthree", "\r\n")).toBe(
			"one\r\ntwo\r\nthree",
		);
	});

	it("leaves LF content unchanged when the platform EOL is LF", () => {
		expect(normalizeNewFileContent("one\ntwo\n", "\n")).toBe("one\ntwo\n");
	});

	it("keeps content with an explicit CRLF uniformly CRLF on LF platforms", () => {
		expect(normalizeNewFileContent("one\r\ntwo\nthree", "\n")).toBe(
			"one\r\ntwo\r\nthree",
		);
	});
});
