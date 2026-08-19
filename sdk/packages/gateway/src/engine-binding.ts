/**
 * Default engine binding for a serving Gateway (Gateway RFC, Phase 3).
 *
 * Wraps the Phase 2 composition proof (`createEngineExecutionPort` over
 * the real `@cline/engine`) with:
 *
 * - model resolution from bot config + environment (full credential
 *   management is a later phase);
 * - tool approvals routed through the ApprovalBroker as server-initiated
 *   requests to subscribed clients;
 * - fail-fast handles: a run whose model cannot be resolved settles as a
 *   failed attempt instead of poisoning admission.
 */

import type {
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
} from "@cline/bot";
import { createEngineExecutionPort } from "@cline/bot";
import type { EngineModelBinding } from "@cline/engine";
import { SERVER_REQUEST_METHODS } from "@cline/shared/gateway";
import type { ApprovalBroker } from "./runtime";

export interface ConfiguredEngineOptions {
	/**
	 * Route tool approvals to clients as server requests. A getter is
	 * accepted because the broker lives on the runtime, which is created
	 * after the engine port (the server takes the port as an option).
	 */
	approvals?: ApprovalBroker | (() => ApprovalBroker | undefined);
	/** Override model resolution (defaults to bot config + environment). */
	resolveModel?: (invocation: EngineInvocation) => EngineModelBinding;
	env?: Record<string, string | undefined>;
}

const PROVIDER_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	openai: "OPENAI_API_KEY",
	cline: "CLINE_API_KEY",
};

export function resolveModelFromEnvironment(
	invocation: EngineInvocation,
	env: Record<string, string | undefined> = process.env,
): EngineModelBinding {
	const providerId =
		invocation.effectiveConfig.providerId ?? env.CLINE_GATEWAY_PROVIDER;
	const modelId = invocation.effectiveConfig.modelId ?? env.CLINE_GATEWAY_MODEL;
	if (!providerId || !modelId) {
		throw new Error(
			"No model configured: set bot config or CLINE_GATEWAY_PROVIDER / CLINE_GATEWAY_MODEL",
		);
	}
	const apiKey =
		env.CLINE_GATEWAY_API_KEY ?? env[PROVIDER_KEY_ENV[providerId] ?? ""];
	return { kind: "provider", providerId, modelId, apiKey };
}

function failedHandle(error: unknown): EngineRunHandle {
	const outcome: EngineOutcome = {
		status: "failed",
		outputText: "",
		error: {
			name: error instanceof Error ? error.name : "EngineBindingError",
			message: error instanceof Error ? error.message : String(error),
		},
	};
	return {
		steer: () => false,
		interrupt: () => {},
		abort: () => {},
		result: Promise.resolve(outcome),
	};
}

/** Real engine port for a serving Gateway. */
export function createConfiguredEnginePort(
	options: ConfiguredEngineOptions = {},
): EnginePort {
	return {
		start(invocation: EngineInvocation): EngineRunHandle {
			try {
				const model =
					options.resolveModel?.(invocation) ??
					resolveModelFromEnvironment(invocation, options.env);
				const approvals =
					typeof options.approvals === "function"
						? options.approvals()
						: options.approvals;
				const port = createEngineExecutionPort({
					model: () => model,
					requestApproval: approvals
						? async (request) => {
								const answer = await approvals.request(
									SERVER_REQUEST_METHODS.toolApproval,
									{
										botId: invocation.botId,
										sessionId: invocation.sessionId,
										runId: invocation.runId,
									},
									{
										toolCallId: request.toolCallId,
										toolName: request.toolName,
										input: request.input as Record<string, unknown> | undefined,
									},
								);
								const shaped = answer as {
									approved?: unknown;
									reason?: unknown;
								} | null;
								return {
									approved: shaped?.approved === true,
									reason:
										typeof shaped?.reason === "string"
											? shaped.reason
											: undefined,
								};
							}
						: undefined,
				});
				return port.start(invocation);
			} catch (error) {
				return failedHandle(error);
			}
		},
	};
}
