import { describe, expect, it } from "vitest";
import {
	buildUserPromptDisplayLabel,
	buildUserPromptDisplayLabelFromCount,
	stripAttachedFilesSuffix,
} from "./attachments";

describe("user prompt display labels", () => {
	it("appends the attachment suffix only for non-image files", () => {
		const files = [
			new File(["a"], "a.txt", { type: "text/plain" }),
			new File(["b"], "b.png", { type: "image/png" }),
		];
		expect(buildUserPromptDisplayLabel("hello", files)).toBe(
			"hello\n\n[attached 1 file]",
		);
	});

	it("builds the same label from a count as from files", () => {
		const files = [
			new File(["a"], "a.txt", { type: "text/plain" }),
			new File(["b"], "b.txt", { type: "text/plain" }),
		];
		expect(buildUserPromptDisplayLabel("hello", files)).toBe(
			buildUserPromptDisplayLabelFromCount("hello", 2),
		);
	});

	it("omits the leading separator for an empty prompt", () => {
		expect(buildUserPromptDisplayLabelFromCount("", 2)).toBe(
			"[attached 2 files]",
		);
		expect(buildUserPromptDisplayLabelFromCount("  ", 0)).toBe("");
	});

	it("strips the attachment suffix back off a transcript label", () => {
		expect(
			stripAttachedFilesSuffix(
				buildUserPromptDisplayLabelFromCount("hello", 1),
			),
		).toBe("hello");
		expect(stripAttachedFilesSuffix("[attached 3 files]")).toBe("");
		expect(stripAttachedFilesSuffix("no suffix here")).toBe("no suffix here");
	});
});
