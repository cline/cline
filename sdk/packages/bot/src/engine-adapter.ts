/**
 * Engine execution port over the real `@cline/engine` (Gateway RFC,
 * Phase 2).
 *
 * `@cline/bot` invokes execution only through `EnginePort`; this adapter
 * is the composition proof that the port maps onto `@cline/engine`
 * one-to-one. Resource bindings (model, tools, approvals) stay
 * caller-supplied: the Gateway provides real ones, tests provide fakes.
 * The dependency direction is bot -> engine, never the reverse.
 */

import {
	type AgentTool,
	createEngine,
	type EngineApprovalPort,
	type EngineClock,
	type EngineModelBinding,
	type EngineOptions,
} from "@cline/engine";
import { resolveBotSystemPrompt } from "./overrides";
import type { EngineInvocation, EnginePort, EngineRunHandle } from "./ports";

export interface EngineExecutionBindings {
	/** Resolve the model binding for an invocation (per-turn overrides apply). */
	model(invocation: EngineInvocation): EngineModelBinding;
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	tools?(invocation: EngineInvocation): readonly AgentTool<any, any>[];
	requestApproval?: EngineApprovalPort;
	clock?: EngineClock;
	telemetry?: EngineOptions["telemetry"];
	logger?: EngineOptions["logger"];
	artifacts?: EngineOptions["artifacts"];
}

export function createEngineExecutionPort(
	bindings: EngineExecutionBindings,
): EnginePort {
	return {
		start(invocation: EngineInvocation): EngineRunHandle {
			const engine = createEngine(
				{
					runId: invocation.runId,
					sessionId: invocation.sessionId,
					botId: invocation.botId,
					input: invocation.input,
					initialMessages: invocation.initialMessages,
					systemPrompt: resolveBotSystemPrompt(invocation.effectiveConfig),
					model: bindings.model(invocation),
					tools: bindings.tools?.(invocation),
					toolPolicies: invocation.effectiveConfig.toolPolicies,
					maxIterations: invocation.effectiveConfig.maxIterations,
					requestApproval: bindings.requestApproval,
					metadata: { workspaceRoot: invocation.workspaceRoot },
				},
				{
					clock: bindings.clock,
					telemetry: bindings.telemetry,
					logger: bindings.logger,
					artifacts: bindings.artifacts,
				},
			);
			const result = engine.run().then((runResult) => ({
				status: runResult.status,
				outputText: runResult.outputText,
				error: runResult.error,
			}));
			return {
				steer: (text) => engine.steer(text),
				interrupt: (reason) => engine.interrupt(reason),
				abort: (reason) => engine.abort(reason),
				result,
				subscribe: (listener) => engine.subscribe(listener),
			};
		},
	};
}
