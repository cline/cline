// Adapts the session's beforeTool hook chain into a pre-execution gate for
// provider-executed tools (providers with the `provider-tools` capability,
// e.g. the Claude Code CLI, run tools inside their own session — those calls
// never reach AgentRuntime's tool pipeline where hooks normally attach).
//
// The gate is consulted from inside the provider's inference request, before
// the provider runs the tool. Hook semantics mirror the runtime pipeline:
// `stop`/`cancel` aborts the provider's turn, `skip` blocks just this tool
// call, an `input` override rewrites the tool input. Hook failures fail open,
// consistent with hook error handling elsewhere.

import type {
	AgentBeforeToolContext,
	AgentHooks,
	AgentTool,
	BasicLogger,
	ProviderToolPermissionCallback,
	ProviderToolPermissionRequest,
} from "@cline/shared";

function syntheticBeforeToolContext(
	sessionId: string,
	request: ProviderToolPermissionRequest,
): AgentBeforeToolContext {
	const toolCallId =
		request.toolCallId ??
		`provider_tool_${Math.random().toString(36).slice(2)}`;
	return {
		// The provider executes mid-request: there is no live runtime snapshot
		// yet. Hooks only read identity fields and the iteration counter from
		// it, so a minimal session-scoped snapshot is provided.
		snapshot: {
			agentId: sessionId,
			conversationId: sessionId,
			runId: sessionId,
			parentAgentId: undefined,
			iteration: 0,
			messages: [],
		} as unknown as AgentBeforeToolContext["snapshot"],
		// Provider-executed tools have no local AgentTool registration.
		tool: undefined as unknown as AgentTool,
		toolCall: {
			type: "tool-call",
			toolCallId,
			toolName: request.toolName,
			input: request.input,
			execution: "provider",
		},
		input: request.input,
	};
}

function toUpdatedInput(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function createProviderToolPermission(options: {
	hooks: ReadonlyArray<AgentHooks | undefined>;
	sessionId: string;
	logger?: BasicLogger;
}): ProviderToolPermissionCallback | undefined {
	// Layers run with the runtime pipeline's beforeTool semantics (see
	// mergeRuntimeHooks in session-runtime-orchestrator.ts), NOT the
	// mergeAgentHooks aggregation: the first stop/skip wins immediately and
	// later layers never see the call, and a layer that throws fails open by
	// itself — it must not erase a denial another layer already issued or
	// prevent later layers from being consulted.
	const layers = options.hooks
		.map((layer) => layer?.beforeTool)
		.filter(
			(handler): handler is NonNullable<AgentHooks["beforeTool"]> =>
				typeof handler === "function",
		);
	if (layers.length === 0) {
		return undefined;
	}
	return async (request) => {
		let input = request.input;
		let inputUpdated = false;
		for (const handler of layers) {
			let result: Awaited<ReturnType<(typeof layers)[number]>>;
			try {
				result = await handler(
					syntheticBeforeToolContext(options.sessionId, {
						...request,
						input,
					}),
				);
			} catch (error) {
				// Fail open per layer: a broken hook must not brick the provider
				// session, but the remaining layers still get their say.
				options.logger?.log?.(
					`provider tool permission hook failed for "${request.toolName}"; skipping that hook layer`,
					{ severity: "warn", ...(error !== undefined ? { error } : {}) },
				);
				continue;
			}
			if (result?.stop || result?.skip) {
				return {
					behavior: "deny",
					message:
						result.reason ??
						`Tool "${request.toolName}" was blocked by a Cline hook`,
					interrupt: result.stop === true,
				};
			}
			if (result?.input !== undefined && result.input !== input) {
				input = result.input;
				inputUpdated = true;
			}
		}
		const updatedInput = inputUpdated ? toUpdatedInput(input) : undefined;
		return {
			behavior: "allow",
			...(updatedInput ? { updatedInput } : {}),
		};
	};
}
