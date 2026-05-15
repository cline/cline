import { describe, expect, it } from "vitest";
import { createGatewayApiHandler, toGatewayRequestMessages } from "./compat";
import type { Message } from "./types";

describe("createGatewayApiHandler.getMessages", () => {
	it("preserves structured tool_result content for gateway requests", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "run_commands",
						input: { commands: ["echo hello"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: [
							{
								query: "echo hello",
								result: "hello\n",
								success: true,
							},
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		expect(request.messages).toHaveLength(2);
		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_1",
					toolName: "run_commands",
					output: [
						{
							query: "echo hello",
							result: "hello\n",
							success: true,
						},
					],
					isError: false,
				},
			],
		});
	});

	it("normalizes mixed legacy blocks and structured tool results", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_2",
						name: "run_commands",
						input: { commands: ["pwd"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_2",
						content: [
							{ type: "text", text: "Command output:" },
							{
								query: "pwd",
								result: "/tmp/project\n",
								success: true,
							},
							{ type: "file", path: "/tmp/log.txt", content: "log line" },
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		// `toGatewayRequestMessages` now forwards the raw `tool_result.content`
		// unchanged. Downstream `formatMessagesForAiSdk` /
		// `toAiSdkToolResultOutput` is responsible for any flattening or
		// image-extraction; this layer only translates Cline's `Message[]`
		// shape into AI-SDK formatter parts.
		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_2",
					toolName: "run_commands",
					output: [
						{ type: "text", text: "Command output:" },
						{
							query: "pwd",
							result: "/tmp/project\n",
							success: true,
						},
						{ type: "file", path: "/tmp/log.txt", content: "log line" },
					],
					isError: false,
				},
			],
		});
	});

	it("forwards nested images inside structured tool results to the AI SDK formatter", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_3",
						name: "read_files",
						input: { file_paths: ["/tmp/demo.png"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_3",
						content: [
							{
								query: "/tmp/demo.png",
								success: true,
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: "YWJj",
										mediaType: "image/png",
									},
								],
							},
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		// The compat layer no longer detaches images into sibling user
		// messages — that responsibility moved into
		// `toAiSdkToolResultOutput`, which extracts every nested `image`
		// content block into native `image-data` content parts. The
		// gateway request therefore contains the original
		// `ToolOperationResult[]` content unchanged, with the image block
		// still embedded inside `result`.
		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_3",
					toolName: "read_files",
					output: [
						{
							query: "/tmp/demo.png",
							success: true,
							result: [
								{ type: "text", text: "Successfully read image" },
								{
									type: "image",
									data: "YWJj",
									mediaType: "image/png",
								},
							],
						},
					],
					isError: false,
				},
			],
		});
		expect(request.messages[1]?.content).toHaveLength(1);
	});

	it("preserves is_error for structured tool results", () => {
		const handler = createGatewayApiHandler({
			providerId: "openai-compatible",
			clientType: "openai-compatible",
			modelId: "test-model",
			apiKey: "test-key",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_4",
						name: "run_commands",
						input: { commands: ["false"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_4",
						is_error: true,
						content: [
							{
								query: "false",
								result: "",
								error: "Command failed: exit 1",
								success: false,
							},
						],
					},
				],
			},
		];

		const request = handler.getMessages("", messages) as {
			messages: Array<{
				role: string;
				content: Array<Record<string, unknown>>;
			}>;
		};

		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_4",
					toolName: "run_commands",
					output: [
						{
							query: "false",
							result: "",
							error: "Command failed: exit 1",
							success: false,
						},
					],
					isError: true,
				},
			],
		});
	});
});

/**
 * Tests for compat.ts message conversion (LlmsProviders.Message → AgentMessage).
 *
 * Specifically guards the read_file image-passing path: the orchestrator's
 * `tool_result` block carries an array of {text, image} content blocks, and we
 * MUST forward that array as the AgentMessage `tool-result` `output` so the
 * downstream `toAiSdkToolResultOutput` formatter emits an AI SDK
 * `{type:"content", value:[{type:"media", ...}, {type:"text", ...}]}`. If we
 * collapse the array to a string here the image bytes are dropped and the
 * model hallucinates.
 */
describe("toGatewayRequestMessages — tool_result with images", () => {
	it("forwards text+image content arrays as the tool-result output", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_1",
						name: "read_file",
						input: { path: "/tmp/image.jpg" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: [
							{ type: "text", text: "Successfully read image" },
							{
								type: "image",
								data: "BASE64DATA",
								mediaType: "image/jpeg",
							},
						],
						is_error: false,
					},
				],
			},
		];

		const [, userMessage] = toGatewayRequestMessages(messages);

		// The user message must contain ONE tool-result block (no orphan image siblings).
		expect(userMessage.content).toHaveLength(1);
		const toolResult = userMessage.content[0] as Record<string, unknown>;

		expect(toolResult.type).toBe("tool-result");
		expect(toolResult.toolCallId).toBe("call_1");
		expect(toolResult.toolName).toBe("read_file");
		expect(toolResult.isError).toBe(false);

		// `output` must be the full structured content-block array — including
		// the image — so toAiSdkToolResultOutput can emit `{type:"content"}`.
		const output = toolResult.output as Array<Record<string, unknown>>;
		expect(Array.isArray(output)).toBe(true);
		expect(output).toHaveLength(2);
		expect(output[0]).toEqual({
			type: "text",
			text: "Successfully read image",
		});
		expect(output[1]).toEqual({
			type: "image",
			data: "BASE64DATA",
			mediaType: "image/jpeg",
		});
	});

	it("forwards text-only tool_result content unchanged for downstream normalisation", () => {
		// The compat layer no longer collapses `[{type:'text', text}]` into
		// a bare string — the AI SDK formatter accepts the content-block
		// array directly and emits it as a `{type:'content'}` tool-result
		// output. (`toAiSdkToolResultOutput` then forwards the text part
		// through unchanged.)
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "call_2",
						name: "read_file",
						input: { path: "/tmp/notes.txt" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_2",
						content: [{ type: "text", text: "hello world" }],
					},
				],
			},
		];

		const [, userMessage] = toGatewayRequestMessages(messages);
		expect(userMessage.content).toHaveLength(1);
		const toolResult = userMessage.content[0] as Record<string, unknown>;
		expect(toolResult.output).toEqual([{ type: "text", text: "hello world" }]);
	});

	it("passes plain string content through unchanged", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_3",
						content: "raw string output",
					},
				],
			},
		];

		const [userMessage] = toGatewayRequestMessages(messages);
		const toolResult = userMessage.content[0] as Record<string, unknown>;
		expect(toolResult.output).toBe("raw string output");
	});
});
