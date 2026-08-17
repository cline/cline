import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelRequest,
	AgentTool,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createOpenAICompatibleProvider } from "./ai-sdk";

/**
 * Execution-level dispatch-safety tests for the prefix-safe-json truncation
 * side-channel added in ai-sdk.ts.
 *
 * ai-sdk.tool-calls.test.ts proves the *emitted event* carries corrective
 * metadata (`metadata.inputParseError`). It does not prove a tool is never
 * actually invoked before that event becomes available - the concern this
 * file exists to settle: does prepareToolExecution() ever see a tool call
 * *before* the stream-end-driven correction has been merged into it?
 *
 * This drives this package's real provider (createOpenAICompatibleProvider,
 * unmodified from ai-sdk.tool-calls.test.ts's own harness) all the way
 * through @cline/agents' real dispatch path - AgentRuntime.run() ->
 * executeToolCalls() -> prepareToolExecution() -> tool.execute() - with an
 * instrumented tool that counts real invocations, not emitted events.
 *
 * @cline/agents is a devDependency declared for this file only; @cline/llms
 * has no runtime dependency on it and nothing in src/index.ts changes.
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

/** Same shape as ai-sdk.tool-calls.test.ts's sseToolCalls, duplicated here
 * deliberately - this file has no import relationship to that one. */
function toolCallsSse(
	calls: ReadonlyArray<{ name: string; args: string }>,
	finishReason: string,
): string {
	let body = sseChunk({
		role: "assistant",
		tool_calls: calls.map((call, index) => ({
			index,
			id: `call_${index}`,
			type: "function",
			function: { name: call.name, arguments: "" },
		})),
	});
	for (const [index, call] of calls.entries()) {
		body += sseChunk({
			tool_calls: [{ index, function: { arguments: call.args } }],
		});
	}
	body += sseChunk({}, finishReason);
	body += "data: [DONE]\n\n";
	return body;
}

/** A plain text-only completion turn with no tool calls - used as the
 * follow-up turn so the agent loop can terminate cleanly after processing
 * whatever happened (executed, skipped, or errored) on the first turn. */
function textOnlySse(text: string): string {
	return (
		sseChunk({ role: "assistant", content: text }) +
		sseChunk({}, "stop") +
		"data: [DONE]\n\n"
	);
}

/** Real network failure before any streaming starts at all - closest
 * approximation of a provider/connection error for this harness. */
function createFailingFetch(): typeof fetch {
	return (async () => {
		throw new Error("simulated network failure");
	}) as unknown as typeof fetch;
}

function createScriptedModel(
	steps: ReadonlyArray<{ sseBody: string } | { fetchOverride: typeof fetch }>,
): AgentModel {
	let stepIndex = 0;
	return {
		async stream(request: AgentModelRequest) {
			const step = steps[stepIndex];
			stepIndex += 1;
			if (!step) throw new Error("No scripted step available");
			const fetchImpl: typeof fetch =
				"fetchOverride" in step
					? step.fetchOverride
					: ((async () =>
							new Response(step.sseBody, {
								status: 200,
								headers: { "content-type": "text/event-stream" },
							})) as unknown as typeof fetch);
			const config = {
				providerId: "openai-compatible",
				apiKey: "test-key",
				baseUrl: "http://fake.local/v1",
				fetch: fetchImpl,
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
			// AgentRuntime's own request construction (see generateAssistantMessage
			// in agent-runtime.ts) is provider-agnostic and doesn't set
			// providerId/modelId - it defers provider selection entirely to
			// whatever AgentModel wraps it. This adapter is the thing supplying
			// that, so it fills them in here the same way ai-sdk.tool-calls.test.ts's
			// own hand-built request does.
			return provider.stream(
				{
					...request,
					providerId: "openai-compatible",
					modelId: "test-model",
				} as unknown as GatewayStreamRequest,
				context,
			);
		},
	};
}

function createInstrumentedTool(name: string): {
	tool: AgentTool;
	executions: () => number;
} {
	let count = 0;
	return {
		tool: {
			name,
			description: `Instrumented test tool ${name}`,
			inputSchema: { type: "object" },
			async execute() {
				count += 1;
				return { ok: true };
			},
		},
		executions: () => count,
	};
}

describe("execution-level dispatch safety (prefix-safe-json truncation side-channel)", () => {
	it("1. complete call: tool executes exactly once", async () => {
		const { tool, executions } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[
						{
							name: "run_commands",
							args: '{"commands":["npm install","npm test"]}',
						},
					],
					"tool_calls",
				),
			},
			{ sseBody: textOnlySse("done") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		const result = await runtime.run("run the tests");

		expect(result.status).toBe("completed");
		expect(executions()).toBe(1);
	});

	it("2. mid-string truncated (#13015's existing case): tool executes zero times", async () => {
		const { tool, executions } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[{ name: "run_commands", args: '{"commands": ["npm install' }],
					"length",
				),
			},
			{ sseBody: textOnlySse("stopping") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		await runtime.run("run the tests");

		expect(executions()).toBe(0);
	});

	it("3. container-level truncated (#13001 residual, literal repro): tool executes zero times", async () => {
		const { tool, executions } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[
						{
							name: "run_commands",
							args: '{"commands":["npm install","npm test"',
						},
					],
					"length",
				),
			},
			{ sseBody: textOnlySse("stopping") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		await runtime.run("run the tests");

		expect(executions()).toBe(0);
	});

	it("4. syntactically-complete repaired JSON but finish_reason: length: tool executes zero times", async () => {
		// No repair even needed here - the JSON is already fully valid on its
		// own - but the stream itself says it was cut short. Exercises the
		// "complete status, but not executable" branch (reason mismatch)
		// rather than the "root never closed" branch scenario 3 exercises.
		const { tool, executions } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[
						{
							name: "run_commands",
							args: '{"commands":["npm install","npm test"]}',
						},
					],
					"length",
				),
			},
			{ sseBody: textOnlySse("stopping") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		await runtime.run("run the tests");

		expect(executions()).toBe(0);
	});

	it("5. parallel complete + truncated calls under one length-terminated stream: truncated call never executes", async () => {
		const readFiles = createInstrumentedTool("read_files");
		const runCommands = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[
						{ name: "read_files", args: '{"files":[{"path":"/tmp/a.txt"}]}' },
						{
							name: "run_commands",
							args: '{"commands":["npm install","npm test"',
						},
					],
					"length",
				),
			},
			{ sseBody: textOnlySse("stopping") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [readFiles.tool, runCommands.tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		await runtime.run("read a file and run the tests");

		// The safety requirement: the truncated call must never execute.
		expect(runCommands.executions()).toBe(0);
		// Disclosed, conservative side effect (not a bug in this integration):
		// prefix-safe-json's coordinator applies one shared stream-level end
		// reason to every call it tracked, not a per-call one, so the
		// genuinely-complete read_files call is held back too rather than
		// silently allowed through alongside a truncated sibling.
		expect(readFiles.executions()).toBe(0);
	});

	it("6. existing #13015 mid-string test keeps its original event-level message (no double-correction)", async () => {
		const { tool } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[{ name: "run_commands", args: '{"commands": ["npm install' }],
					"length",
				),
			},
			{ sseBody: textOnlySse("stopping") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		const result = await runtime.run("run the tests");
		const toolResultMessages = result.messages.filter((m) => m.role === "tool");

		// Exactly one tool-result for the one tool call - never two, which
		// would indicate the existing tool-error path and the new side-channel
		// both independently produced a dispatch-affecting signal.
		expect(toolResultMessages).toHaveLength(1);
	});

	it("7. no duplicate corrective/error dispatch: exactly one tool-result message for the truncated call", async () => {
		const { tool, executions } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{
				sseBody: toolCallsSse(
					[
						{
							name: "run_commands",
							args: '{"commands":["npm install","npm test"',
						},
					],
					"length",
				),
			},
			{ sseBody: textOnlySse("stopping") },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		const result = await runtime.run("run the tests");
		const toolResultMessages = result.messages.filter((m) => m.role === "tool");

		expect(toolResultMessages).toHaveLength(1);
		expect(executions()).toBe(0);
	});

	it("8. provider/network error before any tool call starts: tool executes zero times", async () => {
		const { tool, executions } = createInstrumentedTool("run_commands");
		const model = createScriptedModel([
			{ fetchOverride: createFailingFetch() },
		]);
		const runtime = new AgentRuntime({
			model,
			tools: [tool],
			toolPolicies: { "*": { autoApprove: true } },
		});

		// AgentRuntime.run() reports failure via result.status rather than a
		// rejected promise (see AgentRunResult).
		const result = await runtime.run("run the tests");
		expect(result.status).toBe("failed");
		expect(executions()).toBe(0);
	});
});
