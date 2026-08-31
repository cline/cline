import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { streamText, wrapLanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "../ai-sdk";
import { ensureStreamPartStartMiddleware } from "./ensure-stream-part-start";

async function collectStream(
	stream: ReadableStream<{ type: string; id?: string; delta?: string }>,
): Promise<Array<{ type: string; id?: string; delta?: string }>> {
	const reader = stream.getReader();
	const out: Array<{ type: string; id?: string; delta?: string }> = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		out.push(value);
	}
	return out;
}

function makeSourceStream(
	chunks: Array<{ type: string; id?: string; delta?: string }>,
) {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

function sseChunk(delta: unknown, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;
}

/** llama.cpp server-rocm style: first delta is role-only, content arrives later. */
function llamaCppStyleSse(text: string): string {
	return (
		sseChunk({ role: "assistant" }) +
		sseChunk({ content: text }) +
		sseChunk({}, "stop") +
		"data: [DONE]\n\n"
	);
}

describe("ensureStreamPartStartMiddleware", () => {
	it("inserts text-start before a bare text-delta", async () => {
		const source = makeSourceStream([
			{ type: "text-delta", id: "txt-0", delta: "hello" },
			{ type: "text-end", id: "txt-0" },
		]);
		const wrapped = await ensureStreamPartStartMiddleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("not used");
			},
			doStream: async () => ({ stream: source }),
			params: {} as never,
			model: {} as never,
		});
		expect(wrapped).toBeDefined();
		const events = await collectStream(wrapped!.stream);
		expect(events).toEqual([
			{ type: "text-start", id: "txt-0" },
			{ type: "text-delta", id: "txt-0", delta: "hello" },
			{ type: "text-end", id: "txt-0" },
		]);
	});

	it("does not duplicate an existing text-start", async () => {
		const source = makeSourceStream([
			{ type: "text-start", id: "txt-0" },
			{ type: "text-delta", id: "txt-0", delta: "ok" },
		]);
		const wrapped = await ensureStreamPartStartMiddleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("not used");
			},
			doStream: async () => ({ stream: source }),
			params: {} as never,
			model: {} as never,
		});
		const events = await collectStream(wrapped!.stream);
		expect(events).toEqual([
			{ type: "text-start", id: "txt-0" },
			{ type: "text-delta", id: "txt-0", delta: "ok" },
		]);
	});

	it("inserts reasoning-start before a bare reasoning-delta", async () => {
		const source = makeSourceStream([
			{ type: "reasoning-delta", id: "reasoning-0", delta: "think" },
		]);
		const wrapped = await ensureStreamPartStartMiddleware.wrapStream?.({
			doGenerate: async () => {
				throw new Error("not used");
			},
			doStream: async () => ({ stream: source }),
			params: {} as never,
			model: {} as never,
		});
		const events = await collectStream(wrapped!.stream);
		expect(events).toEqual([
			{ type: "reasoning-start", id: "reasoning-0" },
			{ type: "reasoning-delta", id: "reasoning-0", delta: "think" },
		]);
	});

	it("streams role-only then content SSE through openai-compatible and streamText", async () => {
		const provider = createOpenAICompatible({
			name: "test",
			apiKey: "test-key",
			baseURL: "http://fake.local/v1",
			fetch: (async () =>
				new Response(llamaCppStyleSse("hello"), {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				})) as unknown as typeof fetch,
		});
		const model = wrapLanguageModel({
			model: provider("test-model"),
			middleware: [ensureStreamPartStartMiddleware],
		});

		const result = streamText({ model, prompt: "hi" });
		let text = "";
		for await (const part of result.fullStream) {
			if (part.type === "text-delta") {
				text += part.text;
			}
			if (part.type === "error") {
				throw part.error;
			}
		}

		expect(text).toBe("hello");
	});

	it("streams role-only SSE through the Cline openai-compatible adapter", async () => {
		const config = {
			providerId: "openai-compatible",
			apiKey: "test-key",
			baseUrl: "http://fake.local/v1",
			fetch: (async () =>
				new Response(llamaCppStyleSse("world"), {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				})) as unknown as typeof fetch,
		};
		const provider = await createOpenAICompatibleProvider(config);
		const model = {
			id: "test-model",
			providerId: "openai-compatible",
			name: "test-model",
		};
		const context = {
			provider: {
				id: "openai-compatible",
				name: "OpenAI Compatible",
				defaultModelId: "test-model",
				models: [model],
			},
			model,
			config,
		} as unknown as GatewayProviderContext;
		const request = {
			providerId: "openai-compatible",
			modelId: "test-model",
			messages: [
				{
					id: "msg_user",
					role: "user",
					content: [{ type: "text", text: "say world" }],
					createdAt: new Date(),
				},
			],
		} as unknown as GatewayStreamRequest;

		const events: AgentModelEvent[] = [];
		for await (const event of await provider.stream(request, context)) {
			events.push(event);
		}

		expect(events.some((e) => e.type === "error")).toBe(false);
		expect(
			events
				.filter((e) => e.type === "text-delta")
				.map((e) => (e.type === "text-delta" ? e.text : ""))
				.join(""),
		).toBe("world");
	});
});
