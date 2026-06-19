import {
	type AiSdkFormatterMessage,
	formatMessagesForAiSdk,
	type Message,
	type ToolResultContent,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { messagesToAgentMessages } from "../../runtime/config/agent-message-codec";
import {
	DEFAULT_MAX_FILE_CONTENT_CHARS,
	DEFAULT_MAX_TOOL_RESULT_CHARS,
	DEFAULT_MAX_TOTAL_TEXT_BYTES,
	getMessageBuilderOptionsFromEnv,
	MessageBuilder,
} from "./message-builder";

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
		const builder = new MessageBuilder({ maxToolResultChars: 100 });
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

	it("uses an aggressive per-result cap and a loose aggregate budget", () => {
		expect(DEFAULT_MAX_TOOL_RESULT_CHARS).toBe(8_000);
		expect(DEFAULT_MAX_FILE_CONTENT_CHARS).toBe(50_000);
		// The aggregate budget stays loose on purpose: budget truncation
		// rewrites mid-transcript bytes and breaks provider prefix caching, so
		// it must stay a rare overflow valve while the per-result cap (which
		// is deterministic per content) does the routine work.
		expect(DEFAULT_MAX_TOTAL_TEXT_BYTES).toBe(6_000_000);
	});

	it("accepts named limit options for targeted provider payload tests", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 120,
			maxTotalTextBytes: 10_000,
		});
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "run_commands",
						input: { commands: ["cat big.log"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "run_commands",
						content: "a".repeat(500),
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
		expect(block.content.length).toBeLessThanOrEqual(120);
		expect(block.content).toContain("...[truncated");
	});

	it("parses message-builder limit environment overrides", () => {
		const builder = new MessageBuilder(
			getMessageBuilderOptionsFromEnv({
				CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS: "96",
				CLINE_MESSAGE_BUILDER_MAX_TOTAL_TEXT_BYTES: "5000",
			}),
		);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "search_codebase",
						input: { queries: ["needle"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "search_codebase",
						content: "b".repeat(500),
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
		expect(block.content.length).toBeLessThanOrEqual(96);
		expect(block.content).toContain("...[truncated");
	});

	it("ignores zero env overrides instead of disabling the limits", () => {
		const options = getMessageBuilderOptionsFromEnv({
			CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS: "0",
			CLINE_MESSAGE_BUILDER_MAX_TOTAL_TEXT_BYTES: "0",
		});
		expect(options.maxToolResultChars).toBeUndefined();
		expect(options.maxTotalTextBytes).toBeUndefined();
	});

	it("applies an aggregate text budget across targeted tool results", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 20_000,
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 12_000,
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 10_000,
		});
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

	it("caps assistant text with repeated DSML tool-call fragments before provider requests", () => {
		const builder = new MessageBuilder();
		const dsmlFragment = [
			"<\uFF5CDSML\uFF5Ctool_calls>",
			'<\uFF5CDSML\uFF5Cinvoke name="read_file">',
			`{"path":"/tmp/circuit-fibsqrt.ts","payload":"${"x".repeat(1_200)}"}`,
			"</\uFF5CDSML\uFF5Cinvoke>",
			"</\uFF5CDSML\uFF5Ctool_calls>",
			"<tool_call>",
			"</tool_call>",
		].join("\n");
		const assistantText = `I will inspect the circuit.\n${dsmlFragment.repeat(437)}\nDone.`;
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: assistantText }],
			},
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;

		expect(assistantText.length).toBeGreaterThan(500_000);
		expect(block?.type).toBe("text");
		if (block?.type !== "text") {
			throw new Error("expected assistant text block");
		}
		expect(block.text.length).toBeLessThanOrEqual(12_000);
		expect(block.text).toContain("assistant text truncated: omitted");
		expect(block.text).toContain("repeated tool-call markup");
		expect(block.text.match(/DSML/g)?.length ?? 0).toBeLessThan(40);
		expect(messages[0].content).toEqual([
			{ type: "text", text: assistantText },
		]);
	});

	it("keeps repeated assistant tool-call markup out of provider-formatted AI SDK payloads", () => {
		const builder = new MessageBuilder();
		const dsmlFragment = [
			"<\uFF5CDSML\uFF5Ctool_calls>",
			'<\uFF5CDSML\uFF5Cinvoke name="run_command">',
			`{"command":"${"printf x; ".repeat(150)}"}`,
			"</\uFF5CDSML\uFF5Cinvoke>",
			"</\uFF5CDSML\uFF5Ctool_calls>",
		].join("\n");
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: dsmlFragment.repeat(500) }],
			},
			{
				role: "user",
				content: [{ type: "text", text: "next request" }],
			},
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

		expect(JSON.stringify(messages).length).toBeGreaterThan(650_000);
		expect(serialized.length).toBeLessThan(25_000);
		expect(serialized).toContain("assistant text truncated: omitted");
		expect(serialized.match(/DSML/g)?.length ?? 0).toBeLessThan(40);
	});

	it("caps oversized top-level assistant string content with an omitted-char marker", () => {
		const builder = new MessageBuilder({ maxAssistantTextChars: 1_000 });
		const assistantText = `Lead\n${"normal assistant answer ".repeat(200)}\nTail`;
		const messages: Message[] = [
			{
				role: "assistant",
				content: assistantText,
			},
		];

		const result = builder.buildForApi(messages);

		expect(typeof result[0].content).toBe("string");
		expect(result[0].content.length).toBeLessThanOrEqual(1_000);
		expect(result[0].content).toContain("assistant text truncated: omitted");
		expect(messages[0].content).toBe(assistantText);
	});

	it("preserves normal long assistant answers below the assistant text cap", () => {
		const builder = new MessageBuilder();
		const answer = [
			"Summary:",
			"A".repeat(80_000),
			"Implementation notes:",
			"B".repeat(80_000),
			"Final answer.",
		].join("\n");
		const messages: Message[] = [
			{
				role: "assistant",
				content: [{ type: "text", text: answer }],
			},
		];

		const result = builder.buildForApi(messages);

		expect(result).toEqual(messages);
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

	function serializeForAiSdk(messages: Message[]): string {
		const agentMessages = messagesToAgentMessages(messages);
		const aiSdkMessages = formatMessagesForAiSdk(
			undefined,
			agentMessages.map(({ role, content }) => ({
				role,
				content,
			})) as unknown as AiSdkFormatterMessage[],
		);
		return JSON.stringify(aiSdkMessages);
	}

	function firstToolOperationResult(
		result: Message[],
	): ToolOperationResultLike {
		const block = Array.isArray(result[1]?.content)
			? result[1].content[0]
			: undefined;
		expect(block?.type).toBe("tool_result");
		if (block?.type !== "tool_result" || typeof block.content === "string") {
			throw new Error("expected structured tool_result");
		}
		const operation = block.content[0] as unknown;
		expect(operation).toBeTruthy();
		return operation as ToolOperationResultLike;
	}

	it("reduces a real-shaped multi-MB run_commands result to the default cap", () => {
		const builder = new MessageBuilder();
		const messages: Message[] = [
			toolUseMessage("call_1", "run_commands", {
				commands: ["python emit_multi_mb_output.py"],
			}),
			structuredToolResultMessage("call_1", "run_commands", [
				{
					query: "python emit_multi_mb_output.py",
					result: hugeText(2_500_000),
					success: true,
					duration: 4321,
				},
			]),
		];

		const rawSerializedLength = JSON.stringify(messages).length;
		const result = builder.buildForApi(messages);
		const operation = firstToolOperationResult(result);
		const output = operation.result;

		expect(rawSerializedLength).toBeGreaterThan(2_400_000);
		expect(typeof output).toBe("string");
		if (typeof output !== "string") {
			throw new Error("expected string result");
		}
		expect(output.length).toBeLessThanOrEqual(DEFAULT_MAX_TOOL_RESULT_CHARS);
		expect(output).toContain("...[truncated");
		expect(output).not.toContain(MIDDLE_SENTINEL);
		expect(output).toContain(HEAD_MARKER);
		expect(output).toContain(TAIL_MARKER);
		expect(sumStringBytes(operation)).toBeLessThan(
			DEFAULT_MAX_TOOL_RESULT_CHARS + 512,
		);
	});

	it("materially shrinks provider-formatted payloads compared with previous defaults", () => {
		const messages: Message[] = [];
		for (let i = 0; i < 20; i++) {
			messages.push(
				toolUseMessage(`call_${i}`, "run_commands", {
					commands: [`python noisy_task_${i}.py`],
				}),
				structuredToolResultMessage(`call_${i}`, "run_commands", [
					{
						query: `python noisy_task_${i}.py`,
						result: hugeText(300_000),
						success: true,
						duration: 1000 + i,
					},
				]),
			);
		}
		const previousDefaults = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 6_000_000,
		});
		const currentDefaults = new MessageBuilder();

		const previousPayload = serializeForAiSdk(
			previousDefaults.buildForApi(messages),
		);
		const currentPayload = serializeForAiSdk(
			currentDefaults.buildForApi(messages),
		);

		expect(previousPayload.length).toBeGreaterThan(900_000);
		expect(currentPayload.length).toBeLessThan(previousPayload.length * 0.25);
		expect(currentPayload.length).toBeLessThan(250_000);
		expect(currentPayload).not.toContain(MIDDLE_SENTINEL);
	});

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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 1_000_000,
			mediaBudget: {
				maxImageEncodedBytes: 48,
				maxImageDecodedBytes: 48,
				maxTotalMediaBytes: 512,
			},
		});
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

	it("omits oversized custom structured image results regardless of tool name", () => {
		const oversizedImage = imageData(96);
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 1_000_000,
			mediaBudget: {
				maxImageEncodedBytes: 48,
				maxImageDecodedBytes: 48,
				maxTotalMediaBytes: 512,
			},
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 1_000_000,
			mediaBudget: {
				maxImageEncodedBytes: 128,
				maxImageDecodedBytes: 128,
				maxTotalMediaBytes: 128,
			},
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 1_000_000,
			mediaBudget: {
				maxImageEncodedBytes: 128,
				maxImageDecodedBytes: 128,
				maxTotalMediaBytes: 128,
			},
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 1_000_000,
			mediaBudget: {
				maxImageEncodedBytes: 128,
				maxImageDecodedBytes: 128,
				maxTotalMediaBytes: Buffer.byteLength(firstImage, "utf8"),
			},
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 100_000,
		});
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
		const builder = new MessageBuilder({
			maxToolResultChars: 10_000,
			maxTotalTextBytes: 20_000,
		});
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

/**
 * Coverage for default-on truncation (no tool allowlist), tool_use input
 * budget accounting, tool_result.name fallback, and binary block protection.
 */
describe("MessageBuilder default-on truncation", () => {
	it("truncates huge results from MCP/custom tools that were never on the old allowlist", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 100 });
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "mcp__github__get_pull_request_diff",
						input: { pull_number: 42 },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "mcp__github__get_pull_request_diff",
						content: "d".repeat(5_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;
		if (block?.type !== "tool_result" || typeof block.content !== "string") {
			throw new Error("expected tool_result with string content");
		}
		expect(block.content.length).toBeLessThanOrEqual(100);
		expect(block.content).toContain("...[truncated");
	});

	it("collects non-builtin tool results as aggregate budget candidates", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 20_000,
		});
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "my_custom_dump_tool",
						input: {},
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "my_custom_dump_tool",
						content: [{ type: "text", text: "e".repeat(30_000) }],
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;
		if (block?.type !== "tool_result" || !Array.isArray(block.content)) {
			throw new Error("expected tool_result with array content");
		}
		const entry = block.content[0];
		if (entry.type !== "text") {
			throw new Error("expected text entry");
		}
		expect(Buffer.byteLength(entry.text, "utf8")).toBeLessThanOrEqual(20_000);
		expect(entry.text).toContain("provider request budget");
	});

	it("counts tool_use input strings toward the aggregate budget", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 20_000,
		});
		const hugeInput = "f".repeat(15_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "run_commands",
						input: { commands: [hugeInput] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "run_commands",
						content: "g".repeat(10_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		// Result alone (10k) is under the 20k budget; only counting the 15k
		// tool_use input pushes the total over and forces budget truncation.
		const resultBlock = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;
		if (
			resultBlock?.type !== "tool_result" ||
			typeof resultBlock.content !== "string"
		) {
			throw new Error("expected tool_result with string content");
		}
		expect(resultBlock.content).toContain("provider request budget");

		// Tool results absorb the overflow first, so the model-generated
		// arguments stay byte-identical whenever results alone can cover it.
		const useBlock = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		if (useBlock?.type !== "tool_use") {
			throw new Error("expected tool_use");
		}
		expect(useBlock.input).toEqual({ commands: [hugeInput] });
	});

	it("truncates oversized tool_use inputs as a last resort when results cannot absorb the overflow", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 50_000,
			maxTotalTextBytes: 20_000,
		});
		const hugeInput = "f".repeat(40_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "run_commands",
						input: { commands: [hugeInput] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "run_commands",
						content: "g".repeat(10_000),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);

		// The result shrinks to the floor first, but that alone cannot bring
		// 50k total under the 20k budget, so the input is truncated too.
		const useBlock = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		if (useBlock?.type !== "tool_use") {
			throw new Error("expected tool_use");
		}
		const builtInput = (useBlock.input as { commands: string[] }).commands[0];
		expect(builtInput).toContain("provider request budget");
		expect(Buffer.byteLength(builtInput, "utf8")).toBeLessThan(40_000);

		const totalBytes = JSON.stringify(result).length;
		expect(totalBytes).toBeLessThan(25_000);

		// Original history must stay untouched.
		const originalUse = Array.isArray(messages[0].content)
			? messages[0].content[0]
			: undefined;
		if (originalUse?.type !== "tool_use") {
			throw new Error("expected tool_use");
		}
		expect((originalUse.input as { commands: string[] }).commands[0]).toBe(
			hugeInput,
		);
	});

	it("rewrites outdated reads on orphaned tool results via the name fallback", () => {
		const builder = new MessageBuilder({ minOutdatedRewriteBytes: 0 });
		const oldRead = JSON.stringify([
			{ path: "/tmp/a.txt", result: "OLD CONTENT" },
		]);
		const messages: Message[] = [
			{
				role: "user",
				// Orphaned result: its tool_use was dropped (e.g. compaction), so
				// only the name field identifies it as a read tool.
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_orphan",
						name: "read_files",
						content: oldRead,
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_2",
						name: "read_files",
						input: { file_paths: ["/tmp/a.txt"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_2",
						name: "read_files",
						content: JSON.stringify([
							{ path: "/tmp/a.txt", result: "NEW CONTENT" },
						]),
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const orphan = Array.isArray(result[0].content)
			? result[0].content[0]
			: undefined;
		if (orphan?.type !== "tool_result") {
			throw new Error("expected tool_result");
		}
		expect(JSON.stringify(orphan.content)).toContain(
			"[outdated - see the latest file content]",
		);
		expect(JSON.stringify(orphan.content)).not.toContain("OLD CONTENT");
		expect(JSON.stringify(result[2].content)).toContain("NEW CONTENT");
	});

	it("truncates unsupported document data blocks nested in structured results", () => {
		const builder = new MessageBuilder({
			maxToolResultChars: 100,
			maxTotalTextBytes: 1_000,
		});
		const pdfData = "p".repeat(5_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "fetch_web_content",
						input: { url: "https://example.com/report.pdf" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "fetch_web_content",
						content: [
							{
								query: "https://example.com/report.pdf",
								result: [
									{
										type: "document",
										data: pdfData,
										mediaType: "application/pdf",
									},
									{ type: "text", text: "h".repeat(5_000) },
								],
								success: true,
							},
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;
		if (block?.type !== "tool_result" || !Array.isArray(block.content)) {
			throw new Error("expected tool_result with array content");
		}
		const entry = block.content[0] as unknown as {
			result: Array<{ type: string; data?: string; text?: string }>;
		};
		const doc = entry.result.find((item) => item.type === "document");
		const text = entry.result.find((item) => item.type === "text");
		expect(doc?.data).not.toBe(pdfData);
		expect(doc?.data?.length).toBeLessThanOrEqual(100);
		expect(doc?.data).toContain("...[truncated");
		expect(text?.text).toContain("...[truncated");

		const formattedPayload = JSON.stringify(
			formatMessagesForAiSdk(
				undefined,
				messagesToAgentMessages(result).map(({ role, content }) => ({
					role,
					content,
				})) as unknown as AiSdkFormatterMessage[],
			),
		);
		expect(formattedPayload).not.toContain(pdfData);
		expect(formattedPayload.length).toBeLessThan(1_000);
	});

	it("preserves nested image data that the formatter hoists natively", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 100 });
		const imageData = "i".repeat(5_000);
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "read_files",
						input: { file_paths: ["/tmp/image.png"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "read_files",
						content: [
							{
								query: "/tmp/image.png",
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: imageData,
										mediaType: "image/png",
									},
									{ type: "text", text: "h".repeat(5_000) },
								],
								success: true,
							},
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;
		if (block?.type !== "tool_result" || !Array.isArray(block.content)) {
			throw new Error("expected tool_result with array content");
		}
		const entry = block.content[0] as unknown as {
			result: Array<{ type: string; data?: string; text?: string }>;
		};
		const image = entry.result.find((item) => item.type === "image");
		const longText = entry.result.find(
			(item) => item.type === "text" && item.text?.startsWith("h"),
		);
		expect(image?.data).toBe(imageData);
		expect(longText?.text).toContain("...[truncated");

		const formattedPayload = JSON.stringify(
			formatMessagesForAiSdk(
				undefined,
				messagesToAgentMessages(result).map(({ role, content }) => ({
					role,
					content,
				})) as unknown as AiSdkFormatterMessage[],
			),
		);
		expect(formattedPayload).toContain('"type":"image-data"');
		expect(formattedPayload).toContain(imageData);
	});

	it("truncates textual {type, data} payloads that are not known binary blocks", () => {
		const builder = new MessageBuilder({ maxToolResultChars: 100 });
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_1",
						name: "dump_server_logs",
						input: {},
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "tool_1",
						name: "dump_server_logs",
						content: [
							{
								query: "logs",
								result: [{ type: "log", data: "x".repeat(5_000) }],
								success: true,
							},
						] as unknown as ToolResultContent["content"],
					},
				],
			},
		];

		const result = builder.buildForApi(messages);
		const block = Array.isArray(result[1].content)
			? result[1].content[0]
			: undefined;
		if (block?.type !== "tool_result" || !Array.isArray(block.content)) {
			throw new Error("expected tool_result with array content");
		}
		const entry = block.content[0] as unknown as {
			result: Array<{ type: string; data: string }>;
		};
		const log = entry.result.find((item) => item.type === "log");
		if (!log) {
			throw new Error("expected log entry");
		}
		expect(log.data.length).toBeLessThanOrEqual(100);
		expect(log.data).toContain("...[truncated");
	});

	it("caps user file attachments separately from tool results", () => {
		const builder = new MessageBuilder();
		const underFileCap = "a".repeat(20_000);
		const overFileCap = "b".repeat(60_000);
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "file", path: "/tmp/notes.md", content: underFileCap },
					{ type: "file", path: "/tmp/dump.log", content: overFileCap },
					{ type: "text", text: "summarize these" },
				],
			},
		];

		const result = builder.buildForApi(messages);
		const content = result[0].content;
		if (!Array.isArray(content)) {
			throw new Error("expected array content");
		}
		const [small, large] = content;
		if (small?.type !== "file" || large?.type !== "file") {
			throw new Error("expected file blocks");
		}
		// 20k would be mutilated under the 8k tool-result cap; attachments get
		// the dedicated file cap instead.
		expect(small.content).toBe(underFileCap);
		expect(large.content.length).toBeLessThanOrEqual(
			DEFAULT_MAX_FILE_CONTENT_CHARS,
		);
		expect(large.content).toContain("...[truncated");
	});
});
