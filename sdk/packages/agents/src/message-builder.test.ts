import { describe, expect, it } from "vitest";
import { MessageBuilder } from "./message-builder.js";

describe("MessageBuilder", () => {
	it("keeps cached indexes consistent across append and reset flows", () => {
		const builder = new MessageBuilder();
		const firstReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read",
					input: { path: "src/app.ts" },
				},
			],
		};
		const firstReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content: '[{"path":"src/app.ts","content":"export const v = 1;"}]',
					is_error: false,
				},
			],
		};
		const secondReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_2",
					name: "read",
					input: { path: "src/app.ts" },
				},
			],
		};
		const secondReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_2",
					content: '[{"path":"src/app.ts","content":"export const v = 2;"}]',
					is_error: false,
				},
			],
		};

		const initial = builder.buildForApi([firstReadUse, firstReadResult]);
		expect(initial[1]?.content).toEqual(firstReadResult.content);

		const appended = builder.buildForApi([
			firstReadUse,
			firstReadResult,
			secondReadUse,
			secondReadResult,
		]);
		const firstContent = (
			appended[1] as { content: Array<{ content: string }> }
		).content[0]?.content;
		expect(firstContent).toContain("[outdated - see the latest file content]");

		const reset = builder.buildForApi([secondReadUse, secondReadResult]);
		expect(reset[1]?.content).toEqual(secondReadResult.content);
	});

	it("truncates long file blocks in user messages", () => {
		const builder = new MessageBuilder();
		const longFileContent = "a".repeat(120_500);
		const messages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: "Please review this file.",
					},
					{
						type: "file" as const,
						path: "src/big.ts",
						content: longFileContent,
					},
				],
			},
		];

		const built = builder.buildForApi(messages);
		const fileBlock = (
			built[0] as { content: Array<{ type: string; content?: string }> }
		).content.find((block) => block.type === "file");

		expect(fileBlock?.content).toContain("...[truncated 20500 chars]...");
		expect(fileBlock?.content).not.toBe(longFileContent);
	});

	it("replaces outdated file blocks in read tool results", () => {
		const builder = new MessageBuilder();
		const firstReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read",
					input: { path: "src/app.ts" },
				},
			],
		};
		const firstReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content: [
						{
							type: "file" as const,
							path: "src/app.ts",
							content: "export const v = 1;",
						},
					],
					is_error: false,
				},
			],
		};
		const secondReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_2",
					name: "read",
					input: { path: "src/app.ts" },
				},
			],
		};
		const secondReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_2",
					content: [
						{
							type: "file" as const,
							path: "src/app.ts",
							content: "export const v = 2;",
						},
					],
					is_error: false,
				},
			],
		};

		const built = builder.buildForApi([
			firstReadUse,
			firstReadResult,
			secondReadUse,
			secondReadResult,
		]);
		const firstToolResult = (
			built[1] as { content: Array<{ content: unknown }> }
		).content[0] as {
			content: Array<{ type: string; content?: string }>;
		};
		const firstFile = firstToolResult.content.find(
			(entry) => entry.type === "file",
		);

		expect(firstFile?.content).toBe("[outdated - see the latest file content]");
	});

	it("strips storage metadata before building API messages", () => {
		const builder = new MessageBuilder();
		const built = builder.buildForApi([
			{
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "hello" }],
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				modelInfo: { id: "claude-sonnet-4-6", provider: "anthropic" },
				metrics: { inputTokens: 1, outputTokens: 2, cost: 0.01 },
				ts: 123,
			},
		]);

		expect(built[0]).toEqual({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
	});
});
