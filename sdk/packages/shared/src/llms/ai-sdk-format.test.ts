import { describe, expect, it } from "vitest";
import {
	EMPTY_CONTENT_TEXT,
	formatMessagesForAiSdk,
	sanitizeSurrogates,
	toAiSdkToolResultOutput,
} from "./ai-sdk-format";

describe("formatMessagesForAiSdk", () => {
	const imageData = (byteLength: number, fill = 1) =>
		Buffer.alloc(byteLength, fill).toString("base64");

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

	it("replaces empty string user and assistant messages with explicit error text", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{ role: "user", content: "" },
			{ role: "assistant", content: "   \n\t  " },
			{ role: "user", content: [{ type: "text", text: "continue" }] },
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
			},
			{
				role: "user",
				content: [{ type: "text", text: "continue" }],
			},
		]);
	});

	it("replaces empty content arrays with explicit error text", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{ role: "assistant", content: [] },
		]);

		expect(messages).toEqual([
			{
				role: "assistant",
				content: [{ type: "text", text: EMPTY_CONTENT_TEXT }],
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
								data: "QkFTRTY0REFUQQ==",
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
									data: "QkFTRTY0REFUQQ==",
									mediaType: "image/jpeg",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("replaces tool-result image blocks with a placeholder when the model lacks image support", () => {
		const messages = formatMessagesForAiSdk(
			undefined,
			[
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
									data: "QkFTRTY0REFUQQ==",
									mediaType: "image/jpeg",
								},
							],
						},
					],
				},
			],
			{ supportsImages: false },
		);

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
									type: "text",
									text: "[image omitted: this model does not support image input]",
								},
							],
						},
					},
				],
			},
		]);
		// the base64 image payload must not reach a text-only model
		expect(JSON.stringify(messages)).not.toContain("QkFTRTY0REFUQQ==");
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
										data: "QkFTRTY0REFUQQ==",
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
									data: "QkFTRTY0REFUQQ==",
									mediaType: "image/jpeg",
								},
							],
						},
					},
				],
			},
		]);
	});

	it("replaces nested read_files image blocks with a placeholder for text-only models", () => {
		// Same nested `[{query, result:[{text},{image}], success}]` shape as the
		// hoisting test above, but with a model that lacks image support: the
		// nested image must collapse to the capability placeholder (not be
		// hoisted as an image-data part), so a text-only endpoint isn't sent
		// image content.
		const messages = formatMessagesForAiSdk(
			undefined,
			[
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
											data: "QkFTRTY0REFUQQ==",
											mediaType: "image/jpeg",
										},
									],
									success: true,
								},
							],
						},
					],
				},
			],
			{ supportsImages: false },
		);

		expect(messages).toEqual([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "read_files",
						output: {
							type: "json",
							value: [
								{
									query: "/tmp/image.jpg",
									result: [
										"Successfully read image",
										"[image omitted: this model does not support image input]",
									],
									success: true,
								},
							],
						},
					},
				],
			},
		]);
		expect(JSON.stringify(messages)).not.toContain("QkFTRTY0REFUQQ==");
	});

	it("sanitizes nested strings before stringifying extracted image metadata", () => {
		const output = toAiSdkToolResultOutput({
			query: "bad\uD800name.jpg",
			result: [
				{ type: "text", text: "Successfully read image" },
				{
					type: "image",
					data: "QkFTRTY0REFUQQ==",
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
					data: "QkFTRTY0REFUQQ==",
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
										data: "SlBFR0RBVEE=",
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
										data: "UE5HREFUQQ==",
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
									data: "SlBFR0RBVEE=",
									mediaType: "image/jpeg",
								},
								{
									type: "image-data",
									data: "UE5HREFUQQ==",
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
								data: "QkFTRTY0REFUQQ==",
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
									data: "QkFTRTY0REFUQQ==",
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
		const image = "QkFTRTY0REFUQQ==";
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
								data: image,
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
							value: ["boom", "[media omitted: invalid or exceeds size limit]"],
						},
					},
				],
			},
		]);
		expect(JSON.stringify(messages)).not.toContain(image);
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

	it("does not reshape text-only structured tool result output", () => {
		expect(
			toAiSdkToolResultOutput({
				result: [{ type: "text", text: "hello" }],
			}),
		).toEqual({
			type: "json",
			value: {
				result: [{ type: "text", text: "hello" }],
			},
		});
	});

	it("replaces invalid direct user images with text placeholders before provider formatting", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "text", text: "inspect" },
					{
						type: "image",
						image: "data:image/jpeg;base64,/9j/",
						mediaType: "image/png",
					},
				],
			},
		]);

		const serialized = JSON.stringify(messages);
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain("data:image/jpeg;base64,/9j/");
	});

	it("keeps raw base64 string images without mediaType by defaulting to png", () => {
		const image = imageData(8);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [{ type: "image", image }],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "image", image, mediaType: "image/png" }],
			},
		]);
	});

	it("keeps binary image parts without mediaType by defaulting to png", () => {
		const image = new Uint8Array([1, 2, 3, 4]);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [{ type: "image", image }],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "image", image, mediaType: "image/png" }],
			},
		]);
	});

	it("omits image parts when the model does not support images", () => {
		const image = imageData(8);
		const messages = formatMessagesForAiSdk(
			undefined,
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "what is this?" },
						{ type: "image", image, mediaType: "image/png" },
					],
				},
			],
			{ supportsImages: false },
		);

		// A text-only model must never receive an image part — sending one makes
		// providers like Z.AI reject the request:
		//   messages.content.type is invalid, allowed values: ['text']
		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "what is this?" },
					{
						type: "text",
						text: "[image omitted: this model does not support image input]",
					},
				],
			},
		]);
		expect(JSON.stringify(messages)).not.toContain(image);
	});

	it("keeps image parts when supportsImages is omitted (vision default)", () => {
		const image = imageData(8);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [{ type: "image", image, mediaType: "image/png" }],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [{ type: "image", image, mediaType: "image/png" }],
			},
		]);
	});

	it("replaces binary image parts with unsupported media types", () => {
		const image = new Uint8Array([1, 2, 3, 4]);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "image", image, mediaType: "application/octet-stream" },
				],
			},
		]);

		const serialized = JSON.stringify(messages);
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain("application/octet-stream");
	});

	it("replaces over-budget binary image parts", () => {
		const oversizedImage = new Uint8Array(6 * 1024 * 1024 + 1);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "image", image: oversizedImage, mediaType: "image/png" },
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "[media omitted: invalid or exceeds size limit]",
					},
				],
			},
		]);
	});

	it("validates and budgets data URL objects before provider formatting", () => {
		const image = imageData(8);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "image",
						image: new URL(`data:image/jpeg;base64,${image}`),
					},
				],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{
						type: "image",
						image: `data:image/jpeg;base64,${image}`,
						mediaType: "image/jpeg",
					},
				],
			},
		]);
	});

	it("validates uppercase data URL strings without an explicit mediaType", () => {
		const image = imageData(8);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [{ type: "image", image: `DATA:image/jpeg;base64,${image}` }],
			},
		]);

		expect(messages).toEqual([
			{
				role: "user",
				content: [
					{
						type: "image",
						image: `data:image/jpeg;base64,${image}`,
						mediaType: "image/jpeg",
					},
				],
			},
		]);
	});

	it("charges remote URL image parts against the aggregate media budget", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "image", image: new URL("https://example.com/a.png") },
					{ type: "image", image: new URL("https://example.com/b.png") },
				],
			},
		]);

		const serialized = JSON.stringify(messages);
		expect(serialized).toContain("https://example.com/a.png");
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain("https://example.com/b.png");
	});

	it("charges remote string image URLs against the aggregate media budget", () => {
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{ type: "image", image: "https://example.com/a.png" },
					{ type: "image", image: "https://example.com/b.png" },
				],
			},
		]);

		const serialized = JSON.stringify(messages);
		expect(serialized).toContain("https://example.com/a.png");
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain("https://example.com/b.png");
	});

	it("replaces oversized direct user images with text placeholders", () => {
		const oversizedImage = imageData(4 * 1024 * 1024);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "image",
						image: oversizedImage,
						mediaType: "image/png",
					},
				],
			},
		]);

		const serialized = JSON.stringify(messages);

		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain(oversizedImage);
	});

	it("replaces invalid and oversized tool-result images with text placeholders before provider formatting", () => {
		const oversizedImage = imageData(4 * 1024 * 1024);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "read_files",
						output: [
							{
								query: "/tmp/image.svg",
								result: [
									{ type: "text", text: "Successfully read image" },
									{
										type: "image",
										data: "PHN2Zz4=",
										mediaType: "image/svg+xml",
									},
									{
										type: "image",
										data: oversizedImage,
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

		const serialized = JSON.stringify(messages);
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain('"type":"image-data"');
		expect(serialized).not.toContain("PHN2Zz4=");
		expect(serialized).not.toContain(oversizedImage);
	});

	it("replaces malformed image-shaped tool-result objects with placeholders", () => {
		const hiddenPayload = imageData(1024);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "custom_tool",
						output: {
							result: {
								type: "image",
								data: hiddenPayload,
							},
						},
					},
				],
			},
		]);

		const serialized = JSON.stringify(messages);
		expect(serialized).toContain(
			"[media omitted: invalid or exceeds size limit]",
		);
		expect(serialized).not.toContain(hiddenPayload);
	});

	it("replaces image-shaped error tool-result objects with placeholders", () => {
		const hiddenPayload = imageData(1024);
		const messages = formatMessagesForAiSdk(undefined, [
			{
				role: "user",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_img",
						toolName: "custom_tool",
						isError: true,
						output: {
							result: {
								type: "image",
								data: hiddenPayload,
								mediaType: "image/png",
							},
						},
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
						toolName: "custom_tool",
						output: {
							type: "error-json",
							value: {
								result: "[media omitted: invalid or exceeds size limit]",
							},
						},
					},
				],
			},
		]);
		expect(JSON.stringify(messages)).not.toContain(hiddenPayload);
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
