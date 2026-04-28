/**
 * Build an `AgentRuntimeConfig` from an `AgentConfig` plus session-owned
 * supporting objects (model handler, tools, hooks, plugins, telemetry).
 *
 * @see PLAN.md §3.1 — new file introduced alongside the core runtime port.
 * @see PLAN.md §3.2.1 — field-by-field mapping.
 *
 * Implemented in Step 8c. The function is intentionally **pure** — it
 * does not create handlers or tools itself; it receives them already
 * adapted (via `agent-config-adapter.ts`) from the caller
 * (`SessionRuntime`) and wires them into an `AgentRuntimeConfig`.
 *
 * Fields that do **not** round-trip into `AgentRuntimeConfig`
 * (e.g. `execution.maxConsecutiveMistakes`,
 * `execution.loopDetection`, `hookPolicies`) are
 * consumed by `SessionRuntime` / `MistakeTracker` /
 * `LoopDetectionTracker` — not passed through here. See §3.2.1's
 * "Fields with no corresponding AgentRuntimeConfig slot" note.
 */

import type {
	AgentConfig,
	AgentMessage,
	AgentModel,
	AgentRuntimeConfig,
	AgentRuntimePlugin,
	AgentTelemetry,
	AgentTool,
	BasicLogger,
} from "@clinebot/shared";
import type { HookBridge } from "../../hooks/hook-bridge";

/**
 * Inputs required to assemble an `AgentRuntimeConfig`. Distinct from
 * `AgentConfig` because some of these (the model adapter, the hook
 * bridge's runtime-hooks bag, a resolved plugin list) can only be
 * produced inside `SessionRuntime`.
 */
export interface CreateAgentRuntimeConfigInput {
	readonly agentConfig: AgentConfig;
	/**
	 * Core/hub runtime session identifier used for host lifecycle operations,
	 * event routing, persistence, and approval delivery.
	 */
	readonly sessionId?: string;
	readonly agentId: string;
	/**
	 * Agent conversation/transcript identifier used by tools, hooks, telemetry,
	 * and model history correlation.
	 */
	readonly conversationId?: string;
	readonly parentAgentId?: string;
	/** The role label for teammates (`AgentConfig.role` in sub-agent configs). */
	readonly agentRole?: string;
	/** Pre-built model adapter (produced by `apiHandlerToAgentModel`). */
	readonly model: AgentModel;
	readonly logger?: BasicLogger;
	readonly telemetry?: AgentTelemetry;
	/** Pre-built tool array (builtins + plugin-contributed + session extras). */
	readonly tools?: readonly AgentTool<unknown, unknown>[];
	/** Pre-resolved plugin list from the plugin loader. */
	readonly plugins?: readonly AgentRuntimePlugin[];
	/**
	 * Optional hook bridge. When provided, `AgentRuntimeConfig.hooks`
	 * is populated from `hookBridge.toRuntimeHooks()`. Omit for
	 * runtimes that do not need hook dispatch (e.g. unit tests).
	 */
	readonly hookBridge?: HookBridge;
	/** Seed messages (usually `session.conversation.getMessages()`). */
	readonly initialMessages?: readonly AgentMessage[];
	/**
	 * Override for `AgentRuntimeConfig.systemPrompt` — useful when
	 * the caller has composed additional guidance (e.g. via
	 * `LocalRuntimeHost.composeSystemPrompt`). Defaults to
	 * `agentConfig.systemPrompt`.
	 */
	readonly systemPrompt?: string;
}

/**
 * Produce an `AgentRuntimeConfig` per PLAN.md §3.2.1 mapping.
 */
export function createAgentRuntimeConfig(
	input: CreateAgentRuntimeConfigInput,
): AgentRuntimeConfig {
	const { agentConfig } = input;

	const modelOptions = buildModelOptions(agentConfig);
	const messageModelInfo = buildMessageModelInfo(agentConfig);
	const hooks = input.hookBridge?.toRuntimeHooks();
	const toolExecution = resolveToolExecution(agentConfig.maxParallelToolCalls);

	const config: AgentRuntimeConfig = {
		sessionId: input.sessionId ?? agentConfig.sessionId,
		agentId: input.agentId,
		conversationId: input.conversationId,
		agentRole: input.agentRole,
		systemPrompt: input.systemPrompt ?? agentConfig.systemPrompt,
		messageModelInfo,
		model: input.model,
		modelOptions,
		tools: input.tools,
		hooks,
		plugins: input.plugins,
		logger: input.logger ?? agentConfig.logger,
		telemetry: input.telemetry ?? mapTelemetry(agentConfig.telemetry),
		initialMessages: input.initialMessages,
		maxIterations: agentConfig.maxIterations,
		toolExecution,
		toolPolicies: agentConfig.toolPolicies,
		requestToolApproval: agentConfig.requestToolApproval,
	};

	return config;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Collect the provider-/reasoning-related fields from `AgentConfig`
 * into `AgentRuntimeConfig.modelOptions`. Kept undefined when every
 * field is undefined so the runtime does not receive an empty object.
 */
export function buildModelOptions(
	config: AgentConfig,
): Record<string, unknown> | undefined {
	const options: Record<string, unknown> = {};
	if (config.thinking !== undefined) {
		options.thinking = config.thinking;
	}
	if (config.reasoningEffort !== undefined) {
		options.reasoningEffort = config.reasoningEffort;
	}
	if (config.thinkingBudgetTokens !== undefined) {
		options.thinkingBudgetTokens = config.thinkingBudgetTokens;
	}
	if (config.maxTokensPerTurn !== undefined) {
		options.maxTokensPerTurn = config.maxTokensPerTurn;
	}
	if (config.apiTimeoutMs !== undefined) {
		options.apiTimeoutMs = config.apiTimeoutMs;
	}
	return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * Compose `messageModelInfo` from the provider-related fields per
 * §3.2.1: `{ id: modelId, provider: providerId, family:
 * providerConfig?.family }`.
 */
export function buildMessageModelInfo(
	config: AgentConfig,
): AgentMessage["modelInfo"] {
	const family = (config.providerConfig as { family?: string } | undefined)
		?.family;
	return {
		id: config.modelId,
		provider: config.providerId,
		family,
	};
}

/**
 * `"parallel"` when `maxParallelToolCalls ≥ 2`, `"sequential"` when
 * `1`, `undefined` when the caller did not specify.
 */
export function resolveToolExecution(
	maxParallelToolCalls: number | undefined,
): "sequential" | "parallel" | undefined {
	if (maxParallelToolCalls === undefined) {
		return undefined;
	}
	return maxParallelToolCalls >= 2 ? "parallel" : "sequential";
}

/**
 * Adapt the full `ITelemetryService` to the minimal `AgentTelemetry`
 * shape. The runtime only calls `capture(event, properties)`; the
 * remaining methods are host concerns and stay on the
 * `ITelemetryService` instance owned by `SessionRuntime`.
 */
export function mapTelemetry(
	telemetry: AgentConfig["telemetry"],
): AgentTelemetry | undefined {
	if (!telemetry) {
		return undefined;
	}
	return {
		capture: (event, properties) => {
			// The runtime's `AgentTelemetry.capture` signature uses
			// `Record<string, unknown>`, which is wider than
			// `TelemetryProperties`. We cast at the boundary — any
			// non-telemetry-compatible values are ignored by the
			// underlying service.
			telemetry.capture({
				event,
				properties: properties as
					| Parameters<typeof telemetry.capture>[0]["properties"]
					| undefined,
			});
		},
	};
}
