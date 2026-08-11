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
				meta: { runCount: 1 },
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

	it("preserves absolute user run counts when older messages are omitted", async () => {
		const sessionId = `run-count-projection-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{ role: "user", content: "First prompt" },
						{ role: "assistant", content: "First response" },
						{ role: "user", content: "Second prompt" },
						{ role: "assistant", content: "Second response" },
					],
				},
			],
		]);

		await expect(
			readSessionMessages(
				{ liveSessions } as Parameters<typeof readSessionMessages>[0],
				sessionId,
				2,
			),
		).resolves.toEqual([
			expect.objectContaining({
				role: "user",
				content: "Second prompt",
				meta: { runCount: 2 },
			}),
			expect.objectContaining({
				role: "assistant",
				content: "Second response",
			}),
		]);

		await expect(
			readSessionMessages(
				{ liveSessions } as Parameters<typeof readSessionMessages>[0],
				sessionId,
				1,
			),
		).resolves.toEqual([
			expect.objectContaining({
				role: "assistant",
				content: "Second response",
				meta: { runCount: 2 },
			}),
		]);
	});

	it("marks later display segments from one user message as the same run", async () => {
		const sessionId = `segmented-user-run-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: "First segment" },
								{
									type: "tool_result",
									tool_use_id: "orphan-tool",
									content: "Tool output",
								},
								{ type: "text", text: "Second segment" },
							],
						},
					],
				},
			],
		]);

		const projected = (await readSessionMessages(
			{ liveSessions } as Parameters<typeof readSessionMessages>[0],
			sessionId,
		)) as Array<Record<string, unknown>>;

		expect(projected).toEqual([
			expect.objectContaining({
				role: "user",
				content: "First segment",
				meta: { runCount: 1 },
			}),
			expect.objectContaining({ role: "tool" }),
			expect.objectContaining({
				role: "user",
				content: "Second segment",
				meta: { userRunSpan: 0 },
			}),
		]);
	});

	it("preserves absolute run counts across system-displayed compaction messages", async () => {
		const sessionId = `compaction-run-count-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{
							role: "user",
							content: "Compacted context",
							metadata: {
								kind: "compaction",
								displayRole: "system",
								userRunSpan: 3,
							},
						},
						{ role: "user", content: "First visible prompt" },
						{ role: "assistant", content: "First response" },
						{ role: "user", content: "Second visible prompt" },
					],
				},
			],
		]);

		const projected = (await readSessionMessages(
			{ liveSessions } as Parameters<typeof readSessionMessages>[0],
			sessionId,
		)) as Array<Record<string, unknown>>;

		expect(projected[0]).toMatchObject({
			role: "system",
			content: "Compacted context",
			meta: { runCount: 3, userRunSpan: 3 },
		});
		expect(projected[1]).toMatchObject({
			role: "user",
			content: "First visible prompt",
			meta: { runCount: 4 },
		});
		expect(projected[3]).toMatchObject({
			role: "user",
			content: "Second visible prompt",
			meta: { runCount: 5 },
		});

		const truncated = (await readSessionMessages(
			{ liveSessions } as Parameters<typeof readSessionMessages>[0],
			sessionId,
			2,
		)) as Array<Record<string, unknown>>;
		expect(truncated[1]).toMatchObject({
			role: "user",
			content: "Second visible prompt",
			meta: { runCount: 5 },
		});
	});
});
