import { createGateway } from "@cline/llms";
import type { AgentTool } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "./index";

/**
 * Drives the real OpenAI-compatible adapter into the real runtime with a
 * fake server stream, so the whole path is exercised: streamed partial
 * arguments, the AI SDK flushing them at end of stream, the adapter's repair
 * closing them into valid JSON, and the runtime deciding what to do with the
 * result when the stream ended at the output-token limit.
 */

function sseChunk(delta: unknown, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;
}

function toolCallStart(index: number, id: string): string {
	return sseChunk({
		role: "assistant",
		tool_calls: [
			{
				index,
				id,
				type: "function",
				function: { name: "run_commands", arguments: "" },
			},
		],
	});
}

function toolCallArguments(index: number, args: string): string {
	return sseChunk({ tool_calls: [{ index, function: { arguments: args } }] });
}

// One complete call, then a two-command call cut after its first element,
// ended by the server with finish_reason "length" — what llama.cpp sends when
// generation hits its token or context limit while a tool call is still
// streaming.
const CUT_OFF_TURN_STREAM =
	toolCallStart(0, "call_1") +
	toolCallArguments(0, '{"commands": ["echo one"]}') +
	toolCallStart(1, "call_2") +
	toolCallArguments(1, '{"commands": ["cd build",') +
	sseChunk({}, "length") +
	"data: [DONE]\n\n";

const DONE_STREAM =
	sseChunk({ role: "assistant", content: "done" }) +
	sseChunk({}, "stop") +
	"data: [DONE]\n\n";

describe("max-tokens turn through the OpenAI-compatible adapter", () => {
	it("executes the complete call, skips the cut-off call the adapter repaired into a plausible one, and retries with both results", async () => {
		const requestBodies: string[] = [];
		const responses = [CUT_OFF_TURN_STREAM, DONE_STREAM];
		const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
			requestBodies.push(String(init?.body));
			return new Response(responses.shift(), {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		});
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "openai-compatible",
					apiKey: "test-key",
					baseUrl: "http://fake.local/v1",
					fetch: fetch as unknown as typeof globalThis.fetch,
					models: [{ id: "test-model", name: "test-model" }],
				},
			],
		});
		const model = gateway.createAgentModel({
			providerId: "openai-compatible",
			modelId: "test-model",
		});
		const tool: AgentTool<{ commands: string[] }, string> = {
			name: "run_commands",
			description: "Run shell commands",
			inputSchema: {
				type: "object",
				properties: { commands: { type: "array", items: { type: "string" } } },
				required: ["commands"],
			},
			async execute(input) {
				return `ran ${input.commands.join("; ")}`;
			},
		};
		const execute = vi.spyOn(tool, "execute");
		const runtime = new AgentRuntime({ model, tools: [tool] });

		const result = await runtime.run("build it");

		expect(result.status).toBe("completed");
		// The complete call ran; the cut-off one did not.
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0]?.[0]).toEqual({ commands: ["echo one"] });

		// The adapter's repair closed `["cd build",` into a valid, plausible
		// `["cd build"]` before the runtime saw it. The marker preserved the
		// raw text, and with the length finish the runtime recorded the call as
		// truncated instead of taking the repaired arguments at face value.
		const assistant = result.messages.find(
			(message) => message.role === "assistant",
		);
		expect(assistant?.content).toContainEqual(
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "call_2",
				input: {},
				metadata: expect.objectContaining({
					rawInputText: '{"commands": ["cd build",',
					truncatedByOutputLimit: true,
				}),
			}),
		);

		const toolResults = result.messages
			.filter((message) => message.role === "tool")
			.flatMap((message) => message.content);
		expect(toolResults).toEqual([
			expect.objectContaining({ toolCallId: "call_1", isError: undefined }),
			expect.objectContaining({ toolCallId: "call_2", isError: true }),
		]);
		expect(JSON.stringify(toolResults[0])).toContain("ran echo one");
		expect(JSON.stringify(toolResults[1])).toContain(
			"reached the model's output-token limit",
		);

		// The retry request the server receives carries both results and the
		// concision nudge, so the model can retry only the missing work.
		expect(requestBodies).toHaveLength(2);
		expect(requestBodies[1]).toContain("ran echo one");
		expect(requestBodies[1]).toContain("output-token limit");
		expect(requestBodies[1]).toContain("cut off because it reached");
	});
});
