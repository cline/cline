import type {
	AgentExtension,
	AgentExtensionHookStage,
	AgentHooks,
} from "@clinebot/shared";

type ExtensionWithDynamicHandlers = AgentExtension & Record<string, unknown>;

function addHookHandler(
	extension: ExtensionWithDynamicHandlers,
	stages: AgentExtensionHookStage[],
	stage: AgentExtensionHookStage,
	handlerName: keyof AgentExtension,
	handler: unknown,
): void {
	if (typeof handler !== "function") {
		return;
	}
	stages.push(stage);
	extension[handlerName as string] = handler;
}

/**
 * Adapts the older `AgentHooks` bag into the extension hook surface.
 *
 * This keeps host-provided hook implementations behind the same
 * `AgentExtension` registration path used by plugin hooks, without changing
 * their runtime payload semantics.
 */
export function createAgentHooksExtension(
	name: string,
	hooks: AgentHooks | undefined,
): AgentExtension | undefined {
	if (!hooks) {
		return undefined;
	}

	const stages: AgentExtensionHookStage[] = [];
	const extension: ExtensionWithDynamicHandlers = {
		name,
		manifest: {
			capabilities: ["hooks"],
			hookStages: stages,
		},
	};

	addHookHandler(
		extension,
		stages,
		"session_start",
		"onSessionStart",
		hooks.onSessionStart,
	);
	addHookHandler(
		extension,
		stages,
		"run_start",
		"onRunStart",
		hooks.onRunStart,
	);
	addHookHandler(
		extension,
		stages,
		"iteration_start",
		"onIterationStart",
		hooks.onIterationStart,
	);
	addHookHandler(
		extension,
		stages,
		"turn_start",
		"onTurnStart",
		hooks.onTurnStart,
	);
	addHookHandler(
		extension,
		stages,
		"before_agent_start",
		"onBeforeAgentStart",
		hooks.onBeforeAgentStart,
	);
	addHookHandler(
		extension,
		stages,
		"tool_call_before",
		"onToolCall",
		hooks.onToolCallStart,
	);
	addHookHandler(
		extension,
		stages,
		"tool_call_after",
		"onToolResult",
		hooks.onToolCallEnd,
	);
	addHookHandler(extension, stages, "turn_end", "onTurnEnd", hooks.onTurnEnd);
	addHookHandler(
		extension,
		stages,
		"stop_error",
		"onAgentError",
		hooks.onStopError,
	);
	addHookHandler(
		extension,
		stages,
		"iteration_end",
		"onIterationEnd",
		hooks.onIterationEnd,
	);
	addHookHandler(extension, stages, "run_end", "onRunEnd", hooks.onRunEnd);
	addHookHandler(
		extension,
		stages,
		"session_shutdown",
		"onSessionShutdown",
		hooks.onSessionShutdown,
	);
	addHookHandler(extension, stages, "error", "onError", hooks.onError);

	return stages.length > 0 ? extension : undefined;
}
