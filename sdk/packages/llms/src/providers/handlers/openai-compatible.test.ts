import { beforeEach, describe, expect, it, vi } from "vitest";
import z from "zod";

const { streamTextSpy, providerSpy, createOpenAICompatibleSpy } = vi.hoisted(
	() => {
		const provider = vi.fn();
		return {
			streamTextSpy: vi.fn(),
			providerSpy: provider,
			createOpenAICompatibleSpy: vi.fn(() => provider),
		};
	},
);

vi.mock("ai", () => ({
	streamText: streamTextSpy,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: createOpenAICompatibleSpy,
}));

import { OpenAICompatibleHandler } from "./openai-compatible";

function createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const item of items) {
				yield item;
			}
		},
	};
}

async function drain(stream: AsyncIterable<unknown>) {
	for await (const _chunk of stream) {
		// no-op
	}
}

function toJsonSchema(inputSchema: unknown): unknown {
	const maybeWrapped = inputSchema as { jsonSchema?: unknown };
	if (typeof maybeWrapped?.jsonSchema === "function") {
		return (maybeWrapped.jsonSchema as () => unknown)();
	}
	if (maybeWrapped?.jsonSchema) {
		return maybeWrapped.jsonSchema;
	}
	if (inputSchema && typeof inputSchema === "object") {
		try {
			return z.toJSONSchema(inputSchema as z.core.$ZodType);
		} catch {
			// Ignore: not a supported Zod schema instance.
		}
	}
	return undefined;
}

describe("OpenAICompatibleHandler", () => {
	beforeEach(() => {
		streamTextSpy.mockReset();
		providerSpy.mockReset();
		createOpenAICompatibleSpy.mockClear();
		providerSpy.mockReturnValue({ provider: "model" });
		streamTextSpy.mockReturnValue({
			fullStream: createAsyncIterable([{ type: "finish", usage: {} }]),
		});
	});

	it("omits OpenRouter reasoning options when thinking is disabled", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "google/gemma-4-31b-it",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage("system", [{ role: "user", content: "hi" }]),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			providerOptions?: Record<string, unknown>;
		};
		expect(request.providerOptions).toBeUndefined();
	});

	it("sends function tools with object inputSchema", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "hi" }],
				[
					{
						name: "read_files",
						description: "Read files",
						inputSchema: {
							type: "object",
							properties: { files: { type: "array" } },
							required: ["files"],
						},
					},
				],
			),
		);

		expect(streamTextSpy).toHaveBeenCalledTimes(1);
		const request = streamTextSpy.mock.calls[0]?.[0] as {
			tools?: Record<string, { inputSchema?: unknown; parameters?: unknown }>;
		};
		const rawJsonSchema = toJsonSchema(request.tools?.read_files?.inputSchema);
		expect(rawJsonSchema).toEqual(
			expect.objectContaining({
				type: "object",
				properties: expect.objectContaining({
					files: expect.objectContaining({ type: "array" }),
				}),
				required: ["files"],
			}),
		);
		expect(request.tools?.read_files?.parameters).toBeUndefined();
	});

	it("normalizes invalid tool schemas to a permissive schema", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage(
				"system",
				[{ role: "user", content: "hi" }],
				[
					{
						name: "read_files",
						description: "Read files",
						inputSchema: {} as Record<string, unknown>,
					},
				],
			),
		);

		const request = streamTextSpy.mock.calls[0]?.[0] as {
			tools?: Record<string, { inputSchema?: unknown }>;
		};
		const rawJsonSchema = toJsonSchema(request.tools?.read_files?.inputSchema);
		expect(rawJsonSchema).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
		});
	});

	it("replays assistant tool history using AI SDK input parts", async () => {
		const handler = new OpenAICompatibleHandler({
			providerId: "openrouter",
			modelId: "anthropic/claude-sonnet-4.6",
			apiKey: "test-key",
			baseUrl: "https://example.com/v1",
		});

		await drain(
			handler.createMessage("system", [
				{ role: "user", content: "inspect repo" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_1",
							name: "read_files",
							input: { files: ["/tmp/a.md"] },
						},
					],
				},
			]),
		);

		expect(streamTextSpy).toHaveBeenCalledTimes(1);
		const request = streamTextSpy.mock.calls[0]?.[0] as {
			messages?: Array<{
				role?: string;
				content?: Array<Record<string, unknown>> | string;
			}>;
		};
		const assistantMessage = request.messages?.[2];
		expect(assistantMessage?.role).toBe("assistant");
		const assistantParts = Array.isArray(assistantMessage?.content)
			? assistantMessage.content
			: [];
		expect(assistantParts[0]).toMatchObject({
			type: "tool-call",
			toolCallId: "call_1",
			toolName: "read_files",
			input: { files: ["/tmp/a.md"] },
		});
		expect(assistantParts[0]?.args).toBeUndefined();
	});
});
