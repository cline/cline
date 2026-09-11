import type {
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
} from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import {
	CONTENT_REMOVED_PLACEHOLDER,
	createContentValidationRemediationMiddleware,
	sanitizePromptContentTypes,
} from "./remediate-content-validation";

function streamOf(
	parts: LanguageModelV4StreamPart[],
): LanguageModelV4StreamResult {
	return {
		stream: new ReadableStream<LanguageModelV4StreamPart>({
			start(controller) {
				for (const part of parts) {
					controller.enqueue(part);
				}
				controller.close();
			},
		}),
	} as LanguageModelV4StreamResult;
}

const textParts: LanguageModelV4StreamPart[] = [
	{ type: "stream-start", warnings: [] },
	{ type: "text-start", id: "t" },
	{ type: "text-delta", id: "t", delta: "hello" },
	{ type: "text-end", id: "t" },
	{
		type: "finish",
		finishReason: { unified: "stop", raw: "stop" },
		usage: {
			inputTokens: { total: 1 },
			outputTokens: { total: 1 },
		},
	},
];

async function collect(
	result: LanguageModelV4StreamResult,
): Promise<LanguageModelV4StreamPart[]> {
	const out: LanguageModelV4StreamPart[] = [];
	const reader = result.stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		out.push(value);
	}
	return out;
}

/** The reported z.ai shape: flattened text under a retryable wrapper status. */
function validationRejection() {
	return Object.assign(
		new Error("messages.content.type is invalid, allowed values: ['text']"),
		{ name: "AI_APICallError", statusCode: 500, isRetryable: true },
	);
}

const richPrompt = [
	{ role: "system", content: "You are Cline" },
	{
		role: "user",
		content: [
			{ type: "text", text: "look at this" },
			{ type: "file", mediaType: "image/png", data: "aGk=" },
		],
	},
	{
		role: "assistant",
		content: [
			{ type: "reasoning", text: "thinking hard" },
			{ type: "text", text: "ok" },
		],
	},
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "c1",
				toolName: "browser_screenshot",
				output: {
					type: "content",
					value: [
						{ type: "text", text: "screenshot:" },
						{ type: "file", mediaType: "image/jpeg", data: "aGk=" },
					],
				},
			},
		],
	},
] as never[];

const textOnlyPrompt = [
	{ role: "system", content: "You are Cline" },
	{ role: "user", content: [{ type: "text", text: "hello" }] },
] as never[];

function run(
	params: unknown,
	model: { doStream: ReturnType<typeof vi.fn> },
	doStream: ReturnType<typeof vi.fn>,
) {
	const middleware = createContentValidationRemediationMiddleware();
	// biome-ignore lint/style/noNonNullAssertion: wrapStream is always defined here
	return middleware.wrapStream!({
		doStream,
		doGenerate: vi.fn() as never,
		params: params as never,
		model: model as never,
	});
}

describe("createContentValidationRemediationMiddleware", () => {
	it("retries once with non-text content stripped and streams the successful attempt", async () => {
		const doStream = vi.fn(async () => {
			throw validationRejection();
		});
		const model = { doStream: vi.fn(async () => streamOf(textParts)) };
		const parts = await collect(
			await run({ prompt: richPrompt }, model, doStream),
		);
		expect(doStream).toHaveBeenCalledTimes(1);
		expect(model.doStream).toHaveBeenCalledTimes(1);
		expect(
			parts.some((p) => p.type === "text-delta" && p.delta === "hello"),
		).toBe(true);

		const retriedPrompt = model.doStream.mock.calls[0][0].prompt;
		// User file part → text placeholder; text part survives.
		expect(retriedPrompt[1].content).toEqual([
			{ type: "text", text: "look at this" },
			{ type: "text", text: CONTENT_REMOVED_PLACEHOLDER },
		]);
		// Reasoning dropped; text survives.
		expect(retriedPrompt[2].content).toEqual([{ type: "text", text: "ok" }]);
		// Tool-result media flattened; text output survives; ids preserved.
		expect(retriedPrompt[3].content[0].toolCallId).toBe("c1");
		expect(retriedPrompt[3].content[0].output.value).toEqual([
			{ type: "text", text: "screenshot:" },
			{ type: "text", text: CONTENT_REMOVED_PLACEHOLDER },
		]);
		// System message untouched.
		expect(retriedPrompt[0].content).toBe("You are Cline");
	});

	it("surfaces the rejection when the sanitized retry fails too", async () => {
		const doStream = vi.fn(async () => {
			throw validationRejection();
		});
		const second = Object.assign(
			new Error("messages.content.type is invalid, allowed values: ['text']"),
			{ name: "AI_APICallError", statusCode: 400 },
		);
		const model = {
			doStream: vi.fn(async () => {
				throw second;
			}),
		};
		await expect(run({ prompt: richPrompt }, model, doStream)).rejects.toBe(
			second,
		);
		expect(model.doStream).toHaveBeenCalledTimes(1);
	});

	it("passes non-validation rejections through without remediation", async () => {
		const auth = Object.assign(new Error("unauthorized"), {
			name: "AI_APICallError",
			statusCode: 401,
		});
		const doStream = vi.fn(async () => {
			throw auth;
		});
		const model = { doStream: vi.fn() };
		await expect(run({ prompt: richPrompt }, model, doStream)).rejects.toBe(
			auth,
		);
		expect(model.doStream).not.toHaveBeenCalled();
	});

	it("does not remediate when the prompt has nothing to strip", async () => {
		const doStream = vi.fn(async () => {
			throw validationRejection();
		});
		const model = { doStream: vi.fn() };
		await expect(
			run({ prompt: textOnlyPrompt }, model, doStream),
		).rejects.toThrow("allowed values");
		expect(model.doStream).not.toHaveBeenCalled();
	});

	it("never remediates an aborted request", async () => {
		const doStream = vi.fn(async () => {
			throw validationRejection();
		});
		const model = { doStream: vi.fn() };
		const controller = new AbortController();
		controller.abort();
		await expect(
			run(
				{ prompt: richPrompt, abortSignal: controller.signal },
				model,
				doStream,
			),
		).rejects.toThrow("allowed values");
		expect(model.doStream).not.toHaveBeenCalled();
	});
});

describe("sanitizePromptContentTypes", () => {
	it("returns null for a prompt with nothing to strip", () => {
		expect(sanitizePromptContentTypes(textOnlyPrompt as never[])).toBeNull();
	});

	it("keeps an all-reasoning assistant message alive with a placeholder", () => {
		const prompt = [
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "private thoughts" },
					{ type: "reasoning-file", data: "x", mediaType: "text/plain" },
				],
			},
		] as never[];
		const result = sanitizePromptContentTypes(prompt as never[]);
		expect(result?.removed).toEqual(
			expect.arrayContaining(["reasoning", "reasoning-file"]),
		);
		expect(result?.prompt[0].content).toEqual([
			{ type: "text", text: CONTENT_REMOVED_PLACEHOLDER },
		]);
	});
});
