import { describe, expect, it } from "vitest";
import { readSessionMessages } from "./messages";

describe("readSessionMessages", () => {
	it("projects image content blocks without replacing them with placeholder text", async () => {
		const sessionId = `image-projection-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{
							id: "user-image",
							role: "user",
							content: [
								{ type: "text", text: "Describe this" },
								{
									type: "image",
									mediaType: "image/png",
									data: "aGVsbG8=",
								},
							],
						},
					],
				},
			],
		]);

		await expect(
			readSessionMessages(
				{ liveSessions } as Parameters<typeof readSessionMessages>[0],
				sessionId,
			),
		).resolves.toEqual([
			expect.objectContaining({
				role: "user",
				content: "Describe this",
				images: [
					{
						id: "user-image_image_1",
						mediaType: "image/png",
						data: "aGVsbG8=",
					},
				],
			}),
		]);
	});
});
