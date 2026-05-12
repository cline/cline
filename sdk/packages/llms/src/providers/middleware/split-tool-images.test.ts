import type {
	LanguageModelV3CallOptions,
	LanguageModelV3Message,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import {
	rewritePromptToolImages,
	splitToolImagesMiddleware,
} from "./split-tool-images";

const PLACEHOLDER = "(see following user message for image)";

describe("rewritePromptToolImages", () => {
	it("leaves prompts without tool messages unchanged", () => {
		const prompt: LanguageModelV3Message[] = [
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
		const prompt: LanguageModelV3Message[] = [
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

	it("splits image-data parts into a synthetic user message", () => {
		const prompt: LanguageModelV3Message[] = [
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
									type: "image-data",
									data: "BASE64IMAGEBYTES",
									mediaType: "image/jpeg",
								},
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
		// Tool-result should now have placeholder text instead of image-data.
		const toolResult = (
			toolMsg as Extract<LanguageModelV3Message, { role: "tool" }>
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
					data: "BASE64IMAGEBYTES",
					mediaType: "image/jpeg",
				},
			],
		});
	});

	it("preserves filename and provider options on file-data parts", () => {
		const prompt: LanguageModelV3Message[] = [
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
								{
									type: "file-data",
									data: "BASE64PDFBYTES",
									mediaType: "application/pdf",
									filename: "spec.pdf",
									providerOptions: {
										openai: { detail: "high" },
									},
								},
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
					data: "BASE64PDFBYTES",
					mediaType: "application/pdf",
					filename: "spec.pdf",
					providerOptions: {
						openai: { detail: "high" },
					},
				},
			],
		});
	});

	it("converts image-url parts to file parts", () => {
		const prompt: LanguageModelV3Message[] = [
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
								{ type: "image-url", url: "https://example.com/cat.png" },
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
					data: "https://example.com/cat.png",
					mediaType: "image/*",
				},
			],
		});
	});

	it("leaves image-file-id parts in place (no FilePart equivalent)", () => {
		// image-file-id is an OpenAI-specific provider reference. It can't
		// be expressed as a `LanguageModelV3FilePart`, so we leave it inside
		// the tool-result. That path is already multimodal-aware and doesn't
		// need the rewrite.
		const prompt: LanguageModelV3Message[] = [
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
								{ type: "image-file-id", fileId: "file_abc" },
							],
						},
					},
				],
			},
		];

		const out = rewritePromptToolImages(prompt);

		expect(out.mutated).toBe(false);
		const toolResult = (
			out.prompt[0] as Extract<LanguageModelV3Message, { role: "tool" }>
		).content[0];
		if (toolResult.type !== "tool-result") {
			throw new Error("expected tool-result");
		}
		// Output is unchanged when only image-file-id is present.
		expect(toolResult.output).toEqual({
			type: "content",
			value: [
				{ type: "text", text: "Successfully read image" },
				{ type: "image-file-id", fileId: "file_abc" },
			],
		});
	});

	it("aggregates images from multiple tool-results in one tool message", () => {
		// `read_files` with two paths produces a single `role:'tool'` message
		// with two `tool-result` parts (or one tool-result with two images,
		// depending on how the agent emits them). Either way, the rewritten
		// user message should carry both images.
		const prompt: LanguageModelV3Message[] = [
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
								{
									type: "image-data",
									data: "AAA",
									mediaType: "image/jpeg",
								},
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
								{
									type: "image-data",
									data: "BBB",
									mediaType: "image/png",
								},
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
				{ type: "file", data: "AAA", mediaType: "image/jpeg" },
				{ type: "file", data: "BBB", mediaType: "image/png" },
			],
		});
	});

	it("handles multiple separate tool messages in the same prompt", () => {
		const prompt: LanguageModelV3Message[] = [
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
								{ type: "image-data", data: "AAA", mediaType: "image/jpeg" },
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
								{ type: "image-data", data: "BBB", mediaType: "image/png" },
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
		const original: LanguageModelV3Message[] = [
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
								{ type: "image-data", data: "AAA", mediaType: "image/jpeg" },
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
	it("has v3 specification version", () => {
		expect(splitToolImagesMiddleware.specificationVersion).toBe("v3");
	});

	it("returns the same params object reference when no rewrite is needed", async () => {
		const params: LanguageModelV3CallOptions = {
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
		const params: LanguageModelV3CallOptions = {
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
									{ type: "image-data", data: "AAA", mediaType: "image/jpeg" },
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
		const params: LanguageModelV3CallOptions = {
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
									{ type: "image-data", data: "AAA", mediaType: "image/jpeg" },
								],
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
