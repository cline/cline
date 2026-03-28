import { describe, expect, it, vi } from "vitest";
import { HookEngine } from "./engine";

describe("HookEngine", () => {
	it("executes handlers in deterministic priority/name order and merges control", async () => {
		const calls: string[] = [];
		const engine = new HookEngine();

		engine.register({
			name: "z-low",
			stage: "tool_call_before",
			priority: 1,
			handle: () => {
				calls.push("z-low");
				return { context: "from-z" };
			},
		});
		engine.register({
			name: "a-high",
			stage: "tool_call_before",
			priority: 10,
			handle: () => {
				calls.push("a-high");
				return {
					cancel: true,
					context: "from-a",
					overrideInput: { safe: true },
				};
			},
		});

		const result = await engine.dispatch({
			stage: "tool_call_before",
			runId: "run-1",
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			payload: {},
		});

		expect(calls).toEqual(["a-high", "z-low"]);
		expect(result.control).toEqual({
			cancel: true,
			review: false,
			context: "from-a\nfrom-z",
			overrideInput: { safe: true },
		});
	});

	it("retries failures using policy and succeeds", async () => {
		const handle = vi
			.fn<() => { context: string }>()
			.mockImplementationOnce(() => {
				throw new Error("boom");
			})
			.mockImplementation(() => ({ context: "ok" }));
		const engine = new HookEngine({
			policies: {
				handlers: {
					retryable: { retries: 1, retryDelayMs: 1 },
				},
			},
		});
		engine.register({
			name: "retryable",
			stage: "run_start",
			handle,
		});

		const result = await engine.dispatch({
			stage: "run_start",
			runId: "run-1",
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			payload: {},
		});

		expect(handle).toHaveBeenCalledTimes(2);
		expect(result.results[0]?.status).toBe("ok");
		expect(result.results[0]?.attempts).toBe(2);
	});

	it("throws for fail_closed blocking handler failures", async () => {
		const engine = new HookEngine({
			policies: {
				handlers: {
					strict: { failureMode: "fail_closed" },
				},
			},
		});
		engine.register({
			name: "strict",
			stage: "run_start",
			handle: () => {
				throw new Error("deny");
			},
		});

		await expect(
			engine.dispatch({
				stage: "run_start",
				runId: "run-1",
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				payload: {},
			}),
		).rejects.toThrow("deny");
	});

	it("queues async events and drains on shutdown", async () => {
		const calls: string[] = [];
		const dropped = vi.fn();
		const engine = new HookEngine({
			onDroppedEvent: dropped,
			policies: {
				stages: {
					run_end: { mode: "async", maxConcurrency: 1, queueLimit: 1 },
				},
			},
		});
		engine.register({
			name: "async-run-end",
			stage: "run_end",
			handle: async (event) => {
				await new Promise((resolve) => setTimeout(resolve, 15));
				calls.push(event.eventId);
			},
		});

		await engine.dispatch({
			stage: "run_end",
			runId: "run-1",
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			payload: { value: 1 },
		});
		await engine.dispatch({
			stage: "run_end",
			runId: "run-1",
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			payload: { value: 2 },
		});
		const droppedResult = await engine.dispatch({
			stage: "run_end",
			runId: "run-1",
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			payload: { value: 3 },
		});

		expect(droppedResult.dropped).toBe(true);
		expect(dropped).toHaveBeenCalledTimes(1);

		await engine.shutdown(500);
		expect(calls).toHaveLength(2);
	});
});
