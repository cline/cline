import { describe, expect, it } from "vitest";
import {
	CloudHandoffTranscriptMismatchError,
	cloudHandoffTranscriptsEqual,
} from "./transcript";

describe("cloud handoff transcript comparison", () => {
	it("compares roles and rich image content using the durable JSON shape", () => {
		const expected = [
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect this", optional: undefined },
					{ type: "image", data: "abc", mediaType: "image/png" },
				],
				metadata: { localOnly: true },
			},
		];
		expect(
			cloudHandoffTranscriptsEqual(expected, [
				{
					role: "user",
					content: [
						{ type: "text", text: "inspect this" },
						{ type: "image", data: "abc", mediaType: "image/png" },
					],
					metadata: { cloudOnly: true },
				},
			]),
		).toBe(true);
		expect(
			cloudHandoffTranscriptsEqual(expected, [
				{
					role: "user",
					content: [
						{ type: "text", text: "inspect this" },
						{ type: "image", data: "xyz", mediaType: "image/png" },
					],
				},
			]),
		).toBe(false);
	});

	it("provides a typed mismatch error", () => {
		expect(new CloudHandoffTranscriptMismatchError(2, 1).message).toContain(
			"local 2 messages, cloud 1",
		);
	});
});
