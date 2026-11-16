/**
 * Reusable spawn_agent tool for delegating tasks to sub-agents.
 */

import {
	type AgentConfig,
	type AgentEvent,
	type AgentHooks,
	type AgentResult,
	type AgentTool,
	type AgentToolContext,
	type BasicLogger,
	createTool,
	type DelegationTarget,
	DelegationTargetSchema,
	type HookErrorMode,
	type ITelemetryService,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolPolicy,
	zodToJsonSchema,
} from "@cline/shared";
import { z } from "zod";
import {
	createDelegatedAgent,
	type DelegatedAgentConfigProvider,
	resolveDelegatedAgentConfig,
} from "./delegated-agent";

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentFinishReason = AgentResult["finishReason"];

export const SpawnAgentInputSchema = z.object({
	systemPrompt: z
		.string()
		.describe("System prompt defining the sub-agent's behavior"),
	task: z.string().describe("Task for the sub-agent to complete"),
	target: DelegationTargetSchema.optional().describe(
		"Exact configured provider/model from list_delegation_targets. Omit to inherit this agent's connection.",
	),
});

export type SpawnAgentInput = z.infer<typeof SpawnAgentInputSchema>;

export interface SpawnAgentOutput {
	target?: DelegationTarget;
	text: string;
	iterations: number;
	finishReason: AgentFinishReason;
	usage: {
		inputTokens: number;
		outputTokens: number;
	};
}

export interface SubAgentStartContext {
	target?: DelegationTarget;
	subAgentId: string;
	conversationId: string;
	parentAgentId: string;
	input: SpawnAgentInput;
}

export interface SubAgentEndContext {
	target?: DelegationTarget;
	subAgentId: string;
	conversationId: string;
	parentAgentId: string;
	input: SpawnAgentInput;
	result?: SpawnAgentOutput;
	agentResult?: AgentResult;
	error?: Error;
}

export interface SpawnAgentToolConfig {
	configProvider: DelegatedAgentConfigProvider;
	defaultMaxIterations?: number;
	subAgentTools?: AgentTool[];
	createSubAgentTools?: (
		input: SpawnAgentInput,
		context: AgentToolContext,
		configProvider: DelegatedAgentConfigProvider,
	) => AgentTool[] | Promise<AgentTool[]>;
	onSubAgentEvent?: (event: AgentEvent, target?: DelegationTarget) => void;
	/**
	 * Lifecycle hooks forwarded to spawned sub-agent runs.
	 */
	hooks?: AgentHooks;
	/**
	 * Extension list forwarded to spawned sub-agent runs.
	 */
	extensions?: AgentExtension[];
	/**
	 * Error handling mode for forwarded lifecycle hooks.
	 */
	hookErrorMode?: HookErrorMode;
	/**
	 * Called after a sub-agent instance is created and before it starts running.
	 * Errors are ignored so lifecycle observers cannot break task execution.
	 */
	onSubAgentStart?: (context: SubAgentStartContext) => void | Promise<void>;
	/**
	 * Called once a sub-agent run finishes (success or error).
	 * Errors are ignored so lifecycle observers cannot break task execution.
	 */
	onSubAgentEnd?: (context: SubAgentEndContext) => void | Promise<void>;
	/**
	 * Optional per-tool policy for spawned sub-agents.
	 */
	toolPolicies?: Record<string, ToolPolicy>;
	/**
	 * Optional approval callback for spawned sub-agent tool calls.
	 */
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult> | ToolApprovalResult;
	/**
	 * Optional logger forwarded to spawned sub-agent runs.
	 */
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
}

/**
 * Create a spawn_agent tool that can run a delegated task with a focused sub-agent.
 */
export function createSpawnAgentTool(
	config: SpawnAgentToolConfig,
): AgentTool<SpawnAgentInput, SpawnAgentOutput> {
	return createTool<SpawnAgentInput, SpawnAgentOutput>({
		name: "spawn_agent",
		resultPolicy: "cache-oversized",
		executionMode: "parallel",
		description: `Spawn a sub-agent with custom instructions. Use list_delegation_targets to discover configured models, then pass target to select one. Without target, inherit this agent's connection. Prefer subscription routes for model-only requests; ask the user before paid API fallback unless that provider was explicitly requested. Never silently substitute targets. Waits for the child and returns its findings.`,
		inputSchema: zodToJsonSchema(SpawnAgentInputSchema),
		execute: async (input, context) => {
			input = SpawnAgentInputSchema.parse(input);
			const configProvider = await resolveDelegatedAgentConfig(
				config.configProvider,
				input.target,
				context.signal,
			);
			const { providerId, modelId } = configProvider.getRuntimeConfig();
			const target = { providerId, modelId };
			const tools = config.createSubAgentTools
				? await config.createSubAgentTools(input, context, configProvider)
				: (config.subAgentTools ?? []);

			context.signal?.throwIfAborted();
			const subAgent = createDelegatedAgent({
				kind: "subagent",
				prompt: input.systemPrompt,
				configProvider,
				tools,
				maxIterations: config.defaultMaxIterations,
				parentAgentId: context.agentId,
				abortSignal: context.signal,
				onEvent: (event) => config.onSubAgentEvent?.(event, target),
				hookErrorMode: config.hookErrorMode,
				toolPolicies: config.toolPolicies,
				requestToolApproval: config.requestToolApproval,
			});
			const subAgentId = subAgent.getAgentId();
			const conversationId = subAgent.getConversationId();
			const parentAgentId = context.agentId;
			if (config.onSubAgentStart) {
				try {
					await config.onSubAgentStart({
						subAgentId,
						target,
						conversationId,
						parentAgentId,
						input,
					});
				} catch {
					// Best-effort observer callback.
				}
			}
			try {
				const result = await subAgent.run(input.task);
				const output: SpawnAgentOutput = {
					target,
					text: result.text,
					iterations: result.iterations,
					finishReason: result.finishReason,
					usage: {
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
					},
				};
				if (config.onSubAgentEnd) {
					try {
						await config.onSubAgentEnd({
							subAgentId,
							target,
							conversationId,
							parentAgentId,
							input,
							result: output,
							agentResult: result,
						});
					} catch {
						// Best-effort observer callback.
					}
				}
				return output;
			} catch (error) {
				if (config.onSubAgentEnd) {
					try {
						await config.onSubAgentEnd({
							subAgentId,
							target,
							conversationId,
							parentAgentId,
							input,
							error: error instanceof Error ? error : new Error(String(error)),
						});
					} catch {
						// Best-effort observer callback.
					}
				}
				throw error;
			}
		},
		timeoutMs: 300000,
		retryable: false,
	});
}
