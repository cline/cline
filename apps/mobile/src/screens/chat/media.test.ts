import { describe, expect, it } from "vitest";
import { extractToolOutputMedia, redactToolOutputMedia } from "./media";

describe("tool output media", () => {
	it("extracts nested image blocks and removes base64 from the text preview", () => {
		const output = {
			result: [
				{ type: "text", text: "Screenshot captured" },
				{ type: "image", data: "aGVsbG8=", mediaType: "image/png" },
			],
		};
		expect(extractToolOutputMedia(output)).toMatchObject([
			{ modality: "image", mediaType: "image/png" },
		]);
		expect(JSON.stringify(redactToolOutputMedia(output))).not.toContain(
			"aGVsbG8=",
		);
		expect(JSON.stringify(redactToolOutputMedia(output))).toContain(
			"[image attachment]",
		);
	});

	it("bounds traversal and ignores malformed media", () => {
		expect(extractToolOutputMedia({ type: "image", data: "bytes" })).toEqual(
			[],
		);
		const recursive: Record<string, unknown> = {};
		recursive.self = recursive;
		expect(extractToolOutputMedia(recursive)).toEqual([]);
	});
});
