import type {
	LanguageModelV3,
	LanguageModelV3CallOptions,
} from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { applyToolCallingMode } from "./xml-tool-calling";

function makeFakeModel(): {
	model: LanguageModelV3;
	captured: { current?: LanguageModelV3CallOptions };
} {
	const captured: { current?: LanguageModelV3CallOptions } = {};
	const model = {
		specificationVersion: "v3",
		provider: "fake",
		modelId: "fake-model",
		supportedUrls: {},
		async doGenerate(options: LanguageModelV3CallOptions) {
			captured.current = options;
			return {
				content: [],
				finishReason: "stop",
				usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
				warnings: [],
			};
		},
		async doStream(options: LanguageModelV3CallOptions) {
			captured.current = options;
			return {
				stream: new ReadableStream({
					start(controller) {
						controller.enqueue({ type: "stream-start", warnings: [] });
						controller.enqueue({
							type: "finish",
							finishReason: "stop",
							usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
						});
						controller.close();
					},
				}),
			};
		},
	} as unknown as LanguageModelV3;
	return { model, captured };
}

const baseParams = {
	prompt: [
		{ role: "system", content: "You are Cline." },
		{ role: "user", content: [{ type: "text", text: "read the file" }] },
	],
	tools: [
		{
			type: "function",
			name: "read_file",
			description: "Read a file.",
			inputSchema: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	],
} as unknown as LanguageModelV3CallOptions;

describe("applyToolCallingMode", () => {
	it("returns the model unchanged for native mode and unset mode", () => {
		const { model } = makeFakeModel();
		expect(applyToolCallingMode(model, undefined)).toBe(model);
		expect(applyToolCallingMode(model, "native")).toBe(model);
	});

	it("wraps the model for xml mode: tools stripped, docs prompted", async () => {
		const { model, captured } = makeFakeModel();
		const wrapped = applyToolCallingMode(model, "xml");
		expect(wrapped).not.toBe(model);

		await wrapped.doGenerate(baseParams);

		// Native tool schemas never reach the underlying model...
		expect(captured.current?.tools ?? []).toHaveLength(0);
		// ...the tool documentation is rendered into the prompt instead,
		// alongside the caller's own system prompt.
		const promptText = JSON.stringify(captured.current?.prompt);
		expect(promptText).toContain("You are Cline.");
		expect(promptText).toContain("read_file");
	});
});
