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
		// Provider-executed tools have no local AgentTool registration, but the
		// runtime contract guarantees `tool` is defined whenever beforeTool
		// runs — hooks legitimately read `ctx.tool.name`. Supply an honest
		// stub so such hooks keep gating instead of throwing into the
		// per-layer fail-open.
		tool: {
			name: request.toolName,
			description:
				"Provider-executed tool (runs inside the provider's own session)",
			inputSchema: {},
			execute: () => {
				throw new Error(
					`Tool "${request.toolName}" is executed by the model provider and cannot be run locally`,
				);
			},
		} satisfies AgentTool,
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

// A throwing host logger must never escape the gate's control flow (a logging
// failure inside the fail-open catch would otherwise reject the whole gate).
function safeWarn(
	logger: BasicLogger | undefined,
	message: string,
	error?: unknown,
): void {
	try {
		logger?.log?.(message, {
			severity: "warn",
			...(error !== undefined ? { error } : {}),
		});
	} catch {
		// Logging failures must not affect gating.
	}
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
				safeWarn(
					options.logger,
					`provider tool permission hook failed for "${request.toolName}"; skipping that hook layer`,
					error,
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
				// Provider tool inputs are object-shaped on the wire; a rewrite
				// that is not an object cannot be represented and must not
				// displace a valid rewrite an earlier layer already made.
				const rewrite = toUpdatedInput(result.input);
				if (rewrite) {
					input = rewrite;
					inputUpdated = true;
				} else {
					safeWarn(
						options.logger,
						`provider tool permission hook returned a non-object input rewrite for "${request.toolName}"; ignoring it`,
					);
				}
			}
		}
		return {
			behavior: "allow",
			...(inputUpdated
				? { updatedInput: input as Record<string, unknown> }
				: {}),
		};
	};
}
