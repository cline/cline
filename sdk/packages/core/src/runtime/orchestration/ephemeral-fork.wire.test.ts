// Wire-level check that a fork reuses the turn's prompt cache. The unit tests
// in ephemeral-fork.test.ts compare `AgentModelRequest`s, but cache markers,
// sticky-session fields and each provider's body shape are added later by the
// llms adapters. Here every route runs a real SessionRuntime and gateway model
// against a stubbed fetch: a tool round, a final reply, then a fork of that
// final request. The fork must send the turn's request back byte for byte,
// apart from the moving cache marker, with only the reply and the instruction
// appended.
import { resolveProviderRequestHeaders } from "@cline/llms";
import type { AgentConfig, AgentTool } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { SessionRuntime } from "./session-runtime-orchestrator";

interface CapturedRequest {
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown> & { messages: unknown[] };
}

interface Route {
	providerId: string;
	modelId: string;
	wire: "anthropic" | "chat-completions";
	/** Indexes of the messages that carry `cache_control`, as sent today. */
	markers: { turn: number[]; fork: number[] };
	/** Body field or header that pins the conversation to one upstream. */
	sticky?: { body: string } | { header: string };
}

const SESSION_ID = "session_wire_test";

// The adapter marks the last message whose AI SDK role is "user"; tool results
// have role "tool", so the turn's marker stays on the prompt while the fork's
// moves to the instruction. Chat-completions bodies put the system prompt at
// index 0, so their indexes are one higher than Anthropic's.
const ROUTES: Route[] = [
	{
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		wire: "anthropic",
		markers: { turn: [0], fork: [4] },
	},
	{
		providerId: "openrouter",
		modelId: "anthropic/claude-sonnet-4.6",
		wire: "chat-completions",
		markers: { turn: [1], fork: [5] },
		sticky: { body: "session_id" },
	},
	{
		providerId: "vercel-ai-gateway",
		modelId: "anthropic/claude-sonnet-4.6",
		wire: "chat-completions",
		markers: { turn: [1], fork: [5] },
	},
	{
		providerId: "fireworks",
		modelId: "accounts/fireworks/models/glm-5p3-flash",
		wire: "chat-completions",
		markers: { turn: [], fork: [] },
	},
	{
		providerId: "cline",
		modelId: "anthropic/claude-sonnet-4.6",
		wire: "chat-completions",
		markers: { turn: [1], fork: [5] },
		sticky: { header: "x-task-id" },
	},
];

type Reply = { text: string } | { toolCall: string };

function sse(events: unknown[], trailer = ""): Response {
	return new Response(
		events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
			trailer,
		{ status: 200, headers: { "content-type": "text/event-stream" } },
	);
}

function anthropicReply(reply: Reply): Response {
	const block =
		"text" in reply
			? { type: "text", text: "" }
			: { type: "tool_use", id: "toolu_1", name: reply.toolCall, input: {} };
	const delta =
		"text" in reply
			? { type: "text_delta", text: reply.text }
			: { type: "input_json_delta", partial_json: "{}" };
	const usage = { input_tokens: 10, output_tokens: 2 };
	return sse([
		{
			type: "message_start",
			message: {
				id: "msg_1",
				type: "message",
				role: "assistant",
				model: "stub",
				content: [],
				stop_reason: null,
				usage,
			},
		},
		{ type: "content_block_start", index: 0, content_block: block },
		{ type: "content_block_delta", index: 0, delta },
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "text" in reply ? "end_turn" : "tool_use" },
			usage,
		},
		{ type: "message_stop" },
	]);
}

function chatCompletionsReply(reply: Reply): Response {
	const chunk = (delta: unknown, finishReason: string | null = null) => ({
		id: "chatcmpl_1",
		object: "chat.completion.chunk",
		created: 0,
		model: "stub",
		choices: [{ index: 0, delta, finish_reason: finishReason }],
	});
	const delta =
		"text" in reply
			? { role: "assistant", content: reply.text }
			: {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call_1",
							type: "function",
							function: { name: reply.toolCall, arguments: "{}" },
						},
					],
				};
	return sse(
		[
			chunk(delta),
			chunk({}, "text" in reply ? "stop" : "tool_calls"),
			{
				...chunk({}),
				choices: [],
				usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
			},
		],
		"data: [DONE]\n\n",
	);
}

function stubFetch(route: Route, replies: Reply[]) {
	const captured: CapturedRequest[] = [];
	const fetchStub = async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const url = input instanceof Request ? input.url : String(input);
		const headers = Object.fromEntries(new Headers(init?.headers).entries());
		captured.push({ url, headers, body: JSON.parse(String(init?.body)) });
		const reply = replies.shift();
		if (!reply) throw new Error(`unexpected request to ${url}`);
		return route.wire === "anthropic"
			? anthropicReply(reply)
			: chatCompletionsReply(reply);
	};
	return { captured, fetch: fetchStub as typeof fetch };
}

const echoTool: AgentTool = {
	name: "echo",
	description: "Echo the input",
	inputSchema: { type: "object", properties: {} },
	execute: async () => ({ ok: true }),
};

/** A chat on the route: tools, a system prompt and medium reasoning. */
function chatConfig(route: Route, fetch: typeof globalThis.fetch): AgentConfig {
	// Hosts resolve connection headers (the Cline provider's X-Task-ID among
	// them) at bootstrap and pass them on the config; see
	// local-runtime-bootstrap.ts.
	const headers = resolveProviderRequestHeaders({
		providerId: route.providerId,
		sessionId: SESSION_ID,
		defaultSource: "cli",
		coreVersion: "0.0.0-test",
	});
	return {
		providerId: route.providerId,
		modelId: route.modelId,
		apiKey: route.providerId === "cline" ? "workos:test-token" : "test-key",
		...(headers ? { headers } : {}),
		sessionId: SESSION_ID,
		systemPrompt: "You are a helpful assistant.",
		tools: [echoTool],
		reasoningEffort: "medium",
		providerConfig: { providerId: route.providerId, fetch },
		extensions: [{ name: "asker", manifest: { capabilities: ["asides"] } }],
	};
}

/** Runs one turn with a tool round, then forks its final request. */
async function captureTurnAndFork(route: Route) {
	const { captured, fetch } = stubFetch(route, [
		{ toolCall: "echo" },
		{ text: "Done." },
		{ text: "Run the tests" },
	]);
	const runIds: string[] = [];
	const session = new SessionRuntime({
		...chatConfig(route, fetch),
		hooks: {
			afterRun: ({ snapshot }) => {
				runIds.push(snapshot.runId ?? "");
			},
		},
	});

	await session.run("Fix the bug");
	const result = await session.fork({
		runId: runIds[0] ?? "",
		instruction: "Suggest the next prompt.",
	});

	expect(captured).toHaveLength(3);
	expect(result).toEqual(
		expect.objectContaining({ runId: runIds[0], text: "Run the tests" }),
	);
	const [, turn, fork] = captured as [
		CapturedRequest,
		CapturedRequest,
		CapturedRequest,
	];
	return { turn, fork };
}

function withoutCacheMarkers(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutCacheMarkers);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== "cache_control")
			.map(([key, entry]) => [key, withoutCacheMarkers(entry)]),
	);
}

function markedMessageIndexes(messages: unknown[]): number[] {
	return messages.flatMap((message, index) =>
		JSON.stringify(message).includes('"cache_control"') ? [index] : [],
	);
}

function textOf(message: unknown): string {
	const content = (message as { content: unknown }).content;
	if (typeof content === "string") return content;
	return (content as Array<{ text?: string }>)
		.map((part) => part.text ?? "")
		.join("");
}

describe.each(ROUTES)("fork completion on the wire ($providerId)", (route) => {
	it("sends the turn's last request as an unchanged prefix of the fork", async () => {
		const { turn, fork } = await captureTurnAndFork(route);

		expect(fork.url).toBe(turn.url);
		expect(fork.headers).toEqual(turn.headers);

		const { messages: turnMessages, ...turnRest } = turn.body;
		const { messages: forkMessages, ...forkRest } = fork.body;
		// Tools, system, thinking/reasoning, tool_choice, model, max_tokens,
		// top-level cache_control and sticky-session fields.
		expect(JSON.stringify(forkRest)).toBe(JSON.stringify(turnRest));

		const shared = forkMessages.slice(0, turnMessages.length);
		expect(JSON.stringify(withoutCacheMarkers(shared))).toBe(
			JSON.stringify(withoutCacheMarkers(turnMessages)),
		);
		const appended = forkMessages.slice(turnMessages.length);
		expect(appended.map(textOf)).toEqual(["Done.", "Suggest the next prompt."]);
	});

	it("moves the cache marker the way the adapter places it", async () => {
		const { turn, fork } = await captureTurnAndFork(route);

		expect(markedMessageIndexes(turn.body.messages)).toEqual(
			route.markers.turn,
		);
		expect(markedMessageIndexes(fork.body.messages)).toEqual(
			route.markers.fork,
		);
	});

	it.runIf(route.sticky)("keeps the sticky-session pin", async () => {
		const { turn, fork } = await captureTurnAndFork(route);
		const sticky = route.sticky;

		if (sticky && "body" in sticky) {
			expect(turn.body[sticky.body]).toBe(SESSION_ID);
			expect(fork.body[sticky.body]).toBe(SESSION_ID);
		}
		if (sticky && "header" in sticky) {
			expect(turn.headers[sticky.header]).toBe(SESSION_ID);
			expect(fork.headers[sticky.header]).toBe(SESSION_ID);
		}
	});
});
