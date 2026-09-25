import { describe, expect, it } from "vitest";
import { formatToolResultRecoveryNotice } from "./tool-result-recovery";

describe("tool result recovery guidance", () => {
	it("identifies omitted lines and gives an inclusive, bounded read request", () => {
		const middle = Array.from({ length: 50 }, (_, i) => `line ${i + 2}`).join(
			"\n",
		);
		const notice = formatToolResultRecoveryNotice(
			"/session/tools/call.result.txt",
			`first\n${middle}\nlast`,
			"first\n[truncated]\nlast",
		);
		expect(notice).toContain("saved-file lines 2-51");
		expect(notice).toContain('"start_line":2,"end_line":21');
		expect(notice).toContain("Search this file");
		expect(notice).toContain(
			"Reading the whole file or very long lines may be truncated again",
		);
	});

	it("includes partially retained boundary lines", () => {
		const notice = formatToolResultRecoveryNotice(
			"/result.txt",
			"first\nprefix OMITTED suffix\nlast",
			"first\nprefix [truncated] suffix\nlast",
		);
		expect(notice).toContain("saved-file lines 2-2");
		expect(notice).toContain('"start_line":2,"end_line":2');
	});

	it("uses saved JSON file lines rather than escaped embedded newlines", () => {
		const notice = formatToolResultRecoveryNotice(
			"/result.txt",
			[{ type: "text", text: "first\nmissing\nlast" }],
			[{ type: "text", text: "first\n[truncated]\nlast" }],
		);
		expect(notice).toContain("saved-file lines 4-4");
		expect(notice).toContain("selected JSON fields");
	});

	it("encloses independent omissions without claiming every line was removed", () => {
		const notice = formatToolResultRecoveryNotice(
			"/result.txt",
			"first\none\nretained\ntwo\nlast",
			"first\n[truncated]\nretained\n[truncated]\nlast",
		);
		expect(notice).toContain("saved-file lines 2-4");
		expect(notice).toContain("this range may also include retained content");
	});

	it("handles a single long line and escapes paths in the read example", () => {
		const notice = formatToolResultRecoveryNotice(
			'/a"b.txt',
			"a".repeat(10000),
			"aaa[truncated]aaa",
		);
		expect(notice).toContain("saved-file lines 1-1");
		expect(notice).toContain(
			JSON.stringify({
				files: [{ path: '/a"b.txt', start_line: 1, end_line: 1 }],
			}),
		);
		expect(notice).toContain("extract bounded text");
	});
});
