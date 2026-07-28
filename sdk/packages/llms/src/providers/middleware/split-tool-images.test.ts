import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Message,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
	rewritePromptToolImages,
	splitToolImagesMiddleware,
} from "./split-tool-images";

const PLACEHOLDER = "(see following user message for image)";
const OMITTED_PLACEHOLDER = "[media omitted: invalid or exceeds size limit]";
const imageData = (byteLength: number, fill = 1) =>
	Buffer.alloc(byteLength, fill).toString("base64");

function fileDataPart(
	data: string,
	mediaType: string,
	extra?: { filename?: string; providerOptions?: Record<string, unknown> },
) {
	return {
		type: "file" as const,
		mediaType,
		data: { type: "data" as const, data },
		...(extra?.filename ? { filename: extra.filename } : {}),
		...(extra?.providerOptions
			? { providerOptions: extra.providerOptions }
			: {}),
	};
}

function fileUrlPart(url: string, mediaType: string) {
	return {
		type: "file" as const,
		mediaType,
		data: { type: "url" as const, url: new URL(url) },
	};
}

describe("rewritePromptToolImages", () => {
	it("leaves prompts without tool messages unchanged", () => {
		const prompt: LanguageModelV4Message[] = [
			{ role: "system", content: "you are a helpful assistant" },
			{
				role: "user",
				content: [{ type: "text", text: "what is 2+2?" }],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "4" }],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(false);
		// When nothing mutates, the implementation re-builds the array.
		// What matters is that the contents are equivalent.
		expect(out.prompt).toEqual(prompt);
	});

	it("leaves text-only tool messages unchanged", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: { type: "text", value: "no images here" },
					},
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_files",
						output: {
							type: "content",
							value: [{ type: "text", text: "still no images" }],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(false);
		expect(out.prompt).toHaveLength(1);
	});

	it("splits inline image file parts into a synthetic user message", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "Successfully read image" },
								fileDataPart("QkFTRTY0SU1BR0VCWVRFUw==", "image/jpeg"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(2);

		const [toolMsg, syntheticUser] = out.prompt;
		expect(toolMsg.role).toBe("tool");
		// Tool-result should now have placeholder text instead of the file part.
		const toolResult = (
			toolMsg as Extract<LanguageModelV4Message, { role: "tool" }>
		).content[0];
		if (toolResult.type !== "tool-result") {
			throw new Error("expected tool-result");
		}
		expect(toolResult.output).toEqual({
			type: "content",
			value: [
				{ type: "text", text: "Successfully read image" },
				{ type: "text", text: PLACEHOLDER },
			],
		});

		// Synthetic user message carries the image as a FilePart.
		expect(syntheticUser).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "data", data: "QkFTRTY0SU1BR0VCWVRFUw==" },
					mediaType: "image/jpeg",
				},
			],
		});
	});

	it("preserves filename and provider options on file data parts", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								fileDataPart("QkFTRTY0UERGQllURVM=", "application/pdf", {
									filename: "spec.pdf",
									providerOptions: {
										openai: { detail: "high" },
									},
								}),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt[1]).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "data", data: "QkFTRTY0UERGQllURVM=" },
					mediaType: "application/pdf",
					filename: "spec.pdf",
					providerOptions: {
						openai: { detail: "high" },
					},
				},
			],
		});
	});

	it("converts file URL parts to user file parts", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [fileUrlPart("https://example.com/cat.png", "image")],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt[1]).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "url", url: new URL("https://example.com/cat.png") },
					mediaType: "image",
				},
			],
		});
	});

	it("omits file URL parts that exceed the aggregate media budget", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								fileUrlPart("https://example.com/a.png", "image"),
								fileUrlPart("https://example.com/b.png", "image"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(2);
		expect(out.prompt[1]).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "url", url: new URL("https://example.com/a.png") },
					mediaType: "image",
				},
			],
		});
		expect(JSON.stringify(out.prompt[0])).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(out.prompt[0])).not.toContain(
			"https://example.com/b.png",
		);
	});

	it("omits invalid data URL file parts instead of splitting them", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								fileUrlPart("data:image/png;base64,not-base64", "image/png"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(1);
		expect(JSON.stringify(out.prompt[0])).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(out.prompt[0])).not.toContain("not-base64");
	});

	it("omits unsupported uppercase data URL file parts before splitting", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								fileUrlPart("DATA:image/svg+xml;base64,PHN2Zz4=", "image/svg+xml"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(1);
		expect(JSON.stringify(out.prompt[0])).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(out.prompt[0])).not.toContain("PHN2Zz4=");
	});

	it("omits non-image file URL parts that exceed the aggregate media budget", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								fileUrlPart("https://example.com/a.pdf", "application/pdf"),
								fileUrlPart("https://example.com/b.pdf", "application/pdf"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(2);
		expect(out.prompt[1]).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "url", url: new URL("https://example.com/a.pdf") },
					mediaType: "application/pdf",
				},
			],
		});
		expect(JSON.stringify(out.prompt[0])).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(out.prompt[0])).not.toContain(
			"https://example.com/b.pdf",
		);
	});

	it("omits malformed non-image file URL data URLs instead of splitting them", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								fileUrlPart(
									"data:application/pdf;base64,not-base64",
									"application/pdf",
								),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(1);
		expect(JSON.stringify(out.prompt[0])).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(out.prompt[0])).not.toContain("not-base64");
	});

	it("omits oversized file data parts instead of splitting them", () => {
		const oversizedFile = "A".repeat(6 * 1024 * 1024);
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [fileDataPart(oversizedFile, "application/pdf")],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(1);
		expect(JSON.stringify(out.prompt[0])).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(out.prompt[0])).not.toContain(oversizedFile);
	});

	it("replaces invalid image file data with a text placeholder instead of splitting it", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [fileDataPart("not-base64", "image/png")],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(1);
		const toolResult = (
			out.prompt[0] as Extract<LanguageModelV4Message, { role: "tool" }>
		).content[0];
		if (toolResult.type !== "tool-result") {
			throw new Error("expected tool-result");
		}
		expect(toolResult.output).toEqual({
			type: "content",
			value: [
				{
					type: "text",
					text: "[media omitted: invalid or exceeds size limit]",
				},
			],
		});
	});

	it("leaves provider reference file parts in place (no byte recovery needed)", () => {
		// Provider references identify files already hosted by the provider.
		// There are no inline bytes to recover via a sibling user message, so
		// they stay inside the tool-result (same rationale as V3 image-file-id).
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "Successfully read image" },
								{
									type: "file",
									mediaType: "image",
									data: {
										type: "reference",
										reference: { openai: "file_abc" },
									},
								},
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(false);
		const toolResult = (
			out.prompt[0] as Extract<LanguageModelV4Message, { role: "tool" }>
		).content[0];
		if (toolResult.type !== "tool-result") {
			throw new Error("expected tool-result");
		}
		expect(toolResult.output).toEqual({
			type: "content",
			value: [
				{ type: "text", text: "Successfully read image" },
				{
					type: "file",
					mediaType: "image",
					data: {
						type: "reference",
						reference: { openai: "file_abc" },
					},
				},
			],
		});
	});

	it("aggregates images from multiple tool-results in one tool message", () => {
		// `read_files` with two paths produces a single `role:'tool'` message
		// with two `tool-result` parts (or one tool-result with two images,
		// depending on how the agent emits them). Either way, the rewritten
		// user message should carry both images.
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "image 1" },
								fileDataPart("QUFB", "image/jpeg"),
							],
						},
					},
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "image 2" },
								fileDataPart("QkJC", "image/png"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(2);
		expect(out.prompt[1]).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "data", data: "QUFB" },
					mediaType: "image/jpeg",
				},
				{
					type: "file",
					data: { type: "data", data: "QkJC" },
					mediaType: "image/png",
				},
			],
		});
	});

	it("omits images that exceed the aggregate media budget in the split backstop", () => {
		const firstImage = imageData(3_600_000, 1);
		const secondImage = imageData(3_600_000, 2);
		const prompt: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "image 1" },
								fileDataPart(firstImage, "image/png"),
							],
						},
					},
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "image 2" },
								fileDataPart(secondImage, "image/png"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		expect(out.prompt).toHaveLength(2);
		expect(out.prompt[1]).toEqual({
			role: "user",
			content: [
				{
					type: "file",
					data: { type: "data", data: firstImage },
					mediaType: "image/png",
				},
			],
		});
		const toolMessage = out.prompt[0];
		if (toolMessage.role !== "tool") {
			throw new Error("expected tool message");
		}
		expect(JSON.stringify(toolMessage)).toContain(OMITTED_PLACEHOLDER);
		expect(JSON.stringify(toolMessage)).not.toContain(secondImage);
	});

	it("handles multiple separate tool messages in the same prompt", () => {
		const prompt: LanguageModelV4Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: "show me both" }],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "read_files",
						input: { paths: ["a.jpg"] },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "first" },
								fileDataPart("QUFB", "image/jpeg"),
							],
						},
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "call_2",
						toolName: "read_files",
						input: { paths: ["b.jpg"] },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_2",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "second" },
								fileDataPart("QkJC", "image/png"),
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(true);
		// Original 5 + 2 synthetic user messages.
		expect(out.prompt).toHaveLength(7);
		expect(out.prompt[3].role).toBe("user");
		expect(out.prompt[6].role).toBe("user");
	});

	it("does not mutate the input prompt array or its messages", () => {
		const original: LanguageModelV4Message[] = [
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "read_files",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "before" },
								fileDataPart("QUFB", "image/jpeg"),
							],
						},
					},
				],
			},
		];
		const snapshot = JSON.parse(JSON.stringify(original));

		rewritePromptToolImages(original);

		expect(original).toEqual(snapshot);
	});
});

describe("splitToolImagesMiddleware", () => {
	it("has v4 specification version", () => {
		expect(splitToolImagesMiddleware.specificationVersion).toBe("v4");
	});

	it("returns the same params object reference when no rewrite is needed", async () => {
		const params: LanguageModelV4CallOptions = {
			prompt: [
				{
					role: "user",
					content: [{ type: "text", text: "hello" }],
				},
			],
		};

		const out = await splitToolImagesMiddleware.transformParams?.({
			type: "stream",
			params,
			// `model` isn't used by this middleware; cast for the test.
			model: undefined as never,
		});

		// Identity preserved means downstream sees the original CallOptions
		// without an unnecessary clone.
		expect(out).toBe(params);
	});

	it("returns transformed params with rewritten prompt when images are present", async () => {
		const params: LanguageModelV4CallOptions = {
			prompt: [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call_1",
							toolName: "read_files",
							output: {
								type: "content",
								value: [
									{ type: "text", text: "ok" },
									fileDataPart("QUFB", "image/jpeg"),
								],
							},
						},
					],
				},
			],
		};

		const out = await splitToolImagesMiddleware.transformParams?.({
			type: "stream",
			params,
			model: undefined as never,
		});

		expect(out).not.toBe(params);
		expect(out?.prompt).toHaveLength(2);
		expect(out?.prompt[1].role).toBe("user");
	});

	it("preserves call-options siblings (temperature, tools, etc.)", async () => {
		const params: LanguageModelV4CallOptions = {
			prompt: [
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call_1",
							toolName: "read_files",
							output: {
								type: "content",
								value: [fileDataPart("QUFB", "image/jpeg")],
							},
						},
					],
				},
			],
			temperature: 0.7,
			maxOutputTokens: 1000,
		};

		const out = await splitToolImagesMiddleware.transformParams?.({
			type: "stream",
			params,
			model: undefined as never,
		});

		expect(out?.temperature).toBe(0.7);
		expect(out?.maxOutputTokens).toBe(1000);
	});
});
