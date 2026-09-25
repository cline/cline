import { describe, expect, it } from "vitest";
import {
	CHARS_PER_TOKEN,
	estimateRequestInputTokens,
	estimateTokens,
} from "./tokens";

describe("estimateRequestInputTokens", () => {
	it("estimates text-only messages by char count", () => {
		const message = { role: "user", content: "hello world" };
		const tokens = estimateRequestInputTokens({ messages: [message] });
		expect(tokens).toBe(
			estimateTokens(
				JSON.stringify({
					systemPrompt: undefined,
					messages: [message],
					tools: undefined,
				}).length,
			),
		);
	});

	it("does not bill an image block's base64 payload at CHARS_PER_TOKEN", () => {
		// A realistic small PNG render: ~90KB of base64, well under what a
		// vision model actually charges (a few hundred to ~1.6k tokens).
		const base64Data = "A".repeat(90_000);
		const message = {
			role: "user",
			content: [{ type: "image", data: base64Data, mediaType: "image/png" }],
		};

		const tokens = estimateRequestInputTokens({ messages: [message] });

		// Charging the base64 payload at CHARS_PER_TOKEN would report roughly
		// 90_000 / CHARS_PER_TOKEN = 30_000 tokens for a single image. The real
		// cost tops out around ~1.6k tokens, so the estimate must stay far
		// below the naive char-based number.
		const naiveCharBasedEstimate = Math.ceil(
			base64Data.length / CHARS_PER_TOKEN,
		);
		expect(tokens).toBeLessThan(naiveCharBasedEstimate / 10);
		expect(tokens).toBeLessThan(2_000);
	});

	it("scales with image count, not with one large image's byte size", () => {
		// Nine images, one of them much larger than the rest (a mix of PDF
		// page renders and small icons, say). Real per-image cost depends on
		// pixel dimensions, not encoded byte size, so this should cost close
		// to 9x a single small image, not blow up because one image happens
		// to be a big base64 string.
		const smallImage = {
			type: "image",
			data: "B".repeat(1_000),
			mediaType: "image/png",
		};
		const oneSmallImage = estimateRequestInputTokens({
			messages: [{ role: "user", content: [smallImage] }],
		});
		const eightSmallPlusOneHuge = estimateRequestInputTokens({
			messages: [
				{
					role: "user",
					content: [
						...Array.from({ length: 8 }, () => smallImage),
						{
							type: "image",
							data: "C".repeat(500_000),
							mediaType: "image/png",
						},
					],
				},
			],
		});

		expect(eightSmallPlusOneHuge).toBeLessThan(oneSmallImage * 20);
	});
});
