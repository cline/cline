/**
 * Unit tests for `HookBridge`.
 *
 * Covers:
 *  - registration: the constructor wires `AgentHooks` +
 *    `AgentExtension[]` onto the provided `HookEngine` so the 15
 *    legacy stages still fire.
 *  - `toRuntimeHooks()`: each of the 7 synthesized runtime hooks
 *    dispatches to the expected `HookEngine` stage(s).
 *  - `beforeModel` fires BOTH `turn_start` and `before_agent_start`
 *    in that order (§3.3.1).
 *  - control merging: `cancel` → `stop:true`; `overrideInput` →
 *    `beforeTool.input`; `systemPrompt` / `appendMessages` /
 *    `replaceMessages` → `beforeModel.options.*`.
 *  - `onEvent` synthesizes `iteration_start` (on turn-started),
 *    `iteration_end` (on turn-finished), and `error` (on run-failed),
 *    in addition to the standard `runtime_event` dispatch.
 *  - imperative `dispatch()` for the session-scoped stages
 *    (session_start, session_shutdown, input, stop_error).
 *  - `control.context` is forwarded to `onHookContext(source, ctx)`.
 *
 * @see PLAN.md §3.3.1, §3.3.2, §3.3.3
 *
 * Landed with PLAN.md Step 8b.
 */

import type {
	AgentAfterToolContext,
	AgentBeforeModelContext,
	AgentBeforeToolContext,
	AgentMessage,
	AgentModelRequest,
	AgentRunLifecycleContext,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
	AgentTool,
	AgentToolCallPart,
	AgentToolResult,
	HookDispatchInput,
	HookDispatchResult,
	HookStage,
} from "@clinebot/shared";
import { describe, expect, it, vi } from "vitest";
import { HookBridge, type HookBridgeOptions } from "./hook-bridge";

// ---------------------------------------------------------------------------
// Test fixtures — hookEngine stub
// ---------------------------------------------------------------------------

type DispatchCall = {
	stage: HookStage;
	runId: string;
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration?: number;
	payload: unknown;
};

interface FakeHookEngine {
	dispatch: (input: HookDispatchInput) => Promise<HookDispatchResult>;
	register: (handler: unknown) => void;
	shutdown: (timeoutMs?: number) => Promise<void>;
	calls: DispatchCall[];
	registered: unknown[];
	// Allow tests to inject a control return for a given stage.
	controls: Partial<Record<HookStage, unknown>>;
}

function makeFakeEngine(): FakeHookEngine {
	const engine: FakeHookEngine = {
		calls: [],
		registered: [],
		controls: {},
		register(handler) {
			this.registered.push(handler);
		},
		async dispatch(input) {
			this.calls.push({
				stage: input.stage,
				runId: input.runId,
				agentId: input.agentId,
				conversationId: input.conversationId,
				parentAgentId: input.parentAgentId,
				iteration: input.iteration,
				payload: input.payload,
			});
			return {
				event: {
					eventId: `evt_${this.calls.length}`,
					stage: input.stage,
					createdAt: new Date(0),
					sequence: this.calls.length,
					runId: input.runId,
					agentId: input.agentId,
					conversationId: input.conversationId,
					parentAgentId: input.parentAgentId,
					iteration: input.iteration,
					payload: input.payload,
				},
				queued: false,
				dropped: false,
				control: this.controls[input.stage] as never,
				results: [],
			} as HookDispatchResult;
		},
		async shutdown() {
			// no-op
		},
	};
	return engine;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(
	overrides: Partial<AgentRuntimeStateSnapshot> = {},
): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_1",
		status: "running",
		iteration: 1,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		...overrides,
	};
}

function makeBridge(overrides: Partial<HookBridgeOptions> = {}): {
	bridge: HookBridge;
	engine: FakeHookEngine;
} {
	const engine = makeFakeEngine();
	const bridge = new HookBridge({
		agentId: "agent_test",
		conversationId: "conv_1",
		parentAgentId: null,
		hookEngine: engine as never,
		getRunId: () => "run_1",
		...overrides,
	});
	return { bridge, engine };
}

function makeMessage(): AgentMessage {
	return {
		id: "msg_1",
		role: "assistant",
		content: [{ type: "text", text: "hi" }],
		createdAt: 1,
	};
}

function makeRequest(): AgentModelRequest {
	return {
		messages: [],
		systemPrompt: "",
		tools: [],
		options: {},
	};
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("HookBridge — constructor registration", () => {
	it("registers provided AgentHooks on the engine", () => {
		const { engine } = makeBridge({
			hooks: { onRunStart: vi.fn(), onTurnStart: vi.fn() },
		});
		const stages = engine.registered.map((h) => (h as { stage: string }).stage);
		expect(stages).toContain("run_start");
		expect(stages).toContain("turn_start");
	});

	it("registers extensions whose manifest subscribes to hook stages", () => {
		const { engine } = makeBridge({
			extensions: [
				{
					name: "ext-1",
					manifest: {
						name: "ext-1",
						version: "1.0.0",
						capabilities: ["hooks"],
						hookStages: ["run_start", "turn_end"],
					},
					onRunStart: vi.fn(),
					onTurnEnd: vi.fn(),
				} as never,
			],
		});
		const stages = engine.registered.map((h) => (h as { stage: string }).stage);
		expect(stages).toContain("run_start");
		expect(stages).toContain("turn_end");
	});

	it("is a no-op when hooks and extensions are both absent", () => {
		const { engine } = makeBridge();
		expect(engine.registered).toEqual([]);
	});

	// ---------------------------------------------------------------------------
	// toRuntimeHooks — each of the 7 synthesized hooks
	// ---------------------------------------------------------------------------

	describe("HookBridge.toRuntimeHooks — per-hook dispatch mapping", () => {
		it("beforeRun → dispatches `run_start` with agent/conversation context", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const ctx: AgentRunLifecycleContext = { snapshot: makeSnapshot() };
			await hooks.beforeRun?.(ctx);
			expect(engine.calls).toHaveLength(1);
			expect(engine.calls[0]).toMatchObject({
				stage: "run_start",
				agentId: "agent_test",
				conversationId: "conv_1",
				parentAgentId: null,
				runId: "run_1",
				iteration: 1,
			});
		});

		it("afterRun does not dispatch `run_end`; SessionRuntime emits the host-facing result", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const result = {
				agentId: "agent_test",
				runId: "run_1",
				status: "completed",
				iterations: 1,
				outputText: "ok",
				messages: [],
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			} as AgentRunResult;
			await hooks.afterRun?.({ snapshot: makeSnapshot(), result });
			expect(engine.calls).toEqual([]);
		});

		it("beforeModel → dispatches BOTH `turn_start` THEN `before_agent_start` in order", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const ctx: AgentBeforeModelContext = {
				snapshot: makeSnapshot(),
				request: makeRequest(),
			};
			await hooks.beforeModel?.(ctx);
			expect(engine.calls.map((c) => c.stage)).toEqual([
				"turn_start",
				"before_agent_start",
			]);
		});

		it("beforeModel includes iteration in legacy hook payloads", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const ctx: AgentBeforeModelContext = {
				snapshot: makeSnapshot({ iteration: 3 }),
				request: makeRequest(),
			};
			await hooks.beforeModel?.(ctx);
			expect(engine.calls).toHaveLength(2);
			expect(engine.calls.map((call) => call.iteration)).toEqual([3, 3]);
			expect(
				engine.calls.map(
					(call) => (call.payload as { iteration?: number }).iteration,
				),
			).toEqual([3, 3]);
		});

		it("afterModel → dispatches `turn_end` with assistantMessage", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const message = makeMessage();
			await hooks.afterModel?.({
				snapshot: makeSnapshot(),
				assistantMessage: message,
				finishReason: "stop",
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["turn_end"]);
			const payload = engine.calls[0].payload as {
				assistantMessage: AgentMessage;
			};
			expect(payload.assistantMessage).toBe(message);
		});

		it("beforeTool → dispatches `tool_call_before` with tool and input", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const tool = {
				name: "read",
				description: "r",
				inputSchema: {},
				execute: async () => "",
			} as AgentTool;
			const toolCall: AgentToolCallPart = {
				type: "tool-call",
				toolCallId: "c1",
				toolName: "read",
				input: { path: "/a" },
			};
			const ctx: AgentBeforeToolContext = {
				snapshot: makeSnapshot(),
				tool,
				toolCall,
				input: { path: "/a" },
			};
			await hooks.beforeTool?.(ctx);
			expect(engine.calls.map((c) => c.stage)).toEqual(["tool_call_before"]);
		});

		it("afterTool → dispatches `tool_call_after` with result", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const tool = {
				name: "read",
				description: "r",
				inputSchema: {},
				execute: async () => "",
			} as AgentTool;
			const toolCall: AgentToolCallPart = {
				type: "tool-call",
				toolCallId: "c1",
				toolName: "read",
				input: {},
			};
			const result: AgentToolResult = { output: "done" };
			const ctx: AgentAfterToolContext = {
				snapshot: makeSnapshot(),
				tool,
				toolCall,
				input: {},
				result,
			};
			await hooks.afterTool?.(ctx);
			expect(engine.calls.map((c) => c.stage)).toEqual(["tool_call_after"]);
		});

		it("onEvent → dispatches `runtime_event` for generic events", async () => {
			const { bridge, engine } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			await hooks.onEvent?.({
				type: "assistant-text-delta",
				snapshot: makeSnapshot(),
				iteration: 1,
				text: "a",
				accumulatedText: "a",
			} as AgentRuntimeEvent);
			expect(engine.calls.map((c) => c.stage)).toEqual(["runtime_event"]);
		});
	});

	// ---------------------------------------------------------------------------
	// Control merging (cancel → stop, overrideInput → input, etc.)
	// ---------------------------------------------------------------------------

	describe("HookBridge.toRuntimeHooks — control merging", () => {
		it("beforeRun returns { stop:true } when hook cancels", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.run_start = { cancel: true };
			const hooks = bridge.toRuntimeHooks();
			const result = await hooks.beforeRun?.({ snapshot: makeSnapshot() });
			expect(result).toEqual({ stop: true });
		});

		it("afterModel returns { stop:true } when hook cancels", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.turn_end = { cancel: true };
			const hooks = bridge.toRuntimeHooks();
			const result = await hooks.afterModel?.({
				snapshot: makeSnapshot(),
				assistantMessage: makeMessage(),
				finishReason: "stop",
			});
			expect(result).toEqual({ stop: true });
		});

		it("beforeTool forwards overrideInput as { input: … }", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.tool_call_before = {
				overrideInput: { path: "/new" },
			};
			const hooks = bridge.toRuntimeHooks();
			const tool = {
				name: "read",
				description: "r",
				inputSchema: {},
				execute: async () => "",
			} as AgentTool;
			const toolCall: AgentToolCallPart = {
				type: "tool-call",
				toolCallId: "c1",
				toolName: "read",
				input: { path: "/a" },
			};
			const result = await hooks.beforeTool?.({
				snapshot: makeSnapshot(),
				tool,
				toolCall,
				input: { path: "/a" },
			});
			expect(result).toEqual({ input: { path: "/new" } });
		});

		it("beforeTool returns { stop:true } when hook cancels", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.tool_call_before = { cancel: true };
			const hooks = bridge.toRuntimeHooks();
			const tool = {
				name: "read",
				description: "r",
				inputSchema: {},
				execute: async () => "",
			} as AgentTool;
			const toolCall: AgentToolCallPart = {
				type: "tool-call",
				toolCallId: "c1",
				toolName: "read",
				input: {},
			};
			const result = await hooks.beforeTool?.({
				snapshot: makeSnapshot(),
				tool,
				toolCall,
				input: {},
			});
			expect(result).toEqual({ stop: true });
		});

		it("afterTool returns { stop:true } when hook cancels", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.tool_call_after = { cancel: true };
			const hooks = bridge.toRuntimeHooks();
			const tool = {
				name: "read",
				description: "r",
				inputSchema: {},
				execute: async () => "",
			} as AgentTool;
			const toolCall: AgentToolCallPart = {
				type: "tool-call",
				toolCallId: "c1",
				toolName: "read",
				input: {},
			};
			const result = await hooks.afterTool?.({
				snapshot: makeSnapshot(),
				tool,
				toolCall,
				input: {},
				result: { output: "" },
			});
			expect(result).toEqual({ stop: true });
		});

		it("beforeModel forwards systemPrompt / appendMessages / replaceMessages via options", async () => {
			const { bridge, engine } = makeBridge();
			// turn_start returns systemPrompt; before_agent_start returns
			// appendMessages — the merged result carries both.
			engine.controls.turn_start = { systemPrompt: "prepended" };
			engine.controls.before_agent_start = {
				appendMessages: [{ role: "user", content: "ctx" }],
			};
			const hooks = bridge.toRuntimeHooks();
			const result = await hooks.beforeModel?.({
				snapshot: makeSnapshot(),
				request: makeRequest(),
			});
			expect(result).toMatchObject({
				options: {
					systemPrompt: "prepended",
					appendMessages: [{ role: "user", content: "ctx" }],
				},
			});
		});

		it("beforeModel: before_agent_start wins conflicting systemPrompt", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.turn_start = { systemPrompt: "early" };
			engine.controls.before_agent_start = { systemPrompt: "late" };
			const hooks = bridge.toRuntimeHooks();
			const result = await hooks.beforeModel?.({
				snapshot: makeSnapshot(),
				request: makeRequest(),
			});
			expect(
				(result as { options?: { systemPrompt?: string } })?.options
					?.systemPrompt,
			).toBe("late");
		});

		it("beforeModel returns undefined when neither hook returns a control", async () => {
			const { bridge } = makeBridge();
			const hooks = bridge.toRuntimeHooks();
			const result = await hooks.beforeModel?.({
				snapshot: makeSnapshot(),
				request: makeRequest(),
			});
			expect(result).toBeUndefined();
		});
	});

	// ---------------------------------------------------------------------------
	// onRuntimeEvent — synthesized legacy stages (§3.3.1)
	// ---------------------------------------------------------------------------

	describe("HookBridge.onRuntimeEvent — synthesized stages", () => {
		it("turn-started → fires `runtime_event` THEN `iteration_start`", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.onRuntimeEvent({
				type: "turn-started",
				snapshot: makeSnapshot({ iteration: 2 }),
				iteration: 2,
			});
			expect(engine.calls.map((c) => c.stage)).toEqual([
				"runtime_event",
				"iteration_start",
			]);
			const iterStart = engine.calls[1];
			expect(iterStart.iteration).toBe(2);
			expect(iterStart.payload).toMatchObject({
				iteration: 2,
				agentId: "agent_test",
			});
		});

		it("turn-finished → fires `runtime_event` THEN `iteration_end` with hadToolCalls", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.onRuntimeEvent({
				type: "turn-finished",
				snapshot: makeSnapshot({ iteration: 3 }),
				iteration: 3,
				toolCallCount: 2,
			});
			expect(engine.calls.map((c) => c.stage)).toEqual([
				"runtime_event",
				"iteration_end",
			]);
			expect(engine.calls[1].payload).toMatchObject({
				iteration: 3,
				hadToolCalls: true,
				toolCallCount: 2,
			});
		});

		it("turn-finished with zero tool calls → hadToolCalls:false", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.onRuntimeEvent({
				type: "turn-finished",
				snapshot: makeSnapshot(),
				iteration: 1,
				toolCallCount: 0,
			});
			expect(engine.calls[1].payload).toMatchObject({
				hadToolCalls: false,
				toolCallCount: 0,
			});
		});

		it("run-failed → fires `runtime_event` THEN `error` with recoverable:false", async () => {
			const { bridge, engine } = makeBridge();
			const err = new Error("boom");
			await bridge.onRuntimeEvent({
				type: "run-failed",
				snapshot: makeSnapshot({ iteration: 5 }),
				error: err,
			});
			expect(engine.calls.map((c) => c.stage)).toEqual([
				"runtime_event",
				"error",
			]);
			expect(engine.calls[1].payload).toMatchObject({
				iteration: 5,
				error: err,
				recoverable: false,
			});
		});

		it("generic events (e.g. assistant-text-delta) → only `runtime_event`", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.onRuntimeEvent({
				type: "assistant-text-delta",
				snapshot: makeSnapshot(),
				iteration: 1,
				text: "a",
				accumulatedText: "a",
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["runtime_event"]);
		});
	});

	// ---------------------------------------------------------------------------
	// Imperative dispatch (SessionRuntime — session-scoped stages)
	// ---------------------------------------------------------------------------

	describe("HookBridge.dispatch — imperative stages", () => {
		it("dispatches `session_start` on demand", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.dispatch("hook.session_start", {
				stage: "session_start",
				payload: { marker: "hi" },
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["session_start"]);
		});

		it("dispatches `session_shutdown` on demand", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.dispatch("hook.session_shutdown", {
				stage: "session_shutdown",
				payload: {},
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["session_shutdown"]);
		});

		it("dispatches `run_end` on demand", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.dispatch("hook.run_end", {
				stage: "run_end",
				payload: { result: { finishReason: "completed" } },
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["run_end"]);
			expect(engine.calls[0].payload).toEqual({
				result: { finishReason: "completed" },
			});
		});

		it("dispatches `input` on demand and returns the merged control", async () => {
			const { bridge, engine } = makeBridge();
			engine.controls.input = { overrideInput: "new-prompt" };
			const control = await bridge.dispatch("hook.input", {
				stage: "input",
				payload: { prompt: "original" },
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["input"]);
			expect(control).toEqual({ overrideInput: "new-prompt" });
		});

		it("dispatches `stop_error` on demand", async () => {
			const { bridge, engine } = makeBridge();
			await bridge.dispatch("hook.stop_error", {
				stage: "stop_error",
				iteration: 3,
				payload: { error: new Error("boom") },
			});
			expect(engine.calls.map((c) => c.stage)).toEqual(["stop_error"]);
		});

		it("routes `control.context` through onHookContext(source, ctx)", async () => {
			const onHookContext = vi.fn();
			const { bridge, engine } = makeBridge({ onHookContext });
			engine.controls.run_start = {
				context: "<note>side-channel note</note>",
			};
			const hooks = bridge.toRuntimeHooks();
			await hooks.beforeRun?.({ snapshot: makeSnapshot() });
			expect(onHookContext).toHaveBeenCalledWith(
				"hook.run_start",
				"<note>side-channel note</note>",
			);
		});

		it("catches dispatch failures and forwards to onDispatchError", async () => {
			const onDispatchError = vi.fn();
			const { bridge, engine } = makeBridge({ onDispatchError });
			const boom = new Error("engine exploded");
			engine.dispatch = () => Promise.reject(boom);
			await bridge.dispatch("hook.session_start", {
				stage: "session_start",
				payload: {},
			});
			expect(onDispatchError).toHaveBeenCalledWith(boom);
		});
	});

	// ---------------------------------------------------------------------------
	// dispatchRuntimeEvent — fire-and-forget
	// ---------------------------------------------------------------------------

	describe("HookBridge.dispatchRuntimeEvent", () => {
		it("fires `runtime_event` with the event in the payload", async () => {
			const { bridge, engine } = makeBridge();
			bridge.dispatchRuntimeEvent({
				type: "usage-updated",
				snapshot: makeSnapshot(),
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
					totalCost: 0,
				},
			});
			await Promise.resolve();
			await Promise.resolve();
			expect(engine.calls.map((c) => c.stage)).toEqual(["runtime_event"]);
		});
	});

	// ---------------------------------------------------------------------------
	// shutdown
	// ---------------------------------------------------------------------------

	describe("HookBridge.shutdown", () => {
		it("delegates to hookEngine.shutdown", async () => {
			const { bridge, engine } = makeBridge();
			const spy = vi.spyOn(engine, "shutdown");
			await bridge.shutdown(250);
			expect(spy).toHaveBeenCalledWith(250);
		});
	});
});
