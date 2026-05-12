import { describe, expect, it } from "vitest";
import {
	formatMessagesForAiSdk,
	sanitizeSurrogates,
	toAiSdkToolResultOutput,
} from "./ai-sdk-format";

describe("formatMessagesForAiSdk", () => {
	it("omits empty system messages", () => {
		const messages = formatMessagesForAiSdk("", [
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
		]);
	});

	it("omits whitespace-only system messages", () => {
		const messages = formatMessagesForAiSdk("   \n\t  ", [
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
		]);
	});

	it("preserves providerOptions on text parts", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "cache this",
						providerOptions: {
							openrouter: { cache_control: { type: "ephemeral" } },
						},
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "cache this",
						providerOptions: {
							openrouter: { cache_control: { type: "ephemeral" } },
						},
					},
				],
			},
		]);
	});

	it("emits tool results as tool-role messages", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll inspect that." },
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "run_commands",
						input: { commands: ["pwd"] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "run_commands",
						output: { ok: true },
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "hey" }],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I'll inspect that." },
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "run_commands",
						input: { commands: ["pwd"] },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "run_commands",
						output: { type: "json", value: { ok: true } },
					},
				],
			},
		]);
	});

	it("splits mixed user text and tool results into valid messages", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "text", text: "Here is the tool output." },
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_file",
						output: "contents",
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Here is the tool output." }],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_file",
						output: { type: "text", value: "contents" },
					},
				],
			},
		]);
	});

	it("forwards image content blocks as AI SDK content/image-data parts", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "read_file",
						output: [
							{ type: "text", text: "Successfully read image" },
							{
								type: "image",
								data: "BASE64DATA",
								mediaType: "image/jpeg",
							},
						],
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "read_file",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "Successfully read image" },
								{
									type: "image-data",
									data: "BASE64DATA",
									mediaType: "image/jpeg",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("extracts nested image content blocks from a read_files tool result", () => {
		// `read_files` returns its output as a `ToolOperationResult[]` whose
		// `result` is a content-block array `[{type:'text'}, {type:'image'}]`.
		// `formatMessagesForAiSdk` (via `toAiSdkToolResultOutput`) must walk
		// the tree, hoist any nested image blocks out as native `image-data`
		// content parts, and forward the remaining metadata as a JSON-encoded
		// text block so the model receives multimodal input rather than a
		// JSON-stringified base64 blob.
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_img",
						toolName: "read_files",
						input: { files: [{ path: "/tmp/image.jpg" }] },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "read_files",
						output: [
							{
								query: "/tmp/image.jpg",
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: "BASE64DATA",
										mediaType: "image/jpeg",
									},
								],
								success: true,
							},
						],
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_img",
						toolName: "read_files",
						input: { files: [{ path: "/tmp/image.jpg" }] },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{
									type: "text",
									text: JSON.stringify([
										{
											query: "/tmp/image.jpg",
											result: ["Successfully read image"],
											success: true,
										},
									]),
								},
								{
									type: "image-data",
									data: "BASE64DATA",
									mediaType: "image/jpeg",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("sanitizes nested strings before stringifying extracted image metadata", () => {
		const output = toAiSdkToolResultOutput({
			query: "bad\uD800name.jpg",
			result: [
				{ type: "text", text: "Successfully read image" },
				{
					type: "image",
					data: "BASE64DATA",
					mediaType: "image/jpeg",
				},
			],
			success: true,
		});

		expect(output).toEqual({
			type: "content",
			value: [
				{
					type: "text",
					text: JSON.stringify({
						query: "bad\uFFFDname.jpg",
						result: ["Successfully read image"],
						success: true,
					}),
				},
				{
					type: "image-data",
					data: "BASE64DATA",
					mediaType: "image/jpeg",
				},
			],
		});
	});

	it("extracts every nested image block from a multi-file read_files tool result", () => {
		// Regression: a `read_files` call with multiple image paths returns
		// a single `ToolOperationResult[]` whose entries each carry one
		// `{type:'image', data, mediaType}` block. All of them must end up
		// as native `image-data` content parts attached to the tool-result.
		// Previously only the first was preserved (or all were lost on the
		// SDK-direct path), causing the model to "see" the wrong image set.
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_imgs",
						toolName: "read_files",
						input: {
							files: [{ path: "/tmp/image.jpg" }, { path: "/tmp/image2.png" }],
						},
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_imgs",
						toolName: "read_files",
						output: [
							{
								query: "/tmp/image.jpg",
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: "JPEGDATA",
										mediaType: "image/jpeg",
									},
								],
								success: true,
							},
							{
								query: "/tmp/image2.png",
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: "PNGDATA",
										mediaType: "image/png",
									},
								],
								success: true,
							},
						],
					},
				],
			},
		]);

		// Both images must end up as image-data content parts on the
		// tool-result output, and no orphaned image messages may remain.
		expect(messages).toEqual([
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_imgs",
						toolName: "read_files",
						input: {
							files: [{ path: "/tmp/image.jpg" }, { path: "/tmp/image2.png" }],
						},
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_imgs",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{
									type: "text",
									text: JSON.stringify([
										{
											query: "/tmp/image.jpg",
											result: ["Successfully read image"],
											success: true,
										},
										{
											query: "/tmp/image2.png",
											result: ["Successfully read image"],
											success: true,
										},
									]),
								},
								{
									type: "image-data",
									data: "JPEGDATA",
									mediaType: "image/jpeg",
								},
								{
									type: "image-data",
									data: "PNGDATA",
									mediaType: "image/png",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("merges adjacent tool-result messages into one tool message", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_text",
						toolName: "read_file",
						input: { path: "/tmp/a.txt" },
					},
					{
						type: "tool-call",
						toolCallId: "call_image",
						toolName: "read_file",
						input: { path: "/tmp/image.jpg" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_text",
						toolName: "read_file",
						output: "text contents",
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_image",
						toolName: "read_file",
						output: [
							{ type: "text", text: "Successfully read image" },
							{
								type: "image",
								data: "BASE64DATA",
								mediaType: "image/jpeg",
							},
						],
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_text",
						toolName: "read_file",
						input: { path: "/tmp/a.txt" },
					},
					{
						type: "tool-call",
						toolCallId: "call_image",
						toolName: "read_file",
						input: { path: "/tmp/image.jpg" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_text",
						toolName: "read_file",
						output: { type: "text", value: "text contents" },
					},
					{
						type: "tool-result",
						toolCallId: "call_image",
						toolName: "read_file",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "Successfully read image" },
								{
									type: "image-data",
									data: "BASE64DATA",
									mediaType: "image/jpeg",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("falls back to json for non-content arrays", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_json",
						toolName: "list_things",
						output: [{ type: "unknown" }, { foo: "bar" }],
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_json",
						toolName: "list_things",
						output: {
							type: "json",
							value: [{ type: "unknown" }, { foo: "bar" }],
						},
					},
				],
			},
		]);
	});

	it("never emits content output for errors", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_err",
						toolName: "read_file",
						isError: true,
						output: [
							{ type: "text", text: "boom" },
							{
								type: "image",
								data: "BASE64DATA",
								mediaType: "image/jpeg",
							},
						],
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_err",
						toolName: "read_file",
						output: {
							type: "error-json",
							value: [
								{ type: "text", text: "boom" },
								{
									type: "image",
									data: "BASE64DATA",
									mediaType: "image/jpeg",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("preserves providerOptions on reasoning parts", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						text: "thinking",
						providerOptions: {
							anthropic: {
								signature: "sig_123",
							},
						},
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "assistant",
				content: [
					{
						type: "reasoning",
						text: "thinking",
						providerOptions: {
							anthropic: {
								signature: "sig_123",
							},
						},
					},
				],
			},
		]);
	});

	it("passes through tool result output for compatibility helper", () => {
		expect(toAiSdkToolResultOutput({ ok: true })).toEqual({
			type: "json",
			value: { ok: true },
		});
		expect(toAiSdkToolResultOutput("contents")).toEqual({
			type: "text",
			value: "contents",
		});
	});
});

describe("sanitizeSurrogates", () => {
	it("replaces lone high surrogates with replacement character", () => {
		const lone = "\uD83D";
		const sanitized = sanitizeSurrogates(lone);
		expect(sanitized.charCodeAt(0)).not.toBe(lone.charCodeAt(0));
		expect(sanitized).toBe("\uFFFD");
	});

	it("preserves valid surrogate pairs (emoji)", () => {
		const valid = "🚀";
		expect(sanitizeSurrogates(valid)).toBe(valid);
	});

	it("replaces lone surrogates but preserves valid ones in mixed text", () => {
		const lone = "\uD83D";
		const valid = "🚀";
		const text = `text ${lone} and ${valid}`;
		const expected = `text \uFFFD and ${valid}`;
		expect(sanitizeSurrogates(text)).toBe(expected);
	});
});

describe("formatMessagesForAiSdk - surrogate sanitization", () => {
	it("sanitizes system content with lone surrogates", () => {
		const lone = "\uD83D";
		const valid = "🚀";
		const system = `system ${lone}`;
		const expectedSystem = `system \uFFFD`;

		const messages = formatMessagesForAiSdk(system, [
			{ role: "user", content: [{ type: "text", text: `hey ${valid}` }] },
		]);

		expect(messages[0]?.role).toBe("system");
		expect(messages[0]?.content).toBe(expectedSystem);
	});

	it("sanitizes string message content", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{ role: "user", content: `text ${lone}` },
		]);

		expect(messages[0]?.content).toBe("text \uFFFD");
	});

	it("sanitizes text parts in user messages", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{ role: "user", content: [{ type: "text", text: `text ${lone}` }] },
		]);

		const userContent = messages[0]?.content as Array<{
			type: string;
			text: string;
		}>;
		expect(userContent[0]?.text).toBe("text \uFFFD");
	});

	it("sanitizes text parts in assistant messages", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{ role: "assistant", content: [{ type: "text", text: `text ${lone}` }] },
		]);

		const content = messages[0]?.content as Array<{
			type: string;
			text: string;
		}>;
		expect(content[0]?.text).toBe("text \uFFFD");
	});

	it("sanitizes reasoning parts in assistant messages", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "assistant",
				content: [{ type: "reasoning", text: `think ${lone}` }],
			},
		]);

		const content = messages[0]?.content as Array<{
			type: string;
			text: string;
		}>;
		expect(content[0]?.text).toBe("think \uFFFD");
	});

	it("sanitizes tool result string output", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "test",
						output: `result ${lone}`,
					},
				],
			},
		]);

		const content = messages[0]?.content as Array<{
			type: string;
			output: { type: string; value: string };
		}>;
		expect(content[0]?.output.value).toBe("result \uFFFD");
	});

	it("sanitizes tool result text content blocks", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "test",
						output: [{ type: "text", text: `content ${lone}` }],
					},
				],
			},
		]);

		const content = messages[0]?.content as Array<{
			type: string;
			output: { type: string; value: Array<{ type: string; text: string }> };
		}>;
		expect(content[0]?.output.value[0]?.text).toBe("content \uFFFD");
	});

	it("sanitizes deeply nested strings in json tool output", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "test",
						output: { nested: `value ${lone}` },
					},
				],
			},
		]);

		const content = messages[0]?.content as Array<{
			type: string;
			output: { type: string; value: { nested: string } };
		}>;
		expect(content[0]?.output.value.nested).toBe("value \uFFFD");
	});

	it("sanitizes file content", () => {
		const lone = "\uD83D";
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "file", path: "/tmp/test.txt", content: `file ${lone}` },
				],
			},
		]);

		const content = messages[0]?.content as Array<{
			type: string;
			text: string;
		}>;
		expect(content[0]?.text).toContain("file \uFFFD");
	});
});
