import { describe, expect, it } from "vitest";
import { createGatewayApiHandler } from "./compat";
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

		expect(request.messages[1]).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool-result",
					toolCallId: "toolu_2",
					toolName: "run_commands",
					output: [
						"Command output:",
						{
							query: "pwd",
							result: "/tmp/project\n",
							success: true,
						},
						"log line",
					],
					isError: false,
				},
			],
		});
	});

	it("extracts nested images from structured tool results", () => {
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
							result: ["Successfully read image"],
						},
					],
					isError: false,
				},
				{
					type: "image",
					image: "data:image/png;base64,YWJj",
					mediaType: "image/png",
				},
			],
		});
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
