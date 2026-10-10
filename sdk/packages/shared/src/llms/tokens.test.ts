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

	it("does not bill an AgentImagePart's base64 payload at CHARS_PER_TOKEN", () => {
		// AgentMessage (sdk/packages/shared/src/agent.ts) carries its image
		// payload under `image`, not `data` — this is the shape gateway.ts
		// builds (agent-message-codec.ts) and passes to
		// estimateRequestInputTokens on every streamed request, distinct
		// from the ImageContent `{ data }` shape compaction uses.
		const base64Data = "A".repeat(90_000);
		const message = {
			role: "user",
			content: [{ type: "image", image: base64Data, mediaType: "image/png" }],
		};

		const tokens = estimateRequestInputTokens({ messages: [message] });

		const naiveCharBasedEstimate = Math.ceil(
			base64Data.length / CHARS_PER_TOKEN,
		);
		expect(tokens).toBeLessThan(naiveCharBasedEstimate / 10);
		expect(tokens).toBeLessThan(2_000);
	});

	it("does not add a duplicate per-image bonus after JSON.stringify falls back", () => {
		// A BigInt anywhere in the payload makes the primary,
		// replacer-driven JSON.stringify throw, which is caught and
		// re-serializes everything (including images' full base64) via
		// safeStringify. The images seen by the replacer before the throw
		// must not also add ESTIMATED_TOKENS_PER_IMAGE on top of that.
		const base64Data = "A".repeat(90_000);
		// A fresh object per image: safeStringify's circular-reference guard
		// would otherwise collapse repeated references to the same object
		// down to "[Circular]", masking the double count this test checks for.
		const makeImageBlock = () => ({
			type: "image",
			data: base64Data,
			mediaType: "image/png",
		});
		const buildMessages = (imageCount: number) => [
			{
				role: "user",
				content: Array.from({ length: imageCount }, () => makeImageBlock()),
			},
			{ type: "text", broken: 1n },
		];

		const oneImage = estimateRequestInputTokens({
			messages: buildMessages(1),
		});
		const twoImages = estimateRequestInputTokens({
			messages: buildMessages(2),
		});

		// The fallback path serializes every image's full base64 payload, so
		// the delta between one and two images should be roughly that raw
		// char cost alone, not that cost plus another flat
		// ESTIMATED_TOKENS_PER_IMAGE for the extra image.
		const rawCharCostOfOneImage = estimateTokens(base64Data.length);
		expect(twoImages - oneImage).toBeLessThan(rawCharCostOfOneImage + 50);
	});
});
