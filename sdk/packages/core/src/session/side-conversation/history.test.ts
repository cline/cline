import type { MessageWithMetadata } from "@cline/llms";
import { createTool, SIDE_REFERENCE_BUDGET_BYTES } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { ClineCore } from "../../ClineCore";
import { toPersistedToolResultContent } from "../persisted-tool-result-content";
import { captureSideReference } from "./context";
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
	it("preserves numeric source tokens alongside redacted media in snapshots and history", async () => {
		const raw = `{
			"integer":9007199254740993,"decimal":1.0000000000000001,
			"exponent":1e400,"negativeZero":-0,"tiny":1e-400,
			"typed":{"type":123,"name":"Numeric discriminator"},
			"content":[
				{"type":"image","data":"BINARY_SECRET","mimeType":"image/png"},
				{"type":"image","source":{"type":"base64","data":"SOURCE_SECRET"}},
				{"type":"media","media":{"id":"generated","modality":"image","mediaType":"image/png","source":{"type":"artifact","artifactId":"HIDDEN_ARTIFACT"}}},
				{"type":"file","path":"note.txt","content":"Text attachment"}
			],
			"entries":[
				{"type":"file","name":"metadata.txt","mimeType":"text/plain"},
				{"type":"image","name":"cover.png","mimeType":"image/png"}
			],
			"cline://cache/parent/result":"Key fact"
		}`;
		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						name: "custom_report",
						tool_use_id: "report",
						content: toPersistedToolResultContent(raw),
					},
				],
			},
		];
		const original = structuredClone(messages);
		const capture = captureSideReference({ messages, activeParentTurn: false });
		const { tool } = fixture(messages);
		const recent = await tool.execute({ operation: "recent" }, context);
		const search = await tool.execute(
			{ operation: "search", query: "9007199254740993" },
			context,
		);
		if (!search.ok || search.result.operation === "read")
			throw new Error("Expected numeric match");
		expect(search.result.matches).toHaveLength(1);
		const read = await tool.execute(
			{ operation: "read", reference: search.result.matches[0].reference },
			context,
		);
		if (!read.ok || read.result.operation !== "read")
			throw new Error("Expected exact reference text");
		for (const text of [
			String(capture.content),
			JSON.stringify(recent),
			read.result.text,
		]) {
			for (const token of [
				"9007199254740993",
				"1.0000000000000001",
				"1e400",
				"-0",
				"1e-400",
				"Text attachment",
				"Numeric discriminator",
				"metadata.txt",
				"cover.png",
				"Key fact",
			])
				expect(text).toContain(token);
			expect(text).not.toMatch(
				/BINARY_SECRET|SOURCE_SECRET|HIDDEN_ARTIFACT|cline:\/\/cache/,
			);
		}
		expect(messages).toEqual(original);
	});

	it("keeps other parent facts available when a tool result exceeds projection limits", async () => {
		const raw = `{"id":9007199254740995,"fact":"DEEP_ONLY_FACT","nested":${"[".repeat(20_000)}null${"]".repeat(20_000)},"media":{"type":"image","data":"NESTED_SECRET"}}`;
		const producer = createTool({
			name: "deep_report",
			description: "Synthetic nested result",
			inputSchema: { type: "object", properties: {} },
			execute: async () => raw,
		});
		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "Parent goal remains" },
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						name: "deep_report",
						tool_use_id: "deep",
						content: toPersistedToolResultContent(
							await producer.execute({}, context),
						),
					},
					{
						type: "tool_result",
						name: "healthy_report",
						tool_use_id: "healthy",
						content: toPersistedToolResultContent('{"id":9007199254740993}'),
					},
				],
			},
			{ role: "assistant", content: "Later fact remains" },
		];
		const original = structuredClone(messages);
		const marker = "content omitted: reference projection limit exceeded";
		const capture = captureSideReference({ messages, activeParentTurn: false });
		const text = String(capture.content);
		expect(text).toContain("Parent goal remains");
		expect(text).toContain("Later fact remains");
		expect(text).toContain("9007199254740993");
		expect(text).toContain("1 saved messages partly represented");
		expect(text).not.toContain("NESTED_SECRET");
		// Engine depth limits vary; safe projection and explicit omission are valid.
		expect(text.includes("9007199254740995") || text.includes(marker)).toBe(
			true,
		);
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(
			SIDE_REFERENCE_BUDGET_BYTES,
		);

		const { tool } = fixture(messages);
		const recent = await tool.execute({ operation: "recent" }, context);
		if (!recent.ok || recent.result.operation === "read")
			throw new Error("Expected recent history");
		const deep = recent.result.matches.find((match) =>
			match.preview.includes("deep_report"),
		);
		expect(deep).toBeDefined();
		expect(
			deep?.preview.includes("9007199254740995") ||
				deep?.preview.includes(marker),
		).toBe(true);
		const missing = await tool.execute(
			{ operation: "search", query: "no such fact" },
			context,
		);
		if (!missing.ok || missing.result.operation === "read")
			throw new Error("Expected empty search");
		expect(missing.result.matches).toEqual([]);
		if (deep?.preview.includes(marker)) {
			expect(recent.note).toContain("tool-result content");
			expect(missing.note).toContain("tool-result content");
		}
		const search = await tool.execute(
			{ operation: "search", query: "9007199254740993" },
			context,
		);
		if (!search.ok || search.result.operation === "read")
			throw new Error("Expected healthy result");
		expect(search.result.matches).toHaveLength(1);
		const match = search.result.matches[0];
		const read = await tool.execute(
			{ operation: "read", reference: match.reference, offset: match.offset },
			context,
		);
		if (!read.ok || read.result.operation !== "read")
			throw new Error("Expected healthy text");
		expect(read.result.text).toContain("9007199254740993");
		expect(JSON.stringify([recent, missing, search, read])).not.toContain(
			"NESTED_SECRET",
		);
		expect(messages).toEqual(original);
	});

	it.each([
		"recent",
		"search",
	] as const)("hashes only returned %s references", async (operation) => {
		const readId = vi.fn((index: number) => `message-${index}`);
		const messages: MessageWithMetadata[] = Array.from(
			{ length: 30 },
			(_, index) => ({
				get id() {
					return readId(index);
				},
				role: "user",
				content: `matching message ${index}`,
			}),
		);
		const { tool } = fixture(messages);
		const result = await tool.execute(
			{
				operation,
				limit: 2,
				...(operation === "search" ? { query: "matching" } : {}),
			},
			context,
		);
		expect(result).toMatchObject({
			ok: true,
			result: {
				matches: [29, 28].map((index) => ({
					preview: `${operation === "recent" ? "[user]\n" : ""}matching message ${index}`,
				})),
				omittedMatches: 28,
			},
		});
		expect(readId.mock.calls).toEqual([[29], [28]]);
	});

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

	it("searches attached text beyond the snapshot excerpt and reads the matching passage", async () => {
		const { tool } = fixture([
			{
				role: "user",
				content: [
					{
						type: "file",
						path: "requirements.txt",
						content: `${"start ".repeat(1000)}MIDDLE_REQUIREMENT${" end".repeat(1000)}`,
					},
				],
			},
		]);
		const search = await tool.execute(
			{ operation: "search", query: "MIDDLE_REQUIREMENT" },
			context,
		);
		if (!search.ok || search.result.operation === "read")
			throw new Error("Expected matches");
		expect(search.result.matches).toHaveLength(1);
		const match = search.result.matches[0];
		expect(
			await tool.execute(
				{ operation: "read", reference: match.reference, offset: match.offset },
				context,
			),
		).toMatchObject({
			ok: true,
			result: { text: expect.stringContaining("MIDDLE_REQUIREMENT") },
		});
	});

	it("reads one source without serializing unrelated outputs and preserves cross-message deduplication", async () => {
		const unrelatedOutput = vi.fn(() => "unrelated".repeat(10000));
		const { tool } = fixture([
			{
				role: "assistant",
				content: "other",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "unrelated",
							toolName: "lookup",
							execution: "provider",
							input: {},
							output: {
								get text() {
									return unrelatedOutput();
								},
							},
						},
					],
				},
			},
			{
				role: "assistant",
				content: "target evidence",
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "duplicate",
							toolName: "lookup",
							execution: "provider",
							input: {},
							output: "duplicate output",
						},
					],
				},
			},
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "duplicate", name: "lookup", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "duplicate",
						name: "lookup",
						content: "duplicate output",
					},
				],
			},
		]);
		const recent = await tool.execute({ operation: "recent" }, context);
		if (!recent.ok || recent.result.operation === "read")
			throw new Error("Expected matches");
		const match = recent.result.matches.find(
			(item) => item.preview === "[assistant]\ntarget evidence",
		);
		if (!match) throw new Error("Expected deduplicated target");
		expect(unrelatedOutput).toHaveBeenCalled();
		unrelatedOutput.mockClear();
		expect(
			await tool.execute(
				{ operation: "read", reference: match.reference },
				context,
			),
		).toMatchObject({
			ok: true,
			result: { text: "[assistant]\ntarget evidence" },
		});
		expect(unrelatedOutput).not.toHaveBeenCalled();
	});

	it("rejects a starting offset inside a surrogate pair while preserving aligned reads", async () => {
		const { tool } = fixture([{ role: "user", content: "A😀B" }]);
		const recent = await tool.execute({ operation: "recent" }, context);
		if (!recent.ok || recent.result.operation === "read")
			throw new Error("Expected matches");
		const reference = recent.result.matches[0].reference;
		expect(
			await tool.execute({ operation: "read", reference, offset: 9 }, context),
		).toMatchObject({ ok: false, error: "invalid_input" });
		expect(
			await tool.execute({ operation: "read", reference, offset: 8 }, context),
		).toMatchObject({ ok: true, result: { text: "😀B", offset: 8 } });
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

	it.each([
		{
			uri: "cline://cache/parent/result",
			redaction: "[parent cache handle omitted]",
		},
		{
			uri: "data:image/png;base64,QUJD",
			redaction: "[binary media omitted]",
		},
	])("recovers provider evidence after $uri", async ({ uri, redaction }) => {
		const { tool } = fixture([
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "pending", name: "read_files", input: {} },
				],
				metadata: {
					modelToolActivities: [
						{
							toolCallId: "search",
							toolName: "web_search",
							execution: "provider",
							input: {},
							output: {
								text: `Public evidence ${uri}\nRecovery fact\t"quoted fact"`,
							},
						},
					],
				},
			},
		]);
		const recent = await tool.execute({ operation: "recent" }, context);
		expect(recent.ok).toBe(true);
		const text = JSON.stringify(recent);
		expect(text).toContain("provider tool observation");
		expect(text).toContain(`Public evidence ${redaction}`);
		expect(text).toContain("Recovery fact");
		expect(text).toContain("Tool call read_files (pending)");
		expect(text).not.toMatch(
			/cline:\/\/cache|data:image|result not yet available/,
		);
		const search = await tool.execute(
			{ operation: "search", query: "Recovery fact" },
			context,
		);
		if (!search.ok || search.result.operation === "read")
			throw new Error("Expected matches");
		expect(search.result.matches).toHaveLength(1);
		expect(
			await tool.execute(
				{ operation: "read", reference: search.result.matches[0].reference },
				context,
			),
		).toMatchObject({
			ok: true,
			result: {
				operation: "read",
				text: expect.stringContaining("Recovery fact"),
			},
		});
	});

	it("bounds encoded previews and reads", async () => {
		const { tool } = fixture(
			Array.from({ length: 20 }, () => ({
				role: "assistant",
				content: "\u0000".repeat(10_000),
			})),
		);
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
	});

	it("rejects invalid parameters and attempts to select another parent before reading history", async () => {
		const { manager, tool } = fixture([]);
		for (const request of [
			{ operation: "recent", sessionId: "other" },
			{ operation: "search" },
			{ operation: "recent", limit: 99 },
		]) {
			expect(await tool.execute(request, context)).toMatchObject({
				ok: false,
				error: "invalid_input",
			});
		}
		expect(manager.readMessages).not.toHaveBeenCalled();
	});

	it("distinguishes unavailable history from no matches and respects cancellation", async () => {
		const { manager, tool } = fixture([]);
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
