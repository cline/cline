import { describe, expect, it } from "vitest";
import { readSessionMessages } from "./messages";

describe("readSessionMessages", () => {
	it("continues past malformed persisted entries", async () => {
		const sessionId = `malformed-projection-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [null, 42, { role: "assistant", content: "Still here" }],
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
				role: "assistant",
				content: "Still here",
			}),
		]);
	});

	it("uses stored timestamps as a stable integer base for projected blocks", async () => {
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
				createdAt: assistantTimestamp + 1,
				meta: expect.objectContaining({
					toolCallId: "tool-use",
					hookEventName: "history_tool_use",
				}),
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
			{ liveSessions } as unknown as Parameters<typeof readSessionMessages>[0],
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
			{ liveSessions } as unknown as Parameters<typeof readSessionMessages>[0],
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

	it("projects provider model activities through the ordinary tool payload", async () => {
		const sessionId = `provider-tool-projection-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{
							id: "assistant-search",
							role: "assistant",
							content: "Bun 1.3.14 is current.",
							metadata: {
								modelToolActivities: [
									{
										toolCallId: "search-1",
										toolName: "web_search",
										execution: "provider",
										input: { query: "latest Bun release" },
										output: { answer: "1.3.14" },
									},
								],
							},
						},
					],
				},
			],
		]);

		const projected = (await readSessionMessages(
			{ liveSessions } as unknown as Parameters<typeof readSessionMessages>[0],
			sessionId,
		)) as Array<Record<string, unknown>>;

		expect(projected).toHaveLength(2);
		expect(projected[0]).toMatchObject({
			role: "tool",
			meta: {
				toolName: "web_search",
				hookEventName: "history_tool_result",
			},
		});
		expect(JSON.parse(String(projected[0]?.content))).toMatchObject({
			toolName: "web_search",
			input: { query: "latest Bun release" },
			result: '{"answer":"1.3.14"}',
		});
		expect(projected[1]).toMatchObject({
			role: "assistant",
			content: "Bun 1.3.14 is current.",
		});
		const sorted = [...projected].sort((left, right) => {
			const time = Number(left.createdAt) - Number(right.createdAt);
			return time || String(left.id).localeCompare(String(right.id));
		});
		expect(sorted.map((message) => message.role)).toEqual([
			"tool",
			"assistant",
		]);
		expect(Number(projected[0]?.createdAt)).toBeLessThan(
			Number(projected[1]?.createdAt),
		);
	});

	it("keeps the absolute run anchor for a truncated tool-only provider turn", async () => {
		const sessionId = `provider-tool-run-anchor-${Date.now()}`;
		const liveSessions = new Map([
			[
				sessionId,
				{
					messages: [
						{ role: "user", content: "First prompt" },
						{ role: "assistant", content: "First response" },
						{ role: "user", content: "Second prompt" },
						{
							id: "tool-only-assistant",
							role: "assistant",
							content: [],
							metadata: {
								modelToolActivities: [
									{
										toolCallId: "search-tool-only",
										toolName: "web_search",
										execution: "provider",
										input: { query: "latest Bun" },
										output: "Bun 1.3.14",
									},
								],
							},
						},
					],
				},
			],
		]);

		const projected = (await readSessionMessages(
			{ liveSessions } as Parameters<typeof readSessionMessages>[0],
			sessionId,
			1,
		)) as Array<Record<string, unknown>>;

		expect(projected).toHaveLength(1);
		expect(projected[0]).toMatchObject({
			role: "tool",
			meta: {
				runCount: 2,
				toolName: "web_search",
				hookEventName: "history_tool_result",
			},
		});
	});
});
