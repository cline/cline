/**
 * Bridges the flat `AgentRuntimeHooks` bag consumed by the
 * new `AgentRuntime` and the legacy 15-stage `HookEngine` + `AgentHooks`
 * + `AgentExtension[]` surface that `@clinebot/core` already speaks.
 *
 * @see PLAN.md §3.1   — replaces `packages/agents/src/runtime/lifecycle-orchestrator.ts`.
 * @see PLAN.md §3.2.3 — public surface of `HookBridge`.
 * @see PLAN.md §3.3.1 — OLD `HookStage` → NEW runtime primitive mapping.
 * @see PLAN.md §3.3.3 — OLD `config.hooks.*` → NEW placement.
 *
 * -------------------------------------------------------------------------
 * Responsibilities
 * -------------------------------------------------------------------------
 *
 *  1. **Register** the legacy `AgentHooks` + `AgentExtension[]` on the
 *     `HookEngine` once at construction (via `registerLifecycleHandlers`
 *     — moved verbatim from the old agents package).
 *  2. **Synthesize** an `AgentRuntimeHooks` bag via `toRuntimeHooks()`.
 *     Each runtime hook dispatches to the `HookEngine`'s
 *     corresponding stage (or stages, e.g. `beforeModel` fires both
 *     `turn_start` **and** `before_agent_start` per §3.3.1).
 *  3. **Forward** `AgentRuntimeEvent`s via `onEvent` (part of the
 *     runtime-hooks bag) into the engine's `runtime_event` stage — and
 *     synthesize the stages that have no direct new-runtime primitive
 *     (`iteration_start`, `iteration_end`, `error`, per §3.3.2).
 *  4. **Expose** imperative `dispatch(source, input)` for
 *     `SessionRuntime` to fire the *non*-runtime stages that live on
 *     the session boundary: `session_start`, `session_shutdown`,
 *     `input`, `run_end`, and `stop_error` (the bridge synthesizes
 *     these from session-level events, not from the new runtime's hooks).
 *  5. **Apply** hook-returned `control.context` by invoking
 *     `onHookContext(source, context)` so the caller (facade or
 *     session-runtime) can append `<hook_context source="…">…` user
 *     messages to the conversation (legacy behavior at
 *     `packages/agents/src/agent.ts:1402-1421`).
 *
 * This is the **non-Step-8a** half of the core runtime port: it wires
 * the existing hook ecosystem to the new runtime without changing
 * either side's semantics.
 */

import type {
	AgentExtension,
	AgentHookControl,
	AgentHooks,
	AgentRuntimeEvent,
	AgentRuntimeHooks,
	AgentStopControl,
	HookDispatchInput,
	HookEngine,
} from "@clinebot/shared";
import { registerLifecycleHandlers } from "./hook-registry";

export interface HookBridgeOptions {
	readonly agentId: string;
	readonly agentRole?: string;
	readonly conversationId: string;
	readonly parentAgentId: string | null;
	readonly hookEngine: HookEngine;
	/** Legacy flat `AgentHooks` bag — registered on the engine. */
	readonly hooks?: AgentHooks;
	/** Legacy `AgentExtension[]` — their `on*` callbacks are registered. */
	readonly extensions?: readonly AgentExtension[];
	/** Supplies the currently-active run id (stable for the duration of one run). */
	readonly getRunId: () => string;
	/** Called when any dispatched hook returns `control.context`. */
	readonly onHookContext?: (source: string, context: string) => void;
	/** Called when a dispatch throws. */
	readonly onDispatchError?: (error: unknown) => void;
}

type ImperativeDispatchInput = Pick<
	HookDispatchInput,
	"stage" | "payload" | "iteration" | "parentEventId"
>;

export class HookBridge {
	private readonly options: HookBridgeOptions;

	constructor(options: HookBridgeOptions) {
		this.options = options;
		// Register legacy hooks + extensions on the shared engine.
		// Safe to call even when both are empty: the registry is a
		// no-op for unset callbacks and disabled extensions.
		registerLifecycleHandlers(options.hookEngine, {
			hooks: options.hooks,
			extensions: options.extensions ? [...options.extensions] : undefined,
		});
	}

	// -------------------------------------------------------------------
	// Imperative dispatch (used by SessionRuntime for session-scoped stages)
	// -------------------------------------------------------------------

	/**
	 * Dispatch a lifecycle stage imperatively. `SessionRuntime` calls
	 * this at `session_start`, `session_shutdown`, `input`, `run_end`, and
	 * `stop_error` — stages that do not map cleanly onto the
	 * `AgentRuntime` hooks (§3.3.1).
	 *
	 * Returns the merged `AgentHookControl` from the dispatched
	 * handlers, or `undefined` if nothing ran. Context propagation
	 * (`control.context` → `onHookContext(source, …)`) is applied
	 * inline.
	 */
	async dispatch(
		source: string,
		input: ImperativeDispatchInput,
	): Promise<AgentHookControl | undefined> {
		try {
			const result = await this.options.hookEngine.dispatch({
				...input,
				runId: this.options.getRunId(),
				agentId: this.options.agentId,
				conversationId: this.options.conversationId,
				parentAgentId: this.options.parentAgentId,
			});
			if (result.control?.context) {
				this.options.onHookContext?.(source, result.control.context);
			}
			return result.control as AgentHookControl | undefined;
		} catch (error) {
			this.options.onDispatchError?.(error);
			return undefined;
		}
	}

	/**
	 * Fire the `runtime_event` stage for a single `AgentRuntimeEvent`.
	 * Non-blocking: errors route through `onDispatchError`. Exposed
	 * for callers who already hold the event (e.g. the legacy facade's
	 * subscribeEvents adapter).
	 */
	dispatchRuntimeEvent(event: AgentRuntimeEvent): void {
		void this.dispatch("hook.runtime_event", {
			stage: "runtime_event",
			payload: {
				agentId: this.options.agentId,
				conversationId: this.options.conversationId,
				parentAgentId: this.options.parentAgentId,
				event,
			},
		});
	}

	async shutdown(timeoutMs?: number): Promise<void> {
		await this.options.hookEngine.shutdown(timeoutMs);
	}

	// -------------------------------------------------------------------
	// toRuntimeHooks() — the synthesized AgentRuntimeHooks bag
	// -------------------------------------------------------------------

	/**
	 * Build the `AgentRuntimeHooks` bag consumed by
	 * `AgentRuntime`. Each synthesized callback:
	 *
	 *  - invokes `hookEngine.dispatch(stage, payload)` for the
	 *    corresponding legacy stage(s) (§3.3.1);
	 *  - merges the returned `AgentHookControl` into the runtime-hook's
	 *    return shape (`AgentStopControl` / `AgentBeforeModelResult` /
	 *    `AgentBeforeToolResult` / `AgentAfterToolResult`) per §3.3.3;
	 *  - applies `control.context` via `onHookContext(source, …)` so
	 *    the caller can append `<hook_context>` user messages.
	 *
	 * Legacy stages that have no direct new-runtime primitive
	 * (`iteration_start`, `iteration_end`, `error`) are synthesized
	 * inside `onEvent` from the corresponding `AgentRuntimeEvent`
	 * variants (§3.3.2).
	 */
	toRuntimeHooks(): AgentRuntimeHooks {
		return {
			beforeRun: async (ctx) => {
				const control = await this.dispatch("hook.run_start", {
					stage: "run_start",
					iteration: ctx.snapshot.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						iteration: ctx.snapshot.iteration,
						runId: this.options.getRunId(),
						snapshot: ctx.snapshot,
					},
				});
				return controlToStop(control);
			},

			beforeModel: async (ctx) => {
				// §3.3.1: `beforeModel` fires both `turn_start` AND
				// `before_agent_start` in that exact order (legacy
				// `agent.ts:599` → `:618` sequence, §3.3.3 note).
				const turnStartControl = await this.dispatch("hook.turn_start", {
					stage: "turn_start",
					iteration: ctx.snapshot.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						iteration: ctx.snapshot.iteration,
						runId: this.options.getRunId(),
						snapshot: ctx.snapshot,
						request: ctx.request,
					},
				});
				const beforeAgentControl = await this.dispatch(
					"hook.before_agent_start",
					{
						stage: "before_agent_start",
						iteration: ctx.snapshot.iteration,
						payload: {
							agentId: this.options.agentId,
							agentRole: this.options.agentRole,
							conversationId: this.options.conversationId,
							parentAgentId: this.options.parentAgentId,
							iteration: ctx.snapshot.iteration,
							runId: this.options.getRunId(),
							snapshot: ctx.snapshot,
							request: ctx.request,
						},
					},
				);
				return mergeBeforeModelControl(turnStartControl, beforeAgentControl);
			},

			afterModel: async (ctx) => {
				const control = await this.dispatch("hook.turn_end", {
					stage: "turn_end",
					iteration: ctx.snapshot.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						iteration: ctx.snapshot.iteration,
						runId: this.options.getRunId(),
						snapshot: ctx.snapshot,
						assistantMessage: ctx.assistantMessage,
						finishReason: ctx.finishReason,
					},
				});
				return controlToStop(control);
			},

			beforeTool: async (ctx) => {
				const control = await this.dispatch("hook.tool_call_before", {
					stage: "tool_call_before",
					iteration: ctx.snapshot.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						iteration: ctx.snapshot.iteration,
						runId: this.options.getRunId(),
						snapshot: ctx.snapshot,
						tool: ctx.tool,
						toolCall: ctx.toolCall,
						input: ctx.input,
					},
				});
				return controlToBeforeTool(control);
			},

			afterTool: async (ctx) => {
				const control = await this.dispatch("hook.tool_call_after", {
					stage: "tool_call_after",
					iteration: ctx.snapshot.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						iteration: ctx.snapshot.iteration,
						runId: this.options.getRunId(),
						snapshot: ctx.snapshot,
						tool: ctx.tool,
						toolCall: ctx.toolCall,
						input: ctx.input,
						result: ctx.result,
					},
				});
				return controlToAfterTool(control);
			},

			onEvent: (event) => this.onRuntimeEvent(event),
		};
	}

	// -------------------------------------------------------------------
	// onRuntimeEvent — synthesizes legacy stages from runtime events
	// -------------------------------------------------------------------

	/**
	 * Handle a single `AgentRuntimeEvent`. Always forwards it to the
	 * engine's `runtime_event` stage (§3.3.1 last row). Additionally
	 * synthesizes the three legacy stages that have no direct
	 * new-runtime primitive (§3.3.1):
	 *
	 *   turn-started  → also fires `iteration_start`
	 *   turn-finished → also fires `iteration_end`
	 *   run-failed    → also fires `error`
	 *
	 * This method is public so `SessionRuntime` can call it when it
	 * holds the event directly; the runtime-hooks bag's `onEvent` also
	 * routes through here.
	 */
	async onRuntimeEvent(event: AgentRuntimeEvent): Promise<void> {
		await this.dispatch("hook.runtime_event", {
			stage: "runtime_event",
			payload: {
				agentId: this.options.agentId,
				conversationId: this.options.conversationId,
				parentAgentId: this.options.parentAgentId,
				event,
			},
		});

		switch (event.type) {
			case "turn-started":
				await this.dispatch("hook.iteration_start", {
					stage: "iteration_start",
					iteration: event.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						runId: this.options.getRunId(),
						iteration: event.iteration,
						snapshot: event.snapshot,
					},
				});
				return;
			case "turn-finished":
				await this.dispatch("hook.iteration_end", {
					stage: "iteration_end",
					iteration: event.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						runId: this.options.getRunId(),
						iteration: event.iteration,
						hadToolCalls: event.toolCallCount > 0,
						toolCallCount: event.toolCallCount,
						snapshot: event.snapshot,
					},
				});
				return;
			case "run-failed":
				await this.dispatch("hook.error", {
					stage: "error",
					iteration: event.snapshot.iteration,
					payload: {
						agentId: this.options.agentId,
						agentRole: this.options.agentRole,
						conversationId: this.options.conversationId,
						parentAgentId: this.options.parentAgentId,
						runId: this.options.getRunId(),
						iteration: event.snapshot.iteration,
						error: event.error,
						recoverable: false,
					},
				});
				return;
			default:
				return;
		}
	}
}

// =============================================================================
// Private control-mergers
// =============================================================================

/**
 * Convert an `AgentHookControl` into the runtime's `AgentStopControl`
 * shape. `control.cancel === true` is interpreted as
 * `{ stop: true }` per §3.3.3 (legacy `cancel` flag translates to a
 * stop-control on `beforeRun` / `afterModel`).
 */
function controlToStop(
	control: AgentHookControl | undefined,
): AgentStopControl | undefined {
	if (!control) {
		return undefined;
	}
	if (control.cancel === true) {
		return { stop: true };
	}
	return undefined;
}

/**
 * Merge the two `AgentHookControl` returns from `turn_start` and
 * `before_agent_start` into a single `AgentBeforeModelResult`
 * (§3.3.3). The `before_agent_start` control wins on per-field
 * conflicts — matches legacy `agent.ts:618-649` where the later hook
 * can override earlier `systemPrompt` / `replaceMessages` /
 * `appendMessages`.
 */
function mergeBeforeModelControl(
	turnStart: AgentHookControl | undefined,
	beforeAgent: AgentHookControl | undefined,
): { stop?: boolean; options?: Record<string, unknown> } | undefined {
	if (!turnStart && !beforeAgent) {
		return undefined;
	}
	const cancel = turnStart?.cancel === true || beforeAgent?.cancel === true;
	const systemPrompt = beforeAgent?.systemPrompt ?? turnStart?.systemPrompt;
	// Legacy `replaceMessages` / `appendMessages` carry `Message[]`
	// (the old LlmsProviders shape), which is type-incompatible with
	// the new runtime's `AgentMessage[]`. Rather than attempt a lossy
	// cross-shape conversion here (the runtime has no direct message-
	// override anyway — `AgentBeforeModelResult.messages` exists but
	// carries `AgentMessage[]`), we forward both as an opaque
	// `options.*` hint. The facade / SessionRuntime materializes them
	// into `conversation.replaceMessages()` / `appendMessages()` on
	// the next turn, preserving the legacy deferred-apply semantics.
	const replaceMessages =
		beforeAgent?.replaceMessages ?? turnStart?.replaceMessages;
	const appendMessages =
		beforeAgent?.appendMessages ?? turnStart?.appendMessages;
	const out: { stop?: boolean; options?: Record<string, unknown> } = {};
	if (cancel) {
		out.stop = true;
	}
	const options: Record<string, unknown> = {};
	if (replaceMessages) {
		options.replaceMessages = [...replaceMessages];
	}
	if (appendMessages) {
		options.appendMessages = [...appendMessages];
	}
	if (systemPrompt !== undefined) {
		options.systemPrompt = systemPrompt;
	}
	if (Object.keys(options).length > 0) {
		out.options = options;
	}
	return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Convert an `AgentHookControl` into the runtime's
 * `AgentBeforeToolResult`. Maps:
 *
 *   control.cancel          → { stop: true }
 *   control.overrideInput   → { input: … }
 *   control.review (legacy) → no direct equivalent — handled by the
 *                             core ToolApprovalController, not passed
 *                             through the runtime hook.
 */
function controlToBeforeTool(
	control: AgentHookControl | undefined,
):
	| { skip?: boolean; stop?: boolean; reason?: string; input?: unknown }
	| undefined {
	if (!control) {
		return undefined;
	}
	const out: {
		skip?: boolean;
		stop?: boolean;
		reason?: string;
		input?: unknown;
	} = {};
	if (control.cancel === true) {
		out.stop = true;
	}
	if (control.overrideInput !== undefined) {
		out.input = control.overrideInput;
	}
	return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Convert an `AgentHookControl` into the runtime's
 * `AgentAfterToolResult`.
 */
function controlToAfterTool(
	control: AgentHookControl | undefined,
): { stop?: boolean; reason?: string } | undefined {
	if (!control) {
		return undefined;
	}
	if (control.cancel === true) {
		return { stop: true };
	}
	return undefined;
}
