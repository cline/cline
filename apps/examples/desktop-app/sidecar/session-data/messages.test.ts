import { describe, expect, it } from "vitest";
import { readSessionMessages } from "./messages";

describe("readSessionMessages", () => {
	it("preserves each stored message timestamp across projected blocks", async () => {
		const sessionId = `timestamp-projection-${Date.now()}`;
		const userTimestamp = 1_781_041_621_282;
		const assistantTimestamp = 1_781_041_621_946;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{
							id: "user-message",
							role: "user",
							content: [{ type: "text", text: "Question" }],
							ts: userTimestamp,
						},
						{
							id: "assistant-message",
							role: "assistant",
							content: [
								{ type: "thinking", thinking: "Consider it" },
								{ type: "text", text: "Answer" },
								{
									type: "tool_use",
									id: "tool-use",
									name: "read_files",
									input: { paths: ["a.ts"] },
								},
							],
							ts: assistantTimestamp,
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
				id: "user-message_text_0",
				createdAt: userTimestamp,
			}),
			expect.objectContaining({
				id: "assistant-message_text_0",
				createdAt: assistantTimestamp,
				reasoning: "Consider it",
			}),
			expect.objectContaining({
				id: "assistant-message_tool_use_2",
				createdAt: assistantTimestamp,
			}),
		]);
	});

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
