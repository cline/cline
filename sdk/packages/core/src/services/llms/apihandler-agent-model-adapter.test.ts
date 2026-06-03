import type {
	ApiHandler,
	ApiStreamChunk,
	HandlerModelInfo,
	Message,
} from "@cline/llms";
import type { AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createAgentModelFromApiHandler } from "./apihandler-agent-model-adapter";

function fakeHandler(
	chunks: ApiStreamChunk[],
	opts?: { throwAfter?: number },
): ApiHandler & { aborts: (AbortSignal | undefined)[] } {
	const aborts: (AbortSignal | undefined)[] = [];
	return {
		aborts,
		getMessages: () => [],
		getModel: (): HandlerModelInfo => ({ id: "m", info: { id: "m" } }),
		setAbortSignal(signal) {
			aborts.push(signal);
		},
		// eslint-disable-next-line require-yield
		async *createMessage(
			_system: string,
			_messages: Message[],
		): AsyncGenerator<ApiStreamChunk> {
			let i = 0;
			for (const chunk of chunks) {
				if (opts?.throwAfter !== undefined && i === opts.throwAfter) {
					throw new Error("boom");
				}
				yield chunk;
				i++;
			}
		},
	};
}

async function collect(
	stream:
		| AsyncIterable<AgentModelEvent>
		| Promise<AsyncIterable<AgentModelEvent>>,
): Promise<AgentModelEvent[]> {
	const out: AgentModelEvent[] = [];
	for await (const event of await stream) {
		out.push(event);
	}
	return out;
}

const baseRequest: AgentModelRequest = {
	systemPrompt: "sys",
	messages: [
		{
			id: "1",
			role: "user",
			content: [{ type: "text", text: "hi" }],
			createdAt: 0,
		},
	],
	tools: [],
};

describe("createAgentModelFromApiHandler", () => {
	it("maps text + usage chunks to events and appends a finish", async () => {
		const handler = fakeHandler([
			{ type: "text", text: "hello", id: "x" },
			{
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				totalCost: 0.01,
				id: "x",
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events).toEqual([
			{ type: "text-delta", text: "hello" },
			{
				type: "usage",
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: undefined,
					cacheWriteTokens: undefined,
					totalCost: 0.01,
				},
			},
			{ type: "finish", reason: "stop" },
		]);
	});

	it("maps tool_calls (object args) to a tool-call-delta event", async () => {
		const handler = fakeHandler([
			{
				type: "tool_calls",
				id: "x",
				tool_call: {
					call_id: "c1",
					function: { id: "c1", name: "edit", arguments: { path: "a.ts" } },
				},
			},
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		expect(events[0]).toEqual({
			type: "tool-call-delta",
			toolCallId: "c1",
			toolName: "edit",
			inputText: undefined,
			input: { path: "a.ts" },
		});
		expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
	});

	it("does not append a finish when the handler emits a done chunk", async () => {
		const handler = fakeHandler([
			{ type: "text", text: "x", id: "x" },
			{ type: "done", success: true, id: "x" },
		]);
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));

		const finishes = events.filter((e) => e.type === "finish");
		expect(finishes).toHaveLength(1);
		expect(finishes[0]).toEqual({
			type: "finish",
			reason: "stop",
			error: undefined,
		});
	});

	it("forwards the abort signal to the handler", async () => {
		const handler = fakeHandler([{ type: "text", text: "x", id: "x" }]);
		const controller = new AbortController();
		const model = createAgentModelFromApiHandler(handler);
		await collect(model.stream({ ...baseRequest, signal: controller.signal }));
		expect(handler.aborts[0]).toBe(controller.signal);
	});

	it("emits a finish(error) when the handler throws", async () => {
		const handler = fakeHandler([{ type: "text", text: "x", id: "x" }], {
			throwAfter: 0,
		});
		const model = createAgentModelFromApiHandler(handler);
		const events = await collect(model.stream(baseRequest));
		expect(events.at(-1)).toMatchObject({
			type: "finish",
			reason: "error",
			error: "boom",
		});
	});
});
