import type { LlmsProviders } from "@clinebot/llms";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "../message-builder.js";
import { TurnProcessor } from "./turn-processor.js";

async function* streamChunks(
	chunks: LlmsProviders.ApiStreamChunk[],
): AsyncGenerator<LlmsProviders.ApiStreamChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

function createProcessor(
	chunks: LlmsProviders.ApiStreamChunk[],
): TurnProcessor {
	const handler: LlmsProviders.ApiHandler = {
		getMessages: () => [],
		createMessage: () => streamChunks(chunks),
		getModel: () => ({
			id: "mock-model",
			info: {
				id: "mock-model",
			},
		}),
	};

	return new TurnProcessor({
		handler,
		messageBuilder: new MessageBuilder(),
		emit: () => {},
	});
}

describe("TurnProcessor", () => {
	it("reconstructs tool arguments from streamed delta fragments", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "str_replace",
						arguments: '{"command":"str_replace","path":"/some/file"',
					},
				},
			},
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						arguments: ',"old_str":"before","new_str":"after"}',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toHaveLength(1);
		expect(turn.toolCalls[0]).toMatchObject({
			id: "call_1",
			name: "str_replace",
			input: {
				command: "str_replace",
				path: "/some/file",
				old_str: "before",
				new_str: "after",
			},
		});
	});

	it("treats a truncated json fragment as a complete tool input", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "str_replace",
						arguments: '{"command":"str_replace","path":"/some/file"',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toHaveLength(1);
		expect(turn.toolCalls[0]).toMatchObject({
			id: "call_1",
			name: "str_replace",
			input: {
				command: "str_replace",
				path: "/some/file",
			},
		});
	});

	it("persists invalid tool calls with a synthetic tool_use block", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "editor",
						arguments: '{"command":"create","path":/tmp/file.txt}',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn, assistantMessage } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.toolCalls).toEqual([]);
		expect(turn.invalidToolCalls).toEqual([
			{
				id: "call_1",
				name: "editor",
				input: {
					raw_arguments: '{"command":"create","path":/tmp/file.txt}',
					parse_error:
						"Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.",
				},
				reason: "invalid_arguments",
			},
		]);
		expect(assistantMessage).toBeDefined();
		expect(assistantMessage?.content).toContainEqual({
			type: "tool_use",
			id: "call_1",
			name: "editor",
			input: {
				raw_arguments: '{"command":"create","path":/tmp/file.txt}',
				parse_error:
					"Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.",
			},
		});
	});

	it("classifies non-json tool arguments with a specific parse error", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "editor",
						arguments:
							'command=create path=/tmp/file.txt file_text="hello world"',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.toolCalls).toEqual([]);
		expect(turn.invalidToolCalls).toEqual([
			{
				id: "call_1",
				name: "editor",
				input: {
					raw_arguments:
						'command=create path=/tmp/file.txt file_text="hello world"',
					parse_error:
						"Tool call arguments must be encoded as a JSON object or array.",
				},
				reason: "invalid_arguments",
			},
		]);
	});

	it("treats tool call with empty arguments as valid (no-parameter tools)", async () => {
		// OpenAI-compatible providers send arguments: "" for tools with no
		// parameters. This must be treated as valid input (empty object), not
		// flagged as missing_arguments.
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "get_user",
						arguments: "",
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toHaveLength(1);
		expect(turn.toolCalls[0]).toMatchObject({
			id: "call_1",
			name: "get_user",
			input: {},
		});
	});

	it("treats tool call with empty object arguments as valid", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "get_user",
						arguments: {},
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toHaveLength(1);
		expect(turn.toolCalls[0]).toMatchObject({
			id: "call_1",
			name: "get_user",
			input: {},
		});
	});

	it("classifies tool call with name but no arguments as missing_arguments (truncation)", async () => {
		const processor = createProcessor([
			{ type: "text", id: "r1", text: "Here is my long analysis..." },
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: { id: "call_1", name: "editor" },
				},
			},
			{
				type: "done",
				id: "r1",
				success: true,
				incompleteReason: "max_tokens",
			},
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.toolCalls).toEqual([]);
		expect(turn.invalidToolCalls).toEqual([
			{
				id: "call_1",
				name: "editor",
				input: {},
				reason: "missing_arguments",
			},
		]);
		expect(turn.text).toBe("Here is my long analysis...");
		expect(turn.truncated).toBe(true);
	});

	it("appends string argument deltas even when a later chunk starts with [", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "editor",
						arguments: '{"command":"create","file_text":"prefix',
					},
				},
			},
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						arguments: " [`ARCHITECTURE.md`]",
					},
				},
			},
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						arguments: ' suffix"}',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn, assistantMessage } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toEqual([
			{
				id: "call_1",
				name: "editor",
				input: {
					command: "create",
					file_text: "prefix [`ARCHITECTURE.md`] suffix",
				},
				signature: undefined,
			},
		]);
		expect(assistantMessage?.content).toContainEqual({
			type: "tool_use",
			id: "call_1",
			name: "editor",
			input: {
				command: "create",
				file_text: "prefix [`ARCHITECTURE.md`] suffix",
			},
			signature: undefined,
		});
	});
});
