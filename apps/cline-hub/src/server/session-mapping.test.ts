import { describe, expect, it } from "vitest";
import { mapHistoryToWebviewMessages } from "./session-mapping";

describe("mapHistoryToWebviewMessages", () => {
	it("hydrates assistant tool uses with following user tool results", () => {
		const messages = mapHistoryToWebviewMessages([
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{ type: "text", text: "I'll inspect the file." },
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "src/index.ts" },
					},
				],
			},
			{
				id: "user-1",
				role: "user",
				content: [
					{
						type: "tool_result",
						id: "result-block-1",
						tool_use_id: "toolu_1",
						name: "read_file",
						content: "export const value = 1;",
					},
				],
			},
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			id: "assistant-1",
			role: "assistant",
			text: "I'll inspect the file.",
			toolEvents: [
				{
					toolCallId: "toolu_1",
					name: "read_file",
					state: "output-available",
					input: { path: "src/index.ts" },
					output: "export const value = 1;",
				},
			],
		});
		expect(messages[0].blocks).toEqual([
			{
				id: "assistant-1:text:0",
				type: "text",
				text: "I'll inspect the file.",
			},
			{
				id: "assistant-1:tool:toolu_1",
				type: "tool",
				toolEvent: expect.objectContaining({
					toolCallId: "toolu_1",
					name: "read_file",
					state: "output-available",
					output: "export const value = 1;",
				}),
			},
		]);
	});

	it("hydrates error tool results", () => {
		const messages = mapHistoryToWebviewMessages([
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "read_file",
						input: { path: "missing.ts" },
					},
				],
			},
			{
				id: "user-1",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						name: "read_file",
						content: "File not found",
						is_error: true,
					},
				],
			},
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0].toolEvents).toEqual([
			expect.objectContaining({
				toolCallId: "toolu_1",
				name: "read_file",
				state: "output-error",
				output: "File not found",
				error: "File not found",
			}),
		]);
		expect(messages[0].blocks?.[0]).toMatchObject({
			type: "tool",
			toolEvent: {
				toolCallId: "toolu_1",
				state: "output-error",
				error: "File not found",
			},
		});
	});

	it("hydrates orphan tool results as standalone meta tool blocks", () => {
		const messages = mapHistoryToWebviewMessages([
			{
				id: "user-1",
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_orphan",
						name: "read_file",
						content: "orphan output",
					},
				],
			},
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			id: "user-1",
			role: "meta",
			text: "",
			toolEvents: [
				{
					toolCallId: "toolu_orphan",
					name: "read_file",
					state: "output-available",
					input: undefined,
					output: "orphan output",
				},
			],
		});
		expect(messages[0].blocks).toEqual([
			{
				id: "user-1:tool:toolu_orphan",
				type: "tool",
				toolEvent: expect.objectContaining({
					toolCallId: "toolu_orphan",
					input: undefined,
					output: "orphan output",
				}),
			},
		]);
	});

	it("hydrates plain string content as a text block", () => {
		const messages = mapHistoryToWebviewMessages([
			{
				id: "assistant-1",
				role: "assistant",
				content: "Plain response",
			},
		]);

		expect(messages).toEqual([
			{
				id: "assistant-1",
				role: "assistant",
				text: "Plain response",
				reasoning: undefined,
				reasoningRedacted: undefined,
				toolEvents: undefined,
				blocks: [
					{
						id: "assistant-1:text:0",
						type: "text",
						text: "Plain response",
					},
				],
			},
		]);
	});

	it("hydrates same-message tool-call and tool-result blocks", () => {
		const messages = mapHistoryToWebviewMessages([
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "search",
						input: { query: "cline" },
					},
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "search",
						output: [{ query: "cline", result: "found", success: true }],
					},
				],
			},
		]);

		expect(messages).toHaveLength(1);
		expect(messages[0].toolEvents).toEqual([
			expect.objectContaining({
				toolCallId: "call_1",
				name: "search",
				state: "output-available",
				input: { query: "cline" },
				output: [{ query: "cline", result: "found", success: true }],
			}),
		]);
		expect(messages[0].blocks).toHaveLength(1);
		expect(messages[0].blocks?.[0]).toMatchObject({
			type: "tool",
			toolEvent: {
				toolCallId: "call_1",
				state: "output-available",
			},
		});
	});
});
