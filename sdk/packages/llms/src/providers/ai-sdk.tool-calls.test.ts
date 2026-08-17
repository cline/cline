import type {
	AgentModelEvent,
	AgentToolDefinition,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { NoSuchToolError } from "ai";
import { describe, expect, it } from "vitest";
import {
	createOpenAICompatibleProvider,
	repairMalformedToolCall,
} from "./ai-sdk";

/**
 * Integration tests for malformed tool-call handling in the AI SDK adapter.
 *
 * Weaker models routinely emit tool calls with type mismatches (a bare string
 * where the schema wants an array) or arguments that are not valid JSON
 * (truncated payloads, single quotes). These tests drive the real adapter
 * with a fake OpenAI-compatible SSE response and assert that such calls are
 * coerced/repaired instead of being rejected before execution
 * (`metadata.inputParseError`), which surfaced as the
 * tool_call_type_validation / tool_call_invalid_json buckets under
 * task.provider_api_error.
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

const READ_FILES_TOOL: AgentToolDefinition = {
	name: "read_files",
	description: "Read files",
	inputSchema: {
		type: "object",
		properties: {
			files: {
				type: "array",
				items: {
					type: "object",
					properties: { path: { type: "string" } },
					required: ["path"],
				},
			},
		},
		required: ["files"],
	},
};

function sseToolCall(toolName: string, args: string): string {
	const chunk = (delta: unknown, finish: string | null = null) =>
		`data: ${JSON.stringify({
			id: "cmpl-1",
			object: "chat.completion.chunk",
			created: 1,
			model: "test-model",
			choices: [{ index: 0, delta, finish_reason: finish }],
		})}\n\n`;
	return (
		chunk({
			role: "assistant",
			tool_calls: [
				{
					index: 0,
					id: "call_1",
					type: "function",
					function: { name: toolName, arguments: "" },
				},
			],
		}) +
		chunk({ tool_calls: [{ index: 0, function: { arguments: args } }] }) +
		chunk({}, "tool_calls") +
		"data: [DONE]\n\n"
	);
}

/**
 * Same shape as sseToolCall, generalized to N concurrent tool calls and an
 * explicit finish_reason - used for the truncation side-channel tests below,
 * which specifically need finish_reason: "length" (a real max-output-tokens
 * cutoff, not the "tool_calls" clean-finish every other test in this file
 * uses).
 */
function sseToolCalls(
	calls: ReadonlyArray<{ name: string; args: string }>,
	finishReason: string,
): string {
	const chunk = (delta: unknown, finish: string | null = null) =>
		`data: ${JSON.stringify({
			id: "cmpl-1",
			object: "chat.completion.chunk",
			created: 1,
			model: "test-model",
			choices: [{ index: 0, delta, finish_reason: finish }],
		})}\n\n`;
	let body = chunk({
		role: "assistant",
		tool_calls: calls.map((call, index) => ({
			index,
			id: `call_${index}`,
			type: "function",
			function: { name: call.name, arguments: "" },
		})),
	});
	for (const [index, call] of calls.entries()) {
		body += chunk({ tool_calls: [{ index, function: { arguments: call.args } }] });
	}
	body += chunk({}, finishReason);
	body += "data: [DONE]\n\n";
	return body;
}

async function streamToolCallEvents(
	sseBody: string,
	tools: AgentToolDefinition[],
): Promise<AgentModelEvent[]> {
	const config = {
		providerId: "openai-compatible",
		apiKey: "test-key",
		baseUrl: "http://fake.local/v1",
		fetch: (async () =>
			new Response(sseBody, {
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

function findParseError(events: AgentModelEvent[]): string | undefined {
	for (const event of events) {
		if (event.type !== "tool-call-delta") continue;
		const metadata = event.metadata as Record<string, unknown> | undefined;
		if (typeof metadata?.inputParseError === "string") {
			return metadata.inputParseError;
		}
	}
	return undefined;
}

function findToolInput(events: AgentModelEvent[]): unknown {
	for (const event of events) {
		if (event.type === "tool-call-delta" && event.input !== undefined) {
			return event.input;
		}
	}
	return undefined;
}

describe("ai-sdk adapter malformed tool calls", () => {
	it("passes schema-mismatched input through to the tool instead of rejecting", async () => {
		// The executor's lenient union schema accepts a bare string for a
		// string[] property; rejecting at the adapter would prevent that.
		const events = await streamToolCallEvents(
			sseToolCall("run_commands", '{"commands": "ls -la"}'),
			[RUN_COMMANDS_TOOL],
		);

		expect(findParseError(events)).toBeUndefined();
		expect(findToolInput(events)).toEqual({ commands: "ls -la" });
	});

	it("passes well-formed input through unchanged", async () => {
		const events = await streamToolCallEvents(
			sseToolCall("run_commands", '{"commands": ["ls", "pwd"]}'),
			[RUN_COMMANDS_TOOL],
		);

		expect(findParseError(events)).toBeUndefined();
		expect(findToolInput(events)).toEqual({ commands: ["ls", "pwd"] });
	});

	it("no longer treats a syntactically-repaired unclosed container as safe to execute", async () => {
		// jsonrepair still mechanically closes the missing brace here - this
		// is unchanged, see the "repairs unclosed containers" case in the
		// repairMalformedToolCall describe block below. What changed is that
		// the adapter no longer treats *that* success as proof the model was
		// actually done: prefix-safe-json's own independent tracking of the
		// raw, unrepaired argument text sees the same root object never
		// closed, and flags it - regardless of jsonrepair's guess.
		const events = await streamToolCallEvents(
			sseToolCall("read_files", '{"files": [{"path": "/tmp/a.txt"}]'),
			[READ_FILES_TOOL],
		);

		expect(findParseError(events)).toContain("were not confirmed complete");
	});

	it("container-level truncation cut short by max_tokens (finish_reason: length) is never executed", async () => {
		// The exact repro from cline/cline#13001's still-open residual: no
		// unterminated string anywhere in the raw text (both list elements
		// are complete), so #13015's hasUnterminatedString guard does not
		// apply and jsonrepair happily closes the array. Only provider
		// stream metadata - finish_reason: "length" here - or (as in this
		// case) the fact that the outer container never closed at all can
		// tell you the model didn't actually finish.
		const events = await streamToolCallEvents(
			sseToolCalls(
				[{ name: "run_commands", args: '{"commands":["npm install","npm test"' }],
				"length",
			),
			[RUN_COMMANDS_TOOL],
		);

		expect(findParseError(events)).toContain("were not confirmed complete");
	});

	it("parallel calls: a complete tool call and a truncated one in the same length-terminated stream both fail closed", async () => {
		// Deliberately verifies the more conservative of two possible
		// behaviors: prefix-safe-json's coordinator applies one shared
		// stream-level end reason to every call it tracked (see its own
		// docs/EXECUTION_GATE.md limitations section) - it does not currently
		// distinguish "this call's own JSON closed cleanly before the cutoff"
		// from "the whole response was cut short by length". A call whose
		// own JSON is genuinely complete (read_files here) is still flagged
		// alongside the one that's actually truncated (run_commands), not
		// silently allowed through. Tracked as a possible follow-up in
		// prefix-safe-json itself, not something this integration papers
		// over.
		const events = await streamToolCallEvents(
			sseToolCalls(
				[
					{ name: "read_files", args: '{"files": [{"path": "/tmp/a.txt"}]}' },
					{ name: "run_commands", args: '{"commands":["npm install","npm test"' },
				],
				"length",
			),
			[READ_FILES_TOOL, RUN_COMMANDS_TOOL],
		);

		const parseErrors = events
			.filter((event): event is Extract<AgentModelEvent, { type: "tool-call-delta" }> => event.type === "tool-call-delta")
			.map((event) => (event.metadata as Record<string, unknown> | undefined)?.inputParseError)
			.filter((message): message is string => typeof message === "string");

		expect(parseErrors).toHaveLength(2);
		expect(parseErrors.some((message) => message.includes("read_files"))).toBe(true);
		expect(parseErrors.some((message) => message.includes("run_commands"))).toBe(true);
	});

	it("surfaces parse error for truncated JSON with unterminated string value", async () => {
		const truncated = '{"commands": ["npm install';
		const events = await streamToolCallEvents(
			sseToolCall("run_commands", truncated),
			[RUN_COMMANDS_TOOL],
		);

		expect(findParseError(events)).toContain("Invalid input");
	});

	it("repairs single-quoted JSON arguments", async () => {
		const events = await streamToolCallEvents(
			sseToolCall("run_commands", "{'commands': ['ls']}"),
			[RUN_COMMANDS_TOOL],
		);

		expect(findParseError(events)).toBeUndefined();
		expect(findToolInput(events)).toEqual({ commands: ["ls"] });
	});

	it("still surfaces a parse error for unrepairable argument text", async () => {
		const events = await streamToolCallEvents(
			sseToolCall("run_commands", "run ls for me please"),
			[RUN_COMMANDS_TOOL],
		);

		expect(findParseError(events)).toContain("Invalid input");
	});

	it("keeps the unavailable-tool error for unknown tools", async () => {
		const events = await streamToolCallEvents(
			sseToolCall("editor", '{"path": "/tmp/a.txt", "new_text": "x"}'),
			[RUN_COMMANDS_TOOL, READ_FILES_TOOL],
		);

		expect(findParseError(events)).toContain("unavailable tool 'editor'");
	});
});

describe("repairMalformedToolCall", () => {
	const toolCall = (input: string) => ({
		toolCallId: "call_1",
		toolName: "run_commands",
		input,
	});

	it("repairs unclosed containers (brackets/braces) with complete string values", async () => {
		const repaired = await repairMalformedToolCall({
			toolCall: toolCall('{"commands": ["ls"'),
			error: new Error("JSON parsing failed"),
		});
		expect(repaired?.input).toBe('{"commands":["ls"]}');
	});

	it("returns null for unterminated string values in truncated JSON", async () => {
		const truncated = '{"commands": ["npm install ';
		const repaired = await repairMalformedToolCall({
			toolCall: toolCall(truncated),
			error: new Error("JSON parsing failed"),
		});
		expect(repaired).toBeNull();
	});

	it("repairs single-quoted JSON", async () => {
		const repaired = await repairMalformedToolCall({
			toolCall: toolCall("{'commands': ['ls']}"),
			error: new Error("JSON parsing failed"),
		});
		expect(repaired?.input).toBe('{"commands":["ls"]}');
	});

	it("returns null for already-valid JSON (schema failures are not repairable here)", async () => {
		const repaired = await repairMalformedToolCall({
			toolCall: toolCall('{"commands": "ls"}'),
			error: new Error("Type validation failed"),
		});
		expect(repaired).toBeNull();
	});

	it("returns null for unknown-tool errors", async () => {
		const repaired = await repairMalformedToolCall({
			toolCall: toolCall('{"commands": ["ls"]}'),
			error: new NoSuchToolError({ toolName: "run_commands" }),
		});
		expect(repaired).toBeNull();
	});

	it("returns null for unrepairable garbage", async () => {
		const repaired = await repairMalformedToolCall({
			toolCall: toolCall("run ls for me"),
			error: new Error("JSON parsing failed"),
		});
		expect(repaired).toBeNull();
	});
});
