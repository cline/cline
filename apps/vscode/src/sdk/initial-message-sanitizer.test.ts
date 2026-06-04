import { describe, expect, it } from "vitest";
import { sanitizeInitialMessagesForSessionStart } from "./initial-message-sanitizer";

describe("sanitizeInitialMessagesForSessionStart", () => {
	it("returns original array when no tool_use blocks exist", () => {
		const input = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi" },
		];
		const result = sanitizeInitialMessagesForSessionStart(input);
		expect(result).toBe(input);
	});

	it("adds missing tool_result blocks to the next user message", () => {
		const input = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "a.ts" },
					},
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
			},
		];

		const result = sanitizeInitialMessagesForSessionStart(input);
		expect(result).not.toBe(input);

		const nextContent = (
			result[1] as { content: Array<Record<string, unknown>> }
		).content;
		expect(nextContent).toEqual([
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "toolu_1",
				name: "read_file",
			}),
		]);
		expect(result[2]).toMatchObject({
			role: "user",
			content: [expect.objectContaining({ type: "text", text: "continue" })],
		});
	});

	it("inserts synthetic user tool_result message when missing next user message", () => {
		const input = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "a.ts" },
					},
				],
			},
			{ role: "assistant", content: [{ type: "text", text: "extra" }] },
		];

		const result = sanitizeInitialMessagesForSessionStart(input);
		expect(result).toHaveLength(3);
		expect(result[1]).toMatchObject({
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "toolu_1", name: "read_file" },
			],
		});
	});

	it("consolidates parallel tool results spread across separate user messages (ENG-1885)", () => {
		// The SDK persists each parallel tool result as a separate user message.
		// The sanitizer must collect them all, not just the first one.
		const input = [
			{ role: "user", content: [{ type: "text", text: "list /usr" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll list several directories." },
					{
						type: "tool_use",
						id: "toolu_A",
						name: "execute_command",
						input: { command: "ls /usr/bin" },
					},
					{
						type: "tool_use",
						id: "toolu_B",
						name: "execute_command",
						input: { command: "ls /usr/lib" },
					},
					{
						type: "tool_use",
						id: "toolu_C",
						name: "execute_command",
						input: { command: "ls /usr/share" },
					},
				],
			},
			// SDK persists each tool result as a separate user message
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_A",
						content: "bin contents",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_B",
						content: "lib contents",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_C",
						content: "share contents",
					},
				],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Here are the results." }],
			},
		];

		const result = sanitizeInitialMessagesForSessionStart(input);

		// Should consolidate the 3 separate user messages into 1
		expect(result).toHaveLength(4); // user, assistant(3 tools), user(3 results), assistant
		const toolResultMsg = result[2] as {
			content: Array<Record<string, unknown>>;
		};
		expect(toolResultMsg.content).toHaveLength(3);
		expect(toolResultMsg.content[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "toolu_A",
			content: "bin contents",
		});
		expect(toolResultMsg.content[1]).toMatchObject({
			type: "tool_result",
			tool_use_id: "toolu_B",
			content: "lib contents",
		});
		expect(toolResultMsg.content[2]).toMatchObject({
			type: "tool_result",
			tool_use_id: "toolu_C",
			content: "share contents",
		});

		// Verify no duplicates: count tool_result blocks across all messages
		const allToolResultIds = (
			result as Array<{ role: string; content: unknown }>
		).flatMap((msg) => {
			if (!Array.isArray(msg.content)) return [];
			return msg.content
				.filter((b: any) => b.type === "tool_result")
				.map((b: any) => b.tool_use_id);
		});
		const uniqueIds = new Set(allToolResultIds);
		expect(allToolResultIds.length).toBe(uniqueIds.size); // no duplicates
	});

	it("reorders existing tool_result blocks to match tool_use order", () => {
		const input = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "a.ts" },
					},
					{
						type: "tool_use",
						id: "toolu_2",
						name: "read_file",
						input: { path: "b.ts" },
					},
				],
			},
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "toolu_2", content: "b" },
					{ type: "text", text: "keep me" },
					{ type: "tool_result", tool_use_id: "toolu_1", content: "a" },
				],
			},
		];

		const result = sanitizeInitialMessagesForSessionStart(input);
		const nextContent = (
			result[1] as { content: Array<Record<string, unknown>> }
		).content;
		expect(nextContent[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "toolu_1",
		});
		expect(nextContent[1]).toMatchObject({
			type: "tool_result",
			tool_use_id: "toolu_2",
		});
		expect(nextContent[2]).toMatchObject({ type: "text", text: "keep me" });
	});

	it("backfills missing tool_result names from matching assistant tool_use blocks", () => {
		const input = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "a.ts" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: "file contents",
					},
				],
			},
		];

		const result = sanitizeInitialMessagesForSessionStart(input);
		const nextContent = (
			result[1] as { content: Array<Record<string, unknown>> }
		).content;
		expect(nextContent[0]).toMatchObject({
			type: "tool_result",
			tool_use_id: "toolu_1",
			name: "read_file",
			content: "file contents",
		});
	});
});
