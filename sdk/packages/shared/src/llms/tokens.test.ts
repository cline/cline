import { describe, expect, it } from "vitest";
import {
	CHARS_PER_TOKEN,
	ESTIMATED_TOKENS_PER_IMAGE,
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

	it("charges a flat ESTIMATED_TOKENS_PER_IMAGE per image, independent of payload length", () => {
		const estimate = (data: string) =>
			estimateRequestInputTokens({
				messages: [
					{
						role: "user",
						content: [{ type: "image", data, mediaType: "image/png" }],
					},
				],
			});
		const withoutImage = estimateRequestInputTokens({
			messages: [{ role: "user", content: [] }],
		});

		expect(estimate("A".repeat(500_000))).toBe(estimate("A"));
		const perImage = estimate("A") - withoutImage;
		expect(perImage).toBeGreaterThanOrEqual(ESTIMATED_TOKENS_PER_IMAGE);
		expect(perImage).toBeLessThan(ESTIMATED_TOKENS_PER_IMAGE + 50);
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

	it("does not bill a generated media block's base64 payload at CHARS_PER_TOKEN", () => {
		const base64Data = "A".repeat(90_000);
		const makeMediaMessage = (data: string) => ({
			role: "assistant",
			content: [
				{
					type: "media" as const,
					media: {
						id: "media_1",
						modality: "image" as const,
						mediaType: "image/png",
						source: { type: "base64" as const, data },
					},
				},
			],
		});

		const message = makeMediaMessage(base64Data);
		const tokens = estimateRequestInputTokens({ messages: [message] });
		const naiveCharBasedEstimate = Math.ceil(
			base64Data.length / CHARS_PER_TOKEN,
		);
		expect(tokens).toBeLessThan(naiveCharBasedEstimate / 10);
		expect(tokens).toBeLessThan(2_000);
		// Blanking source.data must not mutate the caller's original media object.
		expect(message.content[0].media.source.data).toBe(base64Data);

		const withoutMedia = estimateRequestInputTokens({
			messages: [{ role: "assistant", content: [] }],
		});
		const estimate = (data: string) =>
			estimateRequestInputTokens({ messages: [makeMediaMessage(data)] });
		expect(estimate("A".repeat(500_000))).toBe(estimate("A"));

		const perMedia = estimate("A") - withoutMedia;
		expect(perMedia).toBeGreaterThanOrEqual(ESTIMATED_TOKENS_PER_IMAGE);
		expect(perMedia).toBeLessThan(ESTIMATED_TOKENS_PER_IMAGE + 100);
	});

	it("does not bill non-image base64 generated media at CHARS_PER_TOKEN", () => {
		const makeAudioMessage = (data: string) => ({
			role: "assistant",
			content: [
				{
					type: "media" as const,
					media: {
						id: "media_audio_1",
						modality: "audio" as const,
						mediaType: "audio/mpeg",
						source: { type: "base64" as const, data },
					},
				},
			],
		});

		const tokens = estimateRequestInputTokens({
			messages: [makeAudioMessage("A".repeat(90_000))],
		});
		expect(tokens).toBeLessThan(2_000);
		expect(
			estimateRequestInputTokens({
				messages: [makeAudioMessage("A".repeat(500_000))],
			}),
		).toBe(
			estimateRequestInputTokens({
				messages: [makeAudioMessage("A")],
			}),
		);
	});

	it("charges flat image cost for URL-backed image media and skips artifact placeholders", () => {
		const withoutMedia = estimateRequestInputTokens({
			messages: [{ role: "assistant", content: [] }],
		});

		const remoteImageTokens = estimateRequestInputTokens({
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "media",
							media: {
								id: "media_url_1",
								modality: "image",
								mediaType: "image/png",
								source: {
									type: "url",
									url: "https://example.com/out.png",
								},
							},
						},
					],
				},
			],
		});
		expect(remoteImageTokens - withoutMedia).toBeGreaterThanOrEqual(
			ESTIMATED_TOKENS_PER_IMAGE,
		);

		const dataUrlImageTokens = estimateRequestInputTokens({
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "media",
							media: {
								id: "media_data_url_1",
								modality: "image",
								mediaType: "image/png",
								source: {
									type: "url",
									url: `data:image/png;base64,${"A".repeat(90_000)}`,
								},
							},
						},
					],
				},
			],
		});
		expect(dataUrlImageTokens).toBeLessThan(2_000);

		const artifactTokens = estimateRequestInputTokens({
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "media",
							media: {
								id: "media_art_1",
								modality: "image",
								mediaType: "image/png",
								source: {
									type: "artifact",
									artifactId: "art_1",
								},
							},
						},
					],
				},
			],
		});
		expect(artifactTokens).toBeLessThan(200);
	});

	it("does not double-count generated media blocks after JSON.stringify falls back", () => {
		const base64Data = "A".repeat(90_000);
		const makeMediaBlock = () => ({
			type: "media" as const,
			media: {
				id: "media_1",
				modality: "image" as const,
				mediaType: "image/png",
				source: { type: "base64" as const, data: base64Data },
			},
		});
		const buildMessages = (count: number) => [
			{
				role: "assistant",
				content: Array.from({ length: count }, () => makeMediaBlock()),
			},
			{ type: "text", broken: 1n },
		];

		const oneMedia = estimateRequestInputTokens({
			messages: buildMessages(1),
		});
		const twoMedia = estimateRequestInputTokens({
			messages: buildMessages(2),
		});

		const rawCharCostOfOneMedia = estimateTokens(base64Data.length);
		expect(twoMedia - oneMedia).toBeLessThan(rawCharCostOfOneMedia + 150);
	});
});
