import {
	type AiSdkFormatterMessage,
	formatMessagesForAiSdk,
	type Message,
	type ToolResultContent,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { messagesToAgentMessages } from "../../runtime/config/agent-message-codec";
import { MessageBuilder } from "./message-builder";

describe("MessageBuilder", () => {
	it("inserts an error tool result before a follow-up prompt when a prior tool call is missing a result", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "inspect the repo" }],
			},
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: "I will inspect it.",
					},
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: ["session resume"] },
					},
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "please continue" }],
			},
		];

		const result = builder.buildForApi(messages);

		expect(result).toHaveLength(3);
		expect(result[2]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool_1",
					name: "search_codebase",
					content: [
						{
							type: "text",
							text: "Tool execution was interrupted before a result was produced. Tool: search_codebase.",
						},
					],
					is_error: true,
				},
				{ type: "text", text: "please continue" },
			],
		});
		expect(messages).toHaveLength(3);
	});

	it("fills only missing tool results after existing results for the same assistant turn", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "read",
						input: { path: "/tmp/a.txt" },
					},
					{
						type: "tool_use",
						id: "tool_2",
						name: "bash",
						input: { command: "pwd" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "read",
						content: "contents",
					},
				],
			},
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
			},
		];

		const result = builder.buildForApi(messages);

		expect(result).toHaveLength(2);
		const toolResultMessage = result[1];
		expect(Array.isArray(toolResultMessage.content)).toBe(true);
		if (!Array.isArray(toolResultMessage.content)) {
			throw new Error("expected array content");
		}
		expect(toolResultMessage.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "tool_1",
				name: "read",
				content: "contents",
			},
			{
				type: "tool_result",
				tool_use_id: "tool_2",
				name: "bash",
				content: [
					{
						type: "text",
						text: "Tool execution was interrupted before a result was produced. Tool: bash.",
					},
				],
				is_error: true,
			},
			{ type: "text", text: "continue" },
		]);
	});

	it("does not rewrite synthetic read-tool error results as outdated file content", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "read",
						input: { path: "/tmp/a.txt" },
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const content = result[1]?.content;
		expect(Array.isArray(content)).toBe(true);
		const block = Array.isArray(content) ? content[0] : undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(block.content).toEqual([
			{
				type: "text",
				text: "Tool execution was interrupted before a result was produced. Tool: read.",
			},
		]);
		expect(block.is_error).toBe(true);
	});

	it("truncates search_codebase tool results before provider requests", () => {
		const builder = new MessageBuilder(100);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "needle" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "read",
						content: "a".repeat(250),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const content = result[1].content;
		expect(Array.isArray(content)).toBe(true);
		const block = Array.isArray(content) ? content[0] : undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(block.content.length).toBeLessThanOrEqual(100);
		expect(block.content).toContain("...[truncated");
	});

	it("applies an aggregate text budget across targeted tool results", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["search_codebase"]),
			20_000,
		);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "first" },
					},
					{
						type: "tool_use",
						id: "tool_2",
						name: "search_codebase",
						input: { queries: "second" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "read",
						content: "a".repeat(15_000),
					},
					{
						type: "tool_result",
						tool_use_id: "tool_2",
						name: "bash",
						content: "b".repeat(15_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const totalBytes = result.reduce((sum, message) => {
			if (typeof message.content === "string") {
				return sum + Buffer.byteLength(message.content, "utf8");
			}
			return (
				sum +
				message.content.reduce((inner, block) => {
					if (block.type !== "tool_result") {
						return inner;
					}
					return (
						inner +
						(typeof block.content === "string"
							? Buffer.byteLength(block.content, "utf8")
							: 0)
					);
				}, 0)
			);
		}, 0);

		expect(totalBytes).toBeLessThanOrEqual(20_000);
		expect(JSON.stringify(result)).toContain("provider request budget");
	});

	it("applies the aggregate budget using UTF-8 byte size", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["search_codebase"]),
			12_000,
		);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "emoji" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "tool",
						content: "🙂".repeat(5_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;

		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(typeof block.content).toBe("string");
		if (typeof block.content !== "string") {
			throw new Error("expected string content");
		}
		expect(Buffer.byteLength(block.content, "utf8")).toBeLessThanOrEqual(
			12_000,
		);
		expect(block.content).toContain("provider request budget");
	});

	it("does not mutate original nested tool result content when applying aggregate budget", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["search_codebase"]),
			10_000,
		);
		const originalText = "a".repeat(15_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: "first" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "tool",
						content: [{ type: "text", text: originalText }],
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const originalBlock = Array.isArray(messages[1].content)
			? messages[1].content[0]
			: undefined;
		const resultBlock = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;

		expect(originalBlock?.type).toBe("tool_result");
		expect(resultBlock?.type).toBe("tool_result");
		if (originalBlock?.type !== "tool_result") {
			throw new Error("expected original tool_result");
		}
		if (resultBlock?.type !== "tool_result") {
			throw new Error("expected result tool_result");
		}
		expect(originalBlock.content).toEqual([
			{ type: "text", text: originalText },
		]);
		expect(resultBlock.content).not.toBe(originalBlock.content);
		expect(resultBlock.content).toEqual([
			expect.objectContaining({
				type: "text",
				text: expect.stringContaining("provider request budget"),
			}),
		]);
	});
});

/**
 * Regression coverage for the real `ToolOperationResult[]` shape emitted by
 * the default Cline tools (run_commands, read_files, search_codebase).
 *
 * The runtime stores these structured results directly as the tool_result
 * `content` array (see `agentPartToContentBlock` in
 * `runtime/config/agent-message-codec.ts`): the entries are plain
 * `{query, result, success, ...}` objects with no `type` discriminator, so
 * they bypass the text/file-entry truncation paths unless MessageBuilder
 * handles them explicitly.
 */
describe("MessageBuilder with structured ToolOperationResult content", () => {
	const MIDDLE_SENTINEL = "__MIDDLE_SENTINEL_MUST_BE_TRUNCATED__";
	const HEAD_MARKER = "__HEAD_MARKER__";
	const TAIL_MARKER = "__TAIL_MARKER__";

	interface ToolOperationResultLike {
		query: string;
		result: unknown;
		error?: string;
		success: boolean;
		duration?: number;
	}

	function hugeText(size = 400_000): string {
		const fillerLength = Math.floor(
			(size -
				MIDDLE_SENTINEL.length -
				HEAD_MARKER.length -
				TAIL_MARKER.length) /
				2,
		);
		const filler = "x".repeat(fillerLength);
		return `${HEAD_MARKER}${filler}${MIDDLE_SENTINEL}${filler}${TAIL_MARKER}`;
	}

	function imageData(byteLength: number, fill = 1): string {
		return Buffer.alloc(byteLength, fill).toString("base64");
	}

	function toolUseMessage(
		id: string,
		name: string,
		input: Record<string, unknown>,
	): Message {
		return {
			role: "assistant",
			content: [{ type: "tool_use", id, name, input }],
		};
	}

	function structuredToolResultMessage(
		toolUseId: string,
		name: string,
		operations: ToolOperationResultLike[],
	): Message {
		return {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					name,
					// The runtime casts ToolOperationResult[] straight into the
					// content array; mirror that here.
					content: operations as unknown as ToolResultContent["content"],
				},
			],
		};
	}

	function sumStringBytes(value: unknown): number {
		if (typeof value === "string") {
			return Buffer.byteLength(value, "utf8");
		}
		if (Array.isArray(value)) {
			return value.reduce<number>((sum, item) => sum + sumStringBytes(item), 0);
		}
		if (value !== null && typeof value === "object") {
			return Object.values(value).reduce<number>(
				(sum, item) => sum + sumStringBytes(item),
				0,
			);
		}
		return 0;
	}

	it("truncates a huge nested `result` string in run_commands structured output", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			toolUseMessage("call_1", "run_commands", {
				commands: ["cat big.log"],
			}),
			structuredToolResultMessage("call_1", "run_commands", [
				{
					query: "cat big.log",
					result: hugeText(),
					success: true,
					duration: 1234,
				},
			]),
		];

		const rawSerializedLength = JSON.stringify(messages).length;
		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(rawSerializedLength).toBeGreaterThan(390_000);
		expect(serialized.length).toBeLessThan(120_000);
		expect(serialized).not.toContain(MIDDLE_SENTINEL);
		// Middle truncation must preserve the head and tail of the output.
		expect(serialized).toContain(HEAD_MARKER);
		expect(serialized).toContain(TAIL_MARKER);
	});

	it("truncates a huge nested `query` string in run_commands structured output", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			toolUseMessage("call_1", "run_commands", {
				commands: ["bash -c '...giant heredoc...'"],
			}),
			structuredToolResultMessage("call_1", "run_commands", [
				{
					query: hugeText(),
					result: "ok",
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized.length).toBeLessThan(120_000);
		expect(serialized).not.toContain(MIDDLE_SENTINEL);
		expect(serialized).toContain(HEAD_MARKER);
		expect(serialized).toContain(TAIL_MARKER);
	});

	it("truncates a huge file payload in read_files structured output", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			toolUseMessage("call_1", "read_files", {
				files: [{ path: "/tmp/big.txt" }],
			}),
			structuredToolResultMessage("call_1", "read_files", [
				{
					query: "/tmp/big.txt",
					result: hugeText(),
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized.length).toBeLessThan(120_000);
		expect(serialized).not.toContain(MIDDLE_SENTINEL);
		expect(serialized).toContain(HEAD_MARKER);
		expect(serialized).toContain(TAIL_MARKER);
		// The latest read of a file must not be rewritten as outdated.
		expect(serialized).not.toContain("[outdated");
	});

	it("omits an oversized read_files image result without corrupting base64", () => {
		const oversizedImage = imageData(96);
		const builder = new MessageBuilder(
			50_000,
			new Set(["read_files"]),
			1_000_000,
			{
				maxImageEncodedBytes: 48,
				maxImageDecodedBytes: 48,
				maxTotalMediaBytes: 512,
			},
		);
		const messages: Message[] = [
			toolUseMessage("call_1", "read_files", {
				files: [{ path: "/tmp/large.png" }],
			}),
			structuredToolResultMessage("call_1", "read_files", [
				{
					query: "/tmp/large.png",
					result: [
						"Successfully read image",
						{
							type: "image",
							data: oversizedImage,
							mediaType: "image/png",
						},
					],
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain(oversizedImage);
		expect(serialized).not.toContain("...[truncated");
		expect(messages).toEqual([
			messages[0],
			structuredToolResultMessage("call_1", "read_files", [
				{
					query: "/tmp/large.png",
					result: [
						"Successfully read image",
						{
							type: "image",
							data: oversizedImage,
							mediaType: "image/png",
						},
					],
					success: true,
				},
			]),
		]);
	});

	it("omits oversized custom structured image results even when text truncation is not targeted", () => {
		const oversizedImage = imageData(96);
		const builder = new MessageBuilder(
			50_000,
			new Set(["read_files"]),
			1_000_000,
			{
				maxImageEncodedBytes: 48,
				maxImageDecodedBytes: 48,
				maxTotalMediaBytes: 512,
			},
		);
		const messages: Message[] = [
			toolUseMessage("call_1", "custom_mcp_tool", {
				path: "/tmp/large.png",
			}),
			structuredToolResultMessage("call_1", "custom_mcp_tool", [
				{
					query: "/tmp/large.png",
					result: {
						type: "image",
						data: oversizedImage,
						mediaType: "image/png",
					},
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain(oversizedImage);
		expect(serialized).not.toContain("...[truncated");
	});

	it("omits malformed image-shaped objects instead of counting them as free text", () => {
		const hiddenPayload = imageData(4096);
		const builder = new MessageBuilder(
			50_000,
			new Set(["read_files"]),
			1_000_000,
			{
				maxImageEncodedBytes: 128,
				maxImageDecodedBytes: 128,
				maxTotalMediaBytes: 128,
			},
		);
		const messages: Message[] = [
			toolUseMessage("call_1", "custom_mcp_tool", {
				path: "/tmp/malformed.png",
			}),
			structuredToolResultMessage("call_1", "custom_mcp_tool", [
				{
					query: "/tmp/malformed.png",
					result: {
						type: "image",
						data: hiddenPayload,
					},
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain(hiddenPayload);
		expect(serialized).not.toContain("...[truncated");
	});

	it("keeps valid small read_files images as native provider media", () => {
		const smallImage = imageData(16);
		const builder = new MessageBuilder(
			50_000,
			new Set(["read_files"]),
			1_000_000,
			{
				maxImageEncodedBytes: 128,
				maxImageDecodedBytes: 128,
				maxTotalMediaBytes: 128,
			},
		);
		const messages: Message[] = [
			toolUseMessage("call_1", "read_files", {
				files: [{ path: "/tmp/small.png" }],
			}),
			structuredToolResultMessage("call_1", "read_files", [
				{
					query: "/tmp/small.png",
					result: [
						"Successfully read image",
						{
							type: "image",
							data: smallImage,
							mediaType: "image/png",
						},
					],
					success: true,
				},
			]),
		];

		const built = builder.buildForApi(messages);
		const agentMessages = messagesToAgentMessages(built);
		const aiSdkMessages = formatMessagesForAiSdk(
			undefined,
			agentMessages.map(({ role, content }) => ({
				role,
				content,
			})) as unknown as AiSdkFormatterMessage[],
		);
		const serialized = JSON.stringify(aiSdkMessages);

		expect(serialized).toContain('"type":"image-data"');
		expect(serialized).toContain(smallImage);
		expect(serialized).not.toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
	});

	it("applies the total media budget across otherwise valid images", () => {
		const firstImage = imageData(16);
		const secondImage = imageData(16, 2);
		const builder = new MessageBuilder(
			50_000,
			new Set(["read_files"]),
			1_000_000,
			{
				maxImageEncodedBytes: 128,
				maxImageDecodedBytes: 128,
				maxTotalMediaBytes: Buffer.byteLength(firstImage, "utf8"),
			},
		);
		const messages: Message[] = [
			toolUseMessage("call_1", "read_files", {
				files: [{ path: "/tmp/a.png" }, { path: "/tmp/b.png" }],
			}),
			structuredToolResultMessage("call_1", "read_files", [
				{
					query: "/tmp/a.png",
					result: [
						"Successfully read image",
						{
							type: "image",
							data: firstImage,
							mediaType: "image/png",
						},
					],
					success: true,
				},
				{
					query: "/tmp/b.png",
					result: [
						"Successfully read image",
						{
							type: "image",
							data: secondImage,
							mediaType: "image/png",
						},
					],
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized).toContain(firstImage);
		expect(serialized).not.toContain(secondImage);
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
	});

	it("truncates a huge fetch_web_content structured result", () => {
		// The web-fetch executor allows responses up to 5MB, so this tool must
		// be covered by the truncation targets like the other bulk-output tools.
		const builder = new MessageBuilder();
		const messages: Message[] = [
			toolUseMessage("call_1", "fetch_web_content", {
				requests: [{ url: "https://example.com/huge-page" }],
			}),
			structuredToolResultMessage("call_1", "fetch_web_content", [
				{
					query: "https://example.com/huge-page",
					result: hugeText(),
					success: true,
				},
			]),
		];

		const result = builder.buildForApi(messages);
		const serialized = JSON.stringify(result);

		expect(serialized.length).toBeLessThan(120_000);
		expect(serialized).not.toContain(MIDDLE_SENTINEL);
		expect(serialized).toContain(HEAD_MARKER);
		expect(serialized).toContain(TAIL_MARKER);
	});

	it("applies the aggregate text budget to nested structured strings", () => {
		const builder = new MessageBuilder(
			50_000,
			new Set(["run_commands", "read_files"]),
			100_000,
		);
		// Five results of ~40k chars each: every nested string is below the
		// per-result limit, but the aggregate (~200k) exceeds the budget.
		const messages: Message[] = [];
		for (let i = 0; i < 5; i++) {
			const name = i % 2 === 0 ? "run_commands" : "read_files";
			messages.push(
				toolUseMessage(`call_${i}`, name, { commands: [`cmd ${i}`] }),
				structuredToolResultMessage(`call_${i}`, name, [
					{
						query: `cmd ${i}`,
						result: `chunk_${i}_`.repeat(4_000),
						success: true,
					},
				]),
			);
		}

		const result = builder.buildForApi(messages);

		let toolResultStringBytes = 0;
		for (const message of result) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type === "tool_result") {
					toolResultStringBytes += sumStringBytes(block.content);
				}
			}
		}

		expect(toolResultStringBytes).toBeLessThanOrEqual(100_000);
		expect(JSON.stringify(result)).toContain("provider request budget");
	});

	it("does not mutate the original structured tool results", () => {
		const builder = new MessageBuilder(
			10_000,
			new Set(["run_commands"]),
			20_000,
		);
		const messages: Message[] = [
			toolUseMessage("call_1", "run_commands", { commands: ["cat a.log"] }),
			structuredToolResultMessage("call_1", "run_commands", [
				{
					query: "cat a.log",
					result: hugeText(50_000),
					success: true,
				},
			]),
			toolUseMessage("call_2", "run_commands", { commands: ["cat b.log"] }),
			structuredToolResultMessage("call_2", "run_commands", [
				{
					query: "cat b.log",
					result: hugeText(50_000),
					success: true,
				},
			]),
		];
		const snapshot = structuredClone(messages);

		const result = builder.buildForApi(messages);

		expect(messages).toEqual(snapshot);
		expect(JSON.stringify(result)).not.toContain(MIDDLE_SENTINEL);
	});

	it("keeps huge nested strings out of provider-formatted AI SDK messages", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			toolUseMessage("call_1", "run_commands", {
				commands: ["cat big.log"],
			}),
			structuredToolResultMessage("call_1", "run_commands", [
				{
					query: "cat big.log",
					result: hugeText(),
					success: true,
				},
			]),
		];

		const built = builder.buildForApi(messages);
		const agentMessages = messagesToAgentMessages(built);
		const aiSdkMessages = formatMessagesForAiSdk(
			undefined,
			agentMessages.map(({ role, content }) => ({
				role,
				content,
			})) as unknown as AiSdkFormatterMessage[],
		);
		const serialized = JSON.stringify(aiSdkMessages);

		expect(serialized.length).toBeLessThan(130_000);
		expect(serialized).not.toContain(MIDDLE_SENTINEL);
		expect(serialized).toContain(HEAD_MARKER);
		expect(serialized).toContain(TAIL_MARKER);
	});
});
