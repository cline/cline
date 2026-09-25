import { describe, expect, it } from "vitest";
import { annotateToolResultTruncation } from "./tool-result-recovery";

describe("tool result truncation line markers", () => {
	it("places file line coordinates inside the truncation marker", () => {
		const middle = Array.from({ length: 50 }, (_, i) => `line ${i + 2}`).join(
			"\n",
		);
		const preview = annotateToolResultTruncation(
			`first\n${middle}\nlast`,
			"first\n...[truncated 300 chars]...\nlast",
		);
		expect(preview).toBe(
			"first\n...[truncated 300 chars; omitted content within saved-file lines 2-51]...\nlast",
		);
	});

	it("includes partially retained boundary lines", () => {
		expect(
			annotateToolResultTruncation(
				"first\nprefix OMITTED suffix\nlast",
				"first\nprefix ...[truncated 7 chars]... suffix\nlast",
			),
		).toContain("saved-file lines 2-2");
	});

	it("uses saved JSON lines instead of escaped embedded newlines", () => {
		const preview = annotateToolResultTruncation(
			[{ type: "text", text: "first\nmissing\nlast" }],
			[{ type: "text", text: "first\n...[truncated 7 chars]...\nlast" }],
		);
		expect(JSON.stringify(preview)).toContain("saved-file lines 4-4");
	});

	it("encloses multiple omissions after aggregate budgeting without mutating input", () => {
		const original = "first\none\nretained\ntwo\nlast";
		const preview =
			"first\n...[truncated 3 chars]...\nretained\n...[truncated 3 chars to fit provider request budget]...\nlast";
		const annotated = annotateToolResultTruncation(original, preview);
		expect(annotated).toContain(
			"truncated 3 chars; omitted content within saved-file lines 2-4",
		);
		expect(annotated).toContain(
			"provider request budget; omitted content within saved-file lines 2-4",
		);
		expect(preview).not.toContain("saved-file");
	});
});
