import { createAgentRuntime } from "@cline/agents";
import type {
	AgentConfig,
	AgentModel,
	AgentModelRequest,
	ConsecutiveMistakeLimitContext,
	ConsecutiveMistakeLimitDecision,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { SessionRuntime } from "./session-runtime-orchestrator";

function createRecoverySession(
	options: {
		batchSize?: number;
		config?: Partial<AgentConfig>;
		throwToolError?: boolean;
	} = {},
) {
	const requests: AgentModelRequest[] = [];
	const decisions: Array<{
		context: ConsecutiveMistakeLimitContext;
		resolve: (decision: ConsecutiveMistakeLimitDecision) => void;
	}> = [];
	let complete = false;
	const model: AgentModel = {
		async stream(request) {
			requests.push(request);
			return (async function* () {
				if (complete) {
					yield { type: "text-delta" as const, text: "Recovered" };
					yield { type: "finish" as const, reason: "stop" as const };
					return;
				}
				for (let i = 0; i < (options.batchSize ?? 1); i++) {
					yield {
						type: "tool-call-delta" as const,
						toolCallId: `call_${requests.length}_${i}`,
						toolName: "editor",
						inputText: '{"old_text":null}',
					};
				}
				yield { type: "finish" as const, reason: "tool-calls" as const };
			})();
		},
	};
	const execute = vi.fn(async () => {
		if (options.throwToolError)
			throw new Error("old_text must match existing content");
		return { success: false, error: "old_text must match existing content" };
	});
	const session = new SessionRuntime(
		{
			providerId: "anthropic",
			modelId: "claude-3-5-sonnet",
			apiKey: "test-key",
			systemPrompt: "Complete the task",
			maxIterations: 30,
			tools: [
				{
					name: "editor",
					description: "Edit a file",
					inputSchema: { type: "object" },
					execute,
				},
			],
			onConsecutiveMistakeLimitReached: (context) =>
				new Promise((resolve) => {
					decisions.push({ context, resolve });
				}),
			...options.config,
		},
		{
			createAgentRuntimeImpl: (config) =>
				createAgentRuntime({ ...config, model }),
		},
	);
	return {
		session,
		requests,
		decisions,
		execute,
		complete: () => {
			complete = true;
		},
	};
}

describe("mistake recovery with the real agent loop", () => {
	it("pauses the fifth identical call and delivers guidance once before the next request", async () => {
		const harness = createRecoverySession();
		const run = harness.session.run("edit the existing file");
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(1));
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(harness.requests).toHaveLength(5);
		expect(harness.execute).toHaveBeenCalledTimes(4);
		harness.complete();
		harness.decisions[0].resolve({
			action: "continue",
			guidance: "Read the file before editing",
		});
		const result = await run;
		expect(result.finishReason).toBe("completed");
		expect(harness.requests).toHaveLength(6);
		expect(harness.decisions).toHaveLength(1);
		const guidance = (messages: AgentModelRequest["messages"]) =>
			messages
				.flatMap((message) => message.content)
				.filter(
					(part) =>
						part.type === "text" &&
						part.text === "Read the file before editing",
				);
		expect(guidance(harness.requests[5].messages)).toHaveLength(1);
		expect(JSON.stringify(result.messages)).toContain(
			"Read the file before editing",
		);
	});

	it("stops without executing the blocked tool or making another model call", async () => {
		const harness = createRecoverySession();
		const run = harness.session.run("edit");
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(1));
		harness.decisions[0].resolve({ action: "stop", reason: "user chose stop" });
		expect((await run).finishReason).toBe("aborted");
		expect(harness.execute).toHaveBeenCalledTimes(4);
		expect(harness.requests).toHaveLength(5);
	});

	it.each([
		1, 8,
	])("coalesces an already-planned batch with parallelism %i", async (maxParallelToolCalls) => {
		const harness = createRecoverySession({
			batchSize: 20,
			config: { maxParallelToolCalls },
		});
		const run = harness.session.run("edit");
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(1));
		harness.complete();
		harness.decisions[0].resolve({
			action: "continue",
			guidance: "Change approach",
		});
		expect((await run).finishReason).toBe("completed");
		expect(harness.decisions).toHaveLength(1);
		expect(harness.requests).toHaveLength(2);
	});

	it("asks again for a new loop after continuing without a time-based grace period", async () => {
		const harness = createRecoverySession();
		const run = harness.session.run("edit");
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(1));
		harness.decisions[0].resolve({
			action: "continue",
			guidance: "Change approach",
		});
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(2));
		expect(harness.requests).toHaveLength(10);
		harness.decisions[1].resolve({ action: "stop" });
		expect((await run).finishReason).toBe("aborted");
	});

	it("releases an unanswered decision on abort and ignores its late answer", async () => {
		const harness = createRecoverySession();
		const run = harness.session.run("edit");
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(1));
		harness.session.abort("user abort");
		expect((await run).finishReason).toBe("aborted");
		expect(harness.decisions[0].context.signal?.aborted).toBe(true);
		expect(harness.session.canStartRun()).toBe(true);
		harness.complete();
		harness.decisions[0].resolve({
			action: "continue",
			guidance: "STALE GUIDANCE",
		});
		const next = await harness.session.continue("new request");
		expect(next.finishReason).toBe("completed");
		expect(JSON.stringify(next.messages)).not.toContain("STALE GUIDANCE");
	});

	it("also pauses at the consecutive tool-error limit when loop detection is disabled", async () => {
		const harness = createRecoverySession({
			throwToolError: true,
			config: {
				execution: { maxConsecutiveMistakes: 2, loopDetection: false },
			},
		});
		const run = harness.session.run("edit");
		await vi.waitFor(() => expect(harness.decisions).toHaveLength(1));
		expect(harness.requests).toHaveLength(2);
		expect(harness.execute).toHaveBeenCalledTimes(2);
		harness.complete();
		harness.decisions[0].resolve({
			action: "continue",
			guidance: "Fix the tool parameters",
		});
		expect((await run).finishReason).toBe("completed");
		expect(JSON.stringify(harness.requests[2].messages)).toContain(
			"Fix the tool parameters",
		);
	});
});
