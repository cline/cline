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

// A two-command call cut after the first element, ended by the server with
// finish_reason "length" — what llama.cpp sends when generation hits its
// token or context limit while the tool call is still streaming.
const CUT_OFF_TOOL_CALL_STREAM =
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
	}) +
	sseChunk({
		tool_calls: [
			{ index: 0, function: { arguments: '{"commands": ["cd build",' } },
		],
	}) +
	sseChunk({}, "length") +
	"data: [DONE]\n\n";

const DONE_STREAM =
	sseChunk({ role: "assistant", content: "done" }) +
	sseChunk({}, "stop") +
	"data: [DONE]\n\n";

describe("max-tokens turn through the OpenAI-compatible adapter", () => {
	it("skips a cut-off tool call the adapter repaired into a plausible one and retries with the error and nudge", async () => {
		const requestBodies: string[] = [];
		const responses = [CUT_OFF_TOOL_CALL_STREAM, DONE_STREAM];
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
				return input.commands.join("; ");
			},
		};
		const execute = vi.spyOn(tool, "execute");
		const runtime = new AgentRuntime({ model, tools: [tool] });

		const result = await runtime.run("build it");

		expect(result.status).toBe("completed");
		expect(execute).not.toHaveBeenCalled();

		// What reached the runtime was a valid, plausible, non-empty call: the
		// adapter's repair closed `["cd build",` into `["cd build"]`. Only the
		// finish reason says it is not what the model meant.
		const assistant = result.messages.find(
			(message) => message.role === "assistant",
		);
		expect(assistant?.content).toContainEqual(
			expect.objectContaining({
				type: "tool-call",
				toolCallId: "call_1",
				input: { commands: ["cd build"] },
			}),
		);

		const toolMessage = result.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolMessage?.content[0]).toMatchObject({
			type: "tool-result",
			toolCallId: "call_1",
			isError: true,
		});
		expect(JSON.stringify(toolMessage?.content[0])).toContain(
			"reached the model's output-token limit",
		);

		// The retry request the server receives carries the error result and
		// the concision nudge, and nothing else ran in between.
		expect(requestBodies).toHaveLength(2);
		expect(requestBodies[1]).toContain("output-token limit");
		expect(requestBodies[1]).toContain("cut off because it reached");
	});
});
