import type { MessageWithMetadata } from "@cline/llms";
import { describe, expect, it, vi } from "vitest";
import type { ClineCore } from "../../ClineCore";
import { createSideHistoryTool } from "./history";

const context = { agentId: "side", iteration: 0 };

function fixture(messages: MessageWithMetadata[]) {
	const parent: NonNullable<Awaited<ReturnType<ClineCore["get"]>>> = {
		sessionId: "parent",
		source: "desktop",
		isSubagent: false,
		startedAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: true,
		provider: "test",
		model: "test",
		cwd: "/test",
		workspaceRoot: "/test",
		enableTools: true,
		enableSpawn: true,
		enableTeams: true,
	};
	const manager = {
		get: vi.fn<ClineCore["get"]>(async () => parent),
		readMessages: vi.fn<ClineCore["readMessages"]>(async () => messages),
	};
	return {
		manager,
		tool: createSideHistoryTool({ manager, parentSessionId: "parent" }),
	};
}

describe("side parent history tool", () => {
	it("reads only its parent on demand and sees new saved activity without mutating history", async () => {
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "initial task" },
		];
		const { manager, tool } = fixture(messages);
		expect(tool.inputSchema).toMatchObject({
			type: "object",
			properties: { operation: { enum: ["recent", "search", "read"] } },
		});
		expect(manager.readMessages).not.toHaveBeenCalled();
		const first = await tool.execute({ operation: "recent" }, context);
		expect(first).toMatchObject({
			ok: true,
			parentStatus: "running",
			result: { matches: [{ preview: "[user]\ninitial task" }] },
		});
		messages.push({
			role: "assistant",
			content: "The final result is cobalt.",
		});
		const original = structuredClone(messages);
		const next = await tool.execute({ operation: "recent", limit: 1 }, context);
		expect(next).toMatchObject({
			ok: true,
			result: {
				matches: [{ preview: "[assistant]\nThe final result is cobalt." }],
				omittedMatches: 1,
			},
		});
		if (!next.ok) throw new Error("Expected history");
		expect(next.note).toContain(
			"in-progress reply or tool result may not be saved",
		);
		expect(manager.get.mock.calls).toEqual([["parent"], ["parent"]]);
		expect(manager.readMessages.mock.calls).toEqual([["parent"], ["parent"]]);
		expect(messages).toEqual(original);
	});

	it.each([
		"start \u0000🧭",
		"这是历史上下文",
		"İ",
	])("finds an omitted middle detail after %s and reads exact bounded chunks", async (prefix) => {
		const payload = `${prefix.repeat(2200)}the recovery code [42].* is ultramarine${" end".repeat(2200)}`;
		const { tool } = fixture([
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						name: "read_files",
						tool_use_id: "call",
						content: payload,
					},
				],
			},
		]);
		const search = await tool.execute(
			{ operation: "search", query: "RECOVERY CODE [42].*" },
			context,
		);
		if (!search.ok || search.result.operation === "read")
			throw new Error("Expected matches");
		const match = search.result.matches[0];
		expect(match.preview).toContain("recovery code [42].* is ultramarine");
		expect(match.omittedBytes).toBeGreaterThan(0);
		const exact = await tool.execute(
			{ operation: "read", reference: match.reference, offset: match.offset },
			context,
		);
		if (!exact.ok || exact.result.operation !== "read")
			throw new Error("Expected exact read");
		expect(exact.result.text).toContain("recovery code [42].* is ultramarine");
		expect(exact.result.nextOffset).toBeGreaterThan(match.offset);
		let position = 0;
		let collected = "";
		for (;;) {
			const read = await tool.execute(
				{ operation: "read", reference: match.reference, offset: position },
				context,
			);
			if (!read.ok || read.result.operation !== "read")
				throw new Error("Expected exact read");
			expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThanOrEqual(
				16 * 1024,
			);
			collected += read.result.text;
			if (read.result.nextOffset === null) break;
			position = read.result.nextOffset;
		}
		expect(collected).toBe(`[user]\nTool result read_files (call): ${payload}`);
	});

	it("rejects references after edit or rewind instead of returning replacement content", async () => {
		const messages: MessageWithMetadata[] = [
			{ role: "assistant", content: "original evidence" },
		];
		const { tool } = fixture(messages);
		const recent = await tool.execute({ operation: "recent" }, context);
		if (!recent.ok || recent.result.operation === "read")
			throw new Error("Expected matches");
		const reference = recent.result.matches[0].reference;
		messages[0] = { role: "assistant", content: "replacement evidence" };
		expect(
			await tool.execute({ operation: "read", reference }, context),
		).toMatchObject({ ok: false, error: "stale_reference" });
		messages.length = 0;
		expect(
			await tool.execute({ operation: "read", reference }, context),
		).toMatchObject({ ok: false, error: "stale_reference" });
	});

	it("keeps a pending tool call reference stable when its separate result arrives", async () => {
		const messages: MessageWithMetadata[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call",
						name: "read_files",
						input: { path: "example.txt" },
					},
				],
			},
		];
		const { tool } = fixture(messages);
		const recent = await tool.execute({ operation: "recent" }, context);
		if (!recent.ok || recent.result.operation === "read")
			throw new Error("Expected matches");
		const reference = recent.result.matches[0].reference;
		const before = await tool.execute(
			{ operation: "read", reference },
			context,
		);
		messages.push({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call",
					name: "read_files",
					content: "Saved result",
				},
			],
		});
		const after = await tool.execute({ operation: "read", reference }, context);
		expect(after).toEqual(before);
		expect(after.ok).toBe(true);
	});

	it("projects provider activity and pending tools while omitting media, reasoning and cache handles", async () => {
		const { tool } = fixture([
			{
				role: "user",
				content: [
					{ type: "image", data: "PRIVATE_IMAGE", mediaType: "image/png" },
				],
			},
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "PRIVATE_THINKING" },
					{
						type: "tool_use",
						id: "pending",
						name: "read_files",
						input: { path: "cline://cache/private/tool.txt" },
					},
				],
			},
			{
				role: "assistant",
				content: "lookup finished",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "provider-call",
							toolName: "web_search",
							execution: "provider",
							input: { query: "example" },
							output: { text: "Public evidence" },
						},
					],
				},
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "mcp",
						name: "mcp_media",
						content: JSON.stringify({
							content: [
								{ type: "audio", data: "AUDIO_SECRET", mimeType: "audio/wav" },
								{
									type: "resource",
									resource: {
										uri: "fixture:image",
										mimeType: "image/png",
										blob: "BLOB_SECRET",
									},
								},
								{
									type: "resource",
									resource: {
										uri: "fixture:text",
										mimeType: "text/plain",
										text: "Resource evidence",
									},
								},
							],
						}),
					},
				],
			},
			{
				role: "assistant",
				content: "HIDDEN_NOTICE",
				metadata: { displayOnly: true },
			},
		]);
		const result = await tool.execute({ operation: "recent" }, context);
		const text = JSON.stringify(result);
		expect(text).toContain("provider tool observation");
		expect(text).toContain("Public evidence");
		expect(text).toContain("Resource evidence");
		expect(text).not.toContain("result not yet available");
		expect(
			await tool.execute(
				{ operation: "search", query: "Public evidence" },
				context,
			),
		).toMatchObject({
			ok: true,
			result: {
				matches: [{ preview: expect.stringContaining("Public evidence") }],
			},
		});
		for (const hidden of [
			"PRIVATE_IMAGE",
			"PRIVATE_THINKING",
			"AUDIO_SECRET",
			"BLOB_SECRET",
			"cline://cache/private",
			"HIDDEN_NOTICE",
		])
			expect(text).not.toContain(hidden);
	});

	it("bounds encoded output, validates scope and parameters, and distinguishes failure from no matches", async () => {
		const { manager, tool } = fixture(
			Array.from({ length: 20 }, () => ({
				role: "assistant",
				content: "\u0000".repeat(10_000),
			})),
		);
		const extraScope = { operation: "recent", sessionId: "other" } satisfies {
			operation: "recent";
			sessionId: string;
		};
		for (const request of [
			extraScope,
			{ operation: "search" },
			{ operation: "recent", limit: 99 },
		] satisfies Parameters<typeof tool.execute>[0][]) {
			expect(await tool.execute(request, context)).toMatchObject({
				ok: false,
				error: "invalid_input",
			});
		}
		expect(manager.readMessages).not.toHaveBeenCalled();
		const recent = await tool.execute(
			{ operation: "recent", limit: 12 },
			context,
		);
		expect(Buffer.byteLength(JSON.stringify(recent))).toBeLessThanOrEqual(
			16 * 1024,
		);
		if (!recent.ok || recent.result.operation === "read")
			throw new Error("Expected matches");
		expect(recent.result.omittedMatches).toBeGreaterThan(0);
		const read = await tool.execute(
			{ operation: "read", reference: recent.result.matches[0].reference },
			context,
		);
		expect(Buffer.byteLength(JSON.stringify(read))).toBeLessThanOrEqual(
			16 * 1024,
		);
		expect(
			await tool.execute({ operation: "search", query: "absent" }, context),
		).toMatchObject({ ok: true, result: { matches: [] } });
		manager.readMessages.mockRejectedValueOnce(
			new Error("private transport path"),
		);
		expect(await tool.execute({ operation: "recent" }, context)).toMatchObject({
			ok: false,
			error: "unavailable",
		});
		manager.get.mockResolvedValueOnce(undefined);
		expect(await tool.execute({ operation: "recent" }, context)).toMatchObject({
			ok: false,
			error: "unavailable",
		});
		const abort = new AbortController();
		abort.abort(new Error("closed"));
		await expect(
			tool.execute(
				{ operation: "recent" },
				{ ...context, signal: abort.signal },
			),
		).rejects.toThrow("closed");
	});
});
