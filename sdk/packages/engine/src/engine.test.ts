import type { AgentModel, AgentModelEvent, AgentTool } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createEngine, type Engine, EngineStateError } from "./engine";
import type { EngineEvent } from "./events";
import type { EngineArtifact, EngineClock, RunSpec } from "./run-spec";

// -----------------------------------------------------------------------------
// Test doubles (no network, no providers)
// -----------------------------------------------------------------------------

function scriptedModel(turns: AgentModelEvent[][]): AgentModel {
	let call = 0;
	return {
		stream() {
			const turn = turns[Math.min(call, turns.length - 1)];
			call += 1;
			return (async function* () {
				for (const event of turn) {
					// Yield to the scheduler so concurrent engines interleave.
					await Promise.resolve();
					yield event;
				}
			})();
		},
	};
}

function textTurn(text: string): AgentModelEvent[] {
	return [
		{ type: "text-delta", text },
		{
			type: "usage",
			usage: {
				inputTokens: 10,
				outputTokens: 5,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		{ type: "finish", reason: "stop" },
	];
}

function toolTurn(
	toolName: string,
	input: unknown,
	toolCallId = `call_${toolName}`,
): AgentModelEvent[] {
	return [
		{ type: "tool-call-delta", toolCallId, toolName, input },
		{ type: "finish", reason: "tool-calls" },
	];
}

function errorTurn(error: string): AgentModelEvent[] {
	return [{ type: "finish", reason: "error", error }];
}

function echoTool(
	onExecute?: (input: unknown, context: unknown) => void,
): AgentTool {
	return {
		name: "echo",
		description: "Echoes its input",
		inputSchema: { type: "object" },
		execute: (input, context) => {
			onExecute?.(input, context);
			return { echoed: input };
		},
	};
}

function fakeClock(start = 1_000_000): EngineClock {
	let now = start;
	return {
		now: () => {
			now += 1;
			return now;
		},
	};
}

function baseSpec(overrides: Partial<RunSpec>): RunSpec {
	return {
		runId: "run_test0001",
		input: "do the thing",
		model: { kind: "model", model: scriptedModel([textTurn("done")]) },
		...overrides,
	};
}

function eventTypes(events: readonly EngineEvent[]): string[] {
	return events.map((event) => event.type);
}

// -----------------------------------------------------------------------------
// Completion
// -----------------------------------------------------------------------------

describe("completion", () => {
	it("runs to completion and reports transcript, usage, and deltas", async () => {
		const engine = createEngine(baseSpec({}), { clock: fakeClock() });
		const seen: EngineEvent[] = [];
		engine.subscribe((event) => seen.push(event));

		const result = await engine.run();

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("done");
		expect(result.runId).toBe("run_test0001");
		expect(result.iterations).toBe(1);
		expect(result.usage.inputTokens).toBe(10);
		expect(result.endedAt).toBeGreaterThan(result.startedAt);

		// user prompt + assistant answer
		expect(result.messages).toHaveLength(2);
		expect(result.messages[0].role).toBe("user");
		expect(result.messages[1].role).toBe("assistant");

		const types = eventTypes(seen);
		expect(types).toContain("run-started");
		expect(types).toContain("text-delta");
		expect(types.at(-1)).toBe("run-finished");

		// Ordered: sequences are contiguous from 0.
		expect(seen.map((event) => event.sequence)).toEqual(
			seen.map((_, index) => index),
		);
		// Every event names the run.
		expect(seen.every((event) => event.runId === "run_test0001")).toBe(true);

		// Persistence deltas: both messages appended, usage, terminal status.
		const kinds = result.persistence.map((delta) => delta.kind);
		expect(kinds.filter((kind) => kind === "message-appended")).toHaveLength(2);
		expect(kinds).toContain("usage-updated");
		expect(kinds.at(-1)).toBe("run-status-changed");
		const appended = result.persistence.filter(
			(delta) => delta.kind === "message-appended",
		);
		expect(appended.map((delta) => delta.index)).toEqual([0, 1]);
	});

	it("uses the injected clock for timestamps", async () => {
		const engine = createEngine(baseSpec({}), { clock: fakeClock(5_000_000) });
		const result = await engine.run();
		expect(result.startedAt).toBeGreaterThan(5_000_000);
		for (const event of engine.events) {
			expect(event.timestamp).toBeGreaterThan(5_000_000);
		}
	});

	it("continues from initial messages and indexes deltas after them", async () => {
		const initialMessages = [
			{
				id: "msg_prior",
				role: "user" as const,
				content: [{ type: "text" as const, text: "earlier" }],
				createdAt: 1,
			},
		];
		const engine = createEngine(baseSpec({ initialMessages }));
		const result = await engine.run();
		expect(result.messages).toHaveLength(3);
		const appended = result.persistence.filter(
			(delta) => delta.kind === "message-appended",
		);
		expect(appended.map((delta) => delta.index)).toEqual([1, 2]);
	});
});

// -----------------------------------------------------------------------------
// Model call usage metering
// -----------------------------------------------------------------------------

describe("model call usage metering", () => {
	it("emits one model-call-completed per model response with per-call deltas", async () => {
		const usageToolTurn: AgentModelEvent[] = [
			{
				type: "tool-call-delta",
				toolCallId: "call_1",
				toolName: "echo",
				input: {},
			},
			{
				type: "usage",
				usage: {
					inputTokens: 10,
					outputTokens: 5,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			},
			{ type: "finish", reason: "tool-calls" },
		];
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([usageToolTurn, textTurn("done")]),
					modelInfo: { id: "model-x", provider: "provider-y" },
				},
				tools: [echoTool()],
			}),
			{ clock: fakeClock() },
		);
		await engine.run();

		const calls = engine.events.filter(
			(event) => event.type === "model-call-completed",
		);
		expect(calls).toHaveLength(2);
		for (const call of calls) {
			expect(call).toMatchObject({
				providerId: "provider-y",
				modelId: "model-x",
				inputTokens: 10,
				outputTokens: 5,
				totalTokens: 15,
				status: "ok",
			});
			expect(
				(call as { durationMs?: number }).durationMs,
			).toBeGreaterThanOrEqual(0);
		}
		// Deltas, not cumulative: the run total is 20/10 but each call
		// reports its own 10/5.
		expect(engine.result?.usage.inputTokens).toBe(20);
	});

	it("reports an errored in-flight model call when the run fails", async () => {
		const engine = createEngine(
			baseSpec({
				model: { kind: "model", model: scriptedModel([errorTurn("boom")]) },
			}),
			{ clock: fakeClock() },
		);
		const result = await engine.run();
		expect(result.status).toBe("failed");
		const calls = engine.events.filter(
			(event) => event.type === "model-call-completed",
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			status: "error",
		});
	});

	it("carries provider identity from a provider-kind binding", async () => {
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([textTurn("ok")]),
				},
			}),
		);
		await engine.run();
		// No modelInfo on a bare model binding: identity is simply absent,
		// never invented.
		const call = engine.events.find(
			(event) => event.type === "model-call-completed",
		);
		expect(call).toMatchObject({ providerId: undefined, modelId: undefined });
	});
});

// -----------------------------------------------------------------------------
// Tool runs
// -----------------------------------------------------------------------------

describe("tool runs", () => {
	it("executes tools and emits tool lifecycle events", async () => {
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([
						toolTurn("echo", { value: 42 }),
						textTurn("finished with tools"),
					]),
				},
				tools: [echoTool()],
			}),
		);
		const result = await engine.run();

		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("finished with tools");
		const types = eventTypes(engine.events);
		expect(types).toContain("tool-started");
		expect(types).toContain("tool-finished");

		const finished = engine.events.find(
			(event) => event.type === "tool-finished",
		);
		expect(
			finished && finished.type === "tool-finished" && finished.output,
		).toEqual({ echoed: { value: 42 } });

		const toolMessage = result.messages.find(
			(message) => message.role === "tool",
		);
		expect(toolMessage).toBeDefined();
	});

	it("exposes the artifact sink to tools and emits artifact events", async () => {
		const stored: EngineArtifact[] = [];
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([toolTurn("echo", {}), textTurn("ok")]),
				},
				tools: [
					echoTool((_input, context) => {
						const metadata = (context as { metadata?: Record<string, unknown> })
							.metadata;
						const artifacts = metadata?.artifacts as {
							put: (artifact: EngineArtifact) => Promise<void>;
						};
						void artifacts.put({ name: "report.txt", data: "hello" });
					}),
				],
			}),
			{ artifacts: { put: (artifact) => void stored.push(artifact) } },
		);
		const result = await engine.run();
		expect(result.status).toBe("completed");
		expect(stored).toHaveLength(1);
		expect(stored[0].name).toBe("report.txt");
		expect(eventTypes(engine.events)).toContain("artifact-created");
	});
});

// -----------------------------------------------------------------------------
// Approval
// -----------------------------------------------------------------------------

describe("approval", () => {
	function approvalSpec(approved: boolean): RunSpec {
		return baseSpec({
			model: {
				kind: "model",
				model: scriptedModel([toolTurn("echo", { x: 1 }), textTurn("after")]),
			},
			tools: [echoTool()],
			toolPolicies: { echo: { autoApprove: false } },
			requestApproval: () => ({
				approved,
				reason: approved ? undefined : "not on my watch",
			}),
		});
	}

	it("denied approvals skip the tool with an error result", async () => {
		const engine = createEngine(approvalSpec(false));
		const result = await engine.run();
		expect(result.status).toBe("completed");

		const types = eventTypes(engine.events);
		expect(types).toContain("approval-requested");
		expect(types).toContain("approval-resolved");
		const resolved = engine.events.find(
			(event) => event.type === "approval-resolved",
		);
		expect(
			resolved && resolved.type === "approval-resolved" && resolved.approved,
		).toBe(false);

		const finished = engine.events.find(
			(event) => event.type === "tool-finished",
		);
		expect(
			finished && finished.type === "tool-finished" && finished.isError,
		).toBe(true);
	});

	it("granted approvals execute the tool", async () => {
		const engine = createEngine(approvalSpec(true));
		const result = await engine.run();
		expect(result.status).toBe("completed");
		const finished = engine.events.find(
			(event) => event.type === "tool-finished",
		);
		expect(
			finished && finished.type === "tool-finished" && finished.isError,
		).toBeFalsy();
		expect(
			finished && finished.type === "tool-finished" && finished.output,
		).toEqual({ echoed: { x: 1 } });
	});
});

// -----------------------------------------------------------------------------
// Steer
// -----------------------------------------------------------------------------

describe("steer", () => {
	it("merges queued steering text into the active run before the next model call", async () => {
		let engineRef: Engine | undefined;
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([
						toolTurn("echo", {}),
						textTurn("steered done"),
					]),
				},
				tools: [
					echoTool(() => {
						expect(engineRef?.steer("also update the docs")).toBe(true);
					}),
				],
			}),
		);
		engineRef = engine;
		const result = await engine.run();

		expect(result.status).toBe("completed");
		const types = eventTypes(engine.events);
		expect(types).toContain("steer-queued");
		expect(types).toContain("steer-merged");
		expect(types.indexOf("steer-queued")).toBeLessThan(
			types.indexOf("steer-merged"),
		);

		const steeredMessage = result.messages.find(
			(message) =>
				message.role === "user" &&
				message.content.some(
					(part) =>
						part.type === "text" && part.text === "also update the docs",
				),
		);
		expect(steeredMessage).toBeDefined();
	});

	it("rejects steering once the run is terminal", async () => {
		const engine = createEngine(baseSpec({}));
		await engine.run();
		expect(engine.steer("too late")).toBe(false);
	});
});

// -----------------------------------------------------------------------------
// Interrupt and abort
// -----------------------------------------------------------------------------

describe("interrupt", () => {
	it("cooperatively stops the run at the next control point", async () => {
		let engineRef: Engine | undefined;
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([toolTurn("echo", {}), textTurn("never")]),
				},
				tools: [
					echoTool(() => {
						engineRef?.interrupt("user paused");
					}),
				],
			}),
		);
		engineRef = engine;
		const result = await engine.run();

		expect(result.status).toBe("interrupted");
		expect(result.error).toBeUndefined();
		const types = eventTypes(engine.events);
		expect(types).toContain("interrupt-requested");
		expect(types.at(-1)).toBe("run-finished");
		// The second model turn never ran.
		expect(result.outputText).not.toBe("never");
	});

	it("an interrupt before run() stops the run before any model call", async () => {
		const engine = createEngine(baseSpec({}));
		engine.interrupt("changed my mind");
		const result = await engine.run();
		expect(result.status).toBe("interrupted");
		expect(
			result.messages.every((message) => message.role !== "assistant"),
		).toBe(true);
	});
});

describe("abort", () => {
	it("hard-stops the run with aborted status", async () => {
		let engineRef: Engine | undefined;
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([toolTurn("echo", {}), textTurn("never")]),
				},
				tools: [
					echoTool(() => {
						engineRef?.abort("stop now");
					}),
				],
			}),
		);
		engineRef = engine;
		const result = await engine.run();
		expect(result.status).toBe("aborted");
		expect(eventTypes(engine.events)).toContain("abort-requested");
	});
});

// -----------------------------------------------------------------------------
// Failure
// -----------------------------------------------------------------------------

describe("failure", () => {
	it("reports model failures with the error and a run-failed event", async () => {
		const engine = createEngine(
			baseSpec({
				model: {
					kind: "model",
					model: scriptedModel([errorTurn("provider exploded")]),
				},
			}),
		);
		const result = await engine.run();
		expect(result.status).toBe("failed");
		expect(result.error?.message).toContain("provider exploded");
		const last = engine.events.at(-1);
		expect(last?.type).toBe("run-failed");
		expect(last && last.type === "run-failed" && last.result.status).toBe(
			"failed",
		);
		const statusDelta = result.persistence.at(-1);
		expect(statusDelta).toEqual({
			kind: "run-status-changed",
			status: "failed",
		});
	});
});

// -----------------------------------------------------------------------------
// Single execution & concurrency
// -----------------------------------------------------------------------------

describe("execution ownership", () => {
	it("owns exactly one execution", async () => {
		const engine = createEngine(baseSpec({}));
		await engine.run();
		await expect(engine.run()).rejects.toThrow(EngineStateError);
	});

	it("concurrent engines share no mutable state", async () => {
		const engines = ["run_alpha001", "run_beta0001", "run_gamma001"].map(
			(runId, index) =>
				createEngine(
					baseSpec({
						runId,
						input: `prompt ${index}`,
						model: {
							kind: "model",
							model: scriptedModel([
								toolTurn("echo", { engine: index }),
								textTurn(`answer ${index}`),
							]),
						},
						tools: [echoTool()],
					}),
					{ clock: fakeClock((index + 1) * 10_000_000) },
				),
		);

		const results = await Promise.all(engines.map((engine) => engine.run()));

		for (const [index, engine] of engines.entries()) {
			const result = results[index];
			expect(result.status).toBe("completed");
			expect(result.outputText).toBe(`answer ${index}`);
			// Sequences are per-engine, contiguous from 0.
			expect(engine.events.map((event) => event.sequence)).toEqual(
				engine.events.map((_, position) => position),
			);
			// No cross-contamination: every event names this engine's run.
			expect(engine.events.every((event) => event.runId === result.runId)).toBe(
				true,
			);
			// Transcripts never leak across engines.
			for (const [otherIndex, otherResult] of results.entries()) {
				if (otherIndex === index) {
					continue;
				}
				expect(result.outputText).not.toBe(otherResult.outputText);
				expect(
					result.messages.some((message) =>
						message.content.some(
							(part) =>
								part.type === "text" && part.text === `prompt ${otherIndex}`,
						),
					),
				).toBe(false);
			}
		}
	});
});

// -----------------------------------------------------------------------------
// Event subscription
// -----------------------------------------------------------------------------

describe("event subscription", () => {
	it("replays past events to late subscribers on request", async () => {
		const engine = createEngine(baseSpec({}));
		await engine.run();
		const replayed: EngineEvent[] = [];
		engine.subscribe((event) => replayed.push(event), { replay: true });
		expect(replayed).toEqual([...engine.events]);
	});
});
