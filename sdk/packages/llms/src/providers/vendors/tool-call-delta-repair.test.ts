import type {
	AgentModelEvent,
	AgentToolDefinition,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "../ai-sdk";
import {
	createToolCallDeltaRepairFetch,
	ToolCallDeltaRepairer,
} from "./tool-call-delta-repair";

/**
 * Tests for streaming tool-call delta repair on OpenAI-compatible endpoints.
 *
 * Some OpenAI-compatible servers stream tool-call deltas without `index`
 * (continuation chunks then look like brand-new calls with no name) or never
 * emit a `function.name` at all (server-side parse of malformed model
 * output). Both make `@ai-sdk/openai-compatible`'s shared
 * StreamingToolCallTracker fail the whole turn with
 * `InvalidResponseDataError: Expected 'function.name' to be a string.`,
 * which surfaced in production as task.provider_api_error on the next
 * variant while the classic extension's ToolCallProcessor tolerated the
 * same streams. These tests drive the repair transform and the real
 * adapter with such streams and assert the tool call is recovered (or the
 * nameless call dropped) instead of erroring.
 */

const RUN_COMMANDS_TOOL: AgentToolDefinition = {
	name: "run_commands",
	description: "Run shell commands",
	inputSchema: {
		type: "object",
		properties: {
			commands: { type: "array", items: { type: "string" } },
		},
		required: ["commands"],
	},
};

function sseChunk(delta: unknown, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;
}

function sseBody(...chunks: string[]): string {
	return `${chunks.join("")}data: [DONE]\n\n`;
}

async function streamEvents(
	body: string,
	tools: AgentToolDefinition[] = [RUN_COMMANDS_TOOL],
): Promise<AgentModelEvent[]> {
	const config = {
		providerId: "openai-compatible",
		apiKey: "test-key",
		baseUrl: "http://fake.local/v1",
		fetch: (async () =>
			new Response(body, {
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
				content: [{ type: "text", text: "do the thing" }],
				createdAt: new Date(),
			},
		],
		tools,
	} as unknown as GatewayStreamRequest;

	const events: AgentModelEvent[] = [];
	for await (const event of await provider.stream(request, context)) {
		events.push(event);
	}
	return events;
}

function findFinishError(events: AgentModelEvent[]): string | undefined {
	for (const event of events) {
		if (event.type === "finish" && event.error) {
			return event.error;
		}
	}
	return undefined;
}

function findToolCall(
	events: AgentModelEvent[],
): { toolName?: string; input: unknown } | undefined {
	for (const event of events) {
		if (event.type === "tool-call-delta" && event.input !== undefined) {
			return { toolName: event.toolName, input: event.input };
		}
	}
	return undefined;
}

async function runRepairFetch(body: string): Promise<string> {
	const baseFetch = (async () =>
		new Response(body, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		})) as unknown as typeof fetch;
	const response = await createToolCallDeltaRepairFetch(baseFetch)(
		"http://fake.local/v1/chat/completions",
	);
	return await response.text();
}

describe("ToolCallDeltaRepairer", () => {
	it("assigns the first call's index to indexless continuation deltas", () => {
		const repairer = new ToolCallDeltaRepairer();
		const first = repairer.repairEntries([
			{
				id: "call_1",
				type: "function",
				function: { name: "run_commands", arguments: "" },
			},
		]);
		expect(first).toEqual([
			{
				id: "call_1",
				type: "function",
				index: 0,
				function: { name: "run_commands", arguments: "" },
			},
		]);

		// Continuation repeats the id but carries neither index nor name —
		// upstream would treat this as a new call and throw on the missing
		// name.
		const second = repairer.repairEntries([
			{ id: "call_1", function: { arguments: '{"commands":["ls"]}' } },
		]);
		expect(second).toEqual([
			{
				id: "call_1",
				index: 0,
				function: { arguments: '{"commands":["ls"]}' },
			},
		]);
	});

	it("treats bare argument deltas (no index, id, or name) as continuations", () => {
		const repairer = new ToolCallDeltaRepairer();
		repairer.repairEntries([
			{ id: "call_1", function: { name: "run_commands", arguments: "" } },
		]);
		const continuation = repairer.repairEntries([
			{ function: { arguments: '{"commands":[]}' } },
		]);
		expect(continuation).toEqual([
			{ index: 0, function: { arguments: '{"commands":[]}' } },
		]);
	});

	it("buffers nameless deltas and merges arguments once the name arrives", () => {
		const repairer = new ToolCallDeltaRepairer();
		const withheld = repairer.repairEntries([
			{ index: 0, id: "call_1", function: { arguments: '{"comm' } },
		]);
		expect(withheld).toEqual([]);

		const named = repairer.repairEntries([
			{
				index: 0,
				function: { name: "run_commands", arguments: 'ands":[]}' },
			},
		]);
		expect(named).toEqual([
			{
				index: 0,
				id: "call_1",
				function: { name: "run_commands", arguments: '{"commands":[]}' },
			},
		]);
	});

	it("drops calls whose name never arrives without breaking sibling indexes", () => {
		const repairer = new ToolCallDeltaRepairer();
		// Server index 0 never gets a name; server index 1 does. The named
		// call must be renumbered to output index 0 so the provider's tool
		// call array stays contiguous.
		const first = repairer.repairEntries([
			{ index: 0, id: "call_0", function: { arguments: "{}" } },
			{
				index: 1,
				id: "call_1",
				function: { name: "run_commands", arguments: "{}" },
			},
		]);
		expect(first).toEqual([
			{
				index: 0,
				id: "call_1",
				function: { name: "run_commands", arguments: "{}" },
			},
		]);
	});

	it("keeps well-formed indexed parallel calls intact", () => {
		const repairer = new ToolCallDeltaRepairer();
		const first = repairer.repairEntries([
			{ index: 0, id: "call_a", function: { name: "run_commands" } },
			{ index: 1, id: "call_b", function: { name: "read_files" } },
		]);
		expect(first.map((entry) => entry.index)).toEqual([0, 1]);
		const second = repairer.repairEntries([
			{ index: 1, function: { arguments: "{}" } },
			{ index: 0, function: { arguments: "{}" } },
		]);
		expect(second.map((entry) => entry.index)).toEqual([1, 0]);
	});

	it("treats an empty-string name as missing", () => {
		const repairer = new ToolCallDeltaRepairer();
		const withheld = repairer.repairEntries([
			{ index: 0, id: "call_1", function: { name: "", arguments: "{}" } },
		]);
		expect(withheld).toEqual([]);
		const named = repairer.repairEntries([
			{ index: 0, function: { name: "run_commands" } },
		]);
		expect(named).toEqual([
			{
				index: 0,
				id: "call_1",
				function: { name: "run_commands", arguments: "{}" },
			},
		]);
	});
});

describe("createToolCallDeltaRepairFetch", () => {
	it("passes non-tool-call SSE bodies through byte-identical", async () => {
		const body = `${sseChunk({ role: "assistant", content: "hi" })}${sseChunk(
			{},
			"stop",
		)}data: [DONE]\n\n`;
		expect(await runRepairFetch(body)).toBe(body);
	});

	it("passes non-SSE responses through untouched", async () => {
		const baseFetch = (async () =>
			new Response('{"ok":true}', {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;
		const response = await createToolCallDeltaRepairFetch(baseFetch)(
			"http://fake.local/v1/models",
		);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("repairs indexless continuations even when lines split across network chunks", async () => {
		const body = sseBody(
			sseChunk({
				role: "assistant",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "run_commands", arguments: "" },
					},
				],
			}),
			sseChunk({
				tool_calls: [
					{ id: "call_1", function: { arguments: '{"commands":["ls"]}' } },
				],
			}),
			sseChunk({}, "tool_calls"),
		);
		// Split mid-line to exercise the cross-chunk line buffer.
		const parts = [body.slice(0, 45), body.slice(45, 46), body.slice(46)];
		const baseFetch = (async () =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						const encoder = new TextEncoder();
						for (const part of parts) {
							controller.enqueue(encoder.encode(part));
						}
						controller.close();
					},
				}),
				{
					status: 200,
					headers: { "content-type": "text/event-stream" },
				},
			)) as unknown as typeof fetch;
		const response = await createToolCallDeltaRepairFetch(baseFetch)(
			"http://fake.local/v1/chat/completions",
		);
		const text = await response.text();

		const dataLines = text
			.split("\n")
			.filter((line) => line.startsWith("data: {"))
			.map((line) => JSON.parse(line.slice("data: ".length)));
		const toolCallLines = dataLines
			.map((chunk) => chunk.choices?.[0]?.delta?.tool_calls)
			.filter((calls) => Array.isArray(calls) && calls.length > 0);
		expect(toolCallLines).toEqual([
			[
				{
					id: "call_1",
					type: "function",
					index: 0,
					function: { name: "run_commands", arguments: "" },
				},
			],
			[
				{
					id: "call_1",
					index: 0,
					function: { arguments: '{"commands":["ls"]}' },
				},
			],
		]);
	});
});

describe("openai-compatible provider with malformed tool-call streams", () => {
	it("recovers a tool call streamed without index fields (name on first chunk only)", async () => {
		// Continuation chunks repeat the id but omit `index` and `name` —
		// without repair the tracker throws
		// `Expected 'function.name' to be a string.` on the second chunk.
		const events = await streamEvents(
			sseBody(
				sseChunk({
					role: "assistant",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "run_commands", arguments: "" },
						},
					],
				}),
				sseChunk({
					tool_calls: [{ id: "call_1", function: { arguments: '{"comm' } }],
				}),
				sseChunk({
					tool_calls: [
						{ id: "call_1", function: { arguments: 'ands":["ls"]}' } },
					],
				}),
				sseChunk({}, "tool_calls"),
			),
		);

		expect(findFinishError(events)).toBeUndefined();
		const toolCall = findToolCall(events);
		expect(toolCall?.toolName).toBe("run_commands");
		expect(toolCall?.input).toEqual({ commands: ["ls"] });
	});

	it("recovers a tool call whose continuations carry no index or id at all", async () => {
		const events = await streamEvents(
			sseBody(
				sseChunk({
					role: "assistant",
					tool_calls: [
						{
							id: "call_1",
							type: "function",
							function: { name: "run_commands", arguments: "" },
						},
					],
				}),
				sseChunk({
					tool_calls: [{ function: { arguments: '{"commands":["pwd"]}' } }],
				}),
				sseChunk({}, "tool_calls"),
			),
		);

		expect(findFinishError(events)).toBeUndefined();
		const toolCall = findToolCall(events);
		expect(toolCall?.toolName).toBe("run_commands");
		expect(toolCall?.input).toEqual({ commands: ["pwd"] });
	});

	it("recovers a tool call whose name arrives after its arguments", async () => {
		const events = await streamEvents(
			sseBody(
				sseChunk({
					role: "assistant",
					tool_calls: [
						{ index: 0, id: "call_1", function: { arguments: '{"comm' } },
					],
				}),
				sseChunk({
					tool_calls: [
						{
							index: 0,
							function: { name: "run_commands", arguments: 'ands":[]}' },
						},
					],
				}),
				sseChunk({}, "tool_calls"),
			),
		);

		expect(findFinishError(events)).toBeUndefined();
		const toolCall = findToolCall(events);
		expect(toolCall?.toolName).toBe("run_commands");
		expect(toolCall?.input).toEqual({ commands: [] });
	});

	it("drops a tool call that never receives a name instead of failing the turn", async () => {
		const events = await streamEvents(
			sseBody(
				sseChunk({
					role: "assistant",
					content: "Let me run that.",
					tool_calls: [
						{ index: 0, id: "call_1", function: { arguments: "{}" } },
					],
				}),
				sseChunk({
					tool_calls: [{ index: 0, function: { arguments: "" } }],
				}),
				sseChunk({}, "tool_calls"),
			),
		);

		expect(findFinishError(events)).toBeUndefined();
		expect(findToolCall(events)).toBeUndefined();
		expect(
			events.some(
				(event) => event.type === "text-delta" && event.text.length > 0,
			),
		).toBe(true);
	});

	it("keeps well-formed indexed tool-call streams working", async () => {
		const events = await streamEvents(
			sseBody(
				sseChunk({
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call_1",
							type: "function",
							function: { name: "run_commands", arguments: "" },
						},
					],
				}),
				sseChunk({
					tool_calls: [
						{ index: 0, function: { arguments: '{"commands":["ls"]}' } },
					],
				}),
				sseChunk({}, "tool_calls"),
			),
		);

		expect(findFinishError(events)).toBeUndefined();
		const toolCall = findToolCall(events);
		expect(toolCall?.toolName).toBe("run_commands");
		expect(toolCall?.input).toEqual({ commands: ["ls"] });
	});
});
