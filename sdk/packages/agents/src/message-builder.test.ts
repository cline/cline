import type * as LlmsProviders from "@clinebot/llms/providers";
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

		expect(fileBlock?.content).toContain("...[truncated ");
		expect(fileBlock?.content).not.toBe(longFileContent);
		expect(fileBlock?.content?.length).toBeLessThanOrEqual(50_000);
	});

	it("truncates long search tool results before sending them to the model", () => {
		const builder = new MessageBuilder();
		const longSearchResult = "match\n".repeat(20_100);
		const messages = [
			{
				role: "assistant" as const,
				content: [
					{
						type: "tool_use" as const,
						id: "call_search_1",
						name: "search_codebase",
						input: { queries: ["match"] },
					},
				],
			},
			{
				role: "user" as const,
				content: [
					{
						type: "tool_result" as const,
						tool_use_id: "call_search_1",
						content: longSearchResult,
						is_error: false,
					},
				],
			},
		];

		const built = builder.buildForApi(messages);
		const searchContent = (built[1] as { content: Array<{ content: string }> })
			.content[0]?.content;

		expect(searchContent).toContain("...[truncated ");
		expect(searchContent).not.toBe(longSearchResult);
		expect(searchContent?.length).toBeLessThanOrEqual(50_000);
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

	it("keeps different line ranges for the same file", () => {
		const builder = new MessageBuilder();
		const firstReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read_files",
					input: {
						files: [{ path: "src/app.ts", start_line: 1, end_line: 10 }],
					},
				},
			],
		};
		const firstReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content:
						'[{"query":"src/app.ts:1-10","result":"1 | export const a = 1;","success":true}]',
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
					name: "read_files",
					input: {
						files: [{ path: "src/app.ts", start_line: 20, end_line: 30 }],
					},
				},
			],
		};
		const secondReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_2",
					content:
						'[{"query":"src/app.ts:20-30","result":"20 | export const b = 2;","success":true}]',
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
		const firstContent = (built[1] as { content: Array<{ content: string }> })
			.content[0]?.content;

		expect(firstContent).toContain('"result":"1 | export const a = 1;"');
		expect(firstContent).not.toContain(
			"[outdated - see the latest file content]",
		);
	});

	it("treats a full-file read as superseding ranged reads for the same file", () => {
		const builder = new MessageBuilder();
		const fullReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read_files",
					input: { files: [{ path: "src/app.ts" }] },
				},
			],
		};
		const fullReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content:
						'[{"query":"src/app.ts","result":"export const full = true;","success":true}]',
					is_error: false,
				},
			],
		};
		const rangedReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_2",
					name: "read_files",
					input: {
						files: [{ path: "src/app.ts", start_line: 5, end_line: 8 }],
					},
				},
			],
		};
		const rangedReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_2",
					content:
						'[{"query":"src/app.ts:5-8","result":"5 | export const partial = true;","success":true}]',
					is_error: false,
				},
			],
		};

		const built = builder.buildForApi([
			fullReadUse,
			fullReadResult,
			rangedReadUse,
			rangedReadResult,
		]);
		const rangedContent = (built[3] as { content: Array<{ content: string }> })
			.content[0]?.content;

		expect(rangedContent).toContain("[outdated - see the latest file content]");
	});

	it("treats a later file block as superseding an earlier read result for the same path", () => {
		const builder = new MessageBuilder();
		const readUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read_files",
					input: { files: [{ path: "src/app.ts" }] },
				},
			],
		};
		const readResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content:
						'[{"query":"src/app.ts","result":"export const fromRead = true;","success":true}]',
					is_error: false,
				},
			],
		};
		const userFileMessage = {
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: "Attached file",
				},
				{
					type: "file" as const,
					path: "src/app.ts",
					content: "export const fromAttachment = true;",
				},
			],
		};

		const built = builder.buildForApi([readUse, readResult, userFileMessage]);
		const readContent = (built[1] as { content: Array<{ content: string }> })
			.content[0]?.content;
		const fileContent = (
			built[2] as {
				content: Array<{ type: string; content?: string }>;
			}
		).content.find((block) => block.type === "file")?.content;

		expect(readContent).toContain("[outdated - see the latest file content]");
		expect(fileContent).toBe("export const fromAttachment = true;");
	});

	it("keeps a later read result when the file block for the same path came earlier", () => {
		const builder = new MessageBuilder();
		const userFileMessage = {
			role: "user" as const,
			content: [
				{
					type: "text" as const,
					text: "Attached file",
				},
				{
					type: "file" as const,
					path: "src/app.ts",
					content: "export const fromAttachment = true;",
				},
			],
		};
		const readUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read_files",
					input: { files: [{ path: "src/app.ts" }] },
				},
			],
		};
		const readResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content:
						'[{"query":"src/app.ts","result":"export const fromRead = true;","success":true}]',
					is_error: false,
				},
			],
		};

		const built = builder.buildForApi([userFileMessage, readUse, readResult]);
		const readContent = (built[2] as { content: Array<{ content: string }> })
			.content[0]?.content;

		expect(readContent).toContain('"result":"export const fromRead = true;"');
		expect(readContent).not.toContain(
			"[outdated - see the latest file content]",
		);
	});

	it("strips storage metadata before building API messages", () => {
		const builder = new MessageBuilder();
		const messages: LlmsProviders.MessageWithMetadata[] = [
			{
				role: "assistant" as const,
				content: [{ type: "text" as const, text: "hello" }],
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				modelInfo: { id: "claude-sonnet-4-6", provider: "anthropic" },
				metrics: { inputTokens: 1, outputTokens: 2, cost: 0.01 },
				ts: 123,
			},
		];
		const built = builder.buildForApi(messages);

		expect(built[0]).toEqual({
			role: "assistant",
			content: [{ type: "text", text: "hello" }],
		});
	});
});
