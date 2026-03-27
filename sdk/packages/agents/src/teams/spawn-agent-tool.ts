/**
 * Reusable spawn_agent tool for delegating tasks to sub-agents.
 */

import { basename, resolve } from "node:path";
import type * as LlmsProviders from "@clinebot/llms/providers";
import {
	type ITelemetryService,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolContext,
	type ToolPolicy,
	zodToJsonSchema,
} from "@clinebot/shared";
import { z } from "zod";
import { Agent } from "../agent.js";
import { createTool } from "../tools/create.js";
import type {
	AgentEvent,
	AgentExtension,
	AgentFinishReason,
	AgentHooks,
	BasicLogger,
	HookErrorMode,
} from "../types.js";

export const SpawnAgentInputSchema = z.object({
	systemPrompt: z
		.string()
		.describe("System prompt defining the sub-agent's behavior"),
	task: z.string().describe("Task for the sub-agent to complete"),
	maxIterations: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Max iterations for the sub-agent"),
});

export type SpawnAgentInput = z.infer<typeof SpawnAgentInputSchema>;

export interface SpawnAgentOutput {
	text: string;
	iterations: number;
	finishReason: AgentFinishReason;
	usage: {
		inputTokens: number;
		outputTokens: number;
	};
}

export interface SubAgentStartContext {
	subAgentId: string;
	conversationId: string;
	parentAgentId: string;
	input: SpawnAgentInput;
}

export interface SubAgentEndContext {
	subAgentId: string;
	conversationId: string;
	parentAgentId: string;
	input: SpawnAgentInput;
	result?: SpawnAgentOutput;
	error?: Error;
}

export interface SpawnAgentToolConfig {
	providerId: string;
	modelId: string;
	cwd?: string;
	apiKey?: string;
	baseUrl?: string;
	providerConfig?: LlmsProviders.ProviderConfig;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	thinking?: boolean;
	clineWorkspaceMetadata?: string;
	defaultMaxIterations?: number;
	subAgentTools?: Tool[];
	createSubAgentTools?: (
		input: SpawnAgentInput,
		context: ToolContext,
	) => Tool[] | Promise<Tool[]>;
	onSubAgentEvent?: (event: AgentEvent) => void;
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

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

function buildFallbackWorkspaceMetadata(cwd: string): string {
	const rootPath = resolve(cwd);
	return `# Workspace Configuration\n${JSON.stringify(
		{
			workspaces: {
				[rootPath]: {
					hint: basename(rootPath),
				},
			},
		},
		null,
		2,
	)}`;
}

function normalizeSubAgentSystemPrompt(
	inputSystemPrompt: string,
	config: SpawnAgentToolConfig,
): string {
	if (config.providerId !== "cline") {
		return inputSystemPrompt;
	}
	const trimmedPrompt = inputSystemPrompt.trim();
	if (trimmedPrompt.includes(WORKSPACE_CONFIGURATION_MARKER)) {
		return trimmedPrompt;
	}
	const cwd = config.cwd?.trim() || process.cwd();
	const workspaceMetadata =
		config.clineWorkspaceMetadata?.trim() ||
		buildFallbackWorkspaceMetadata(cwd);
	if (!workspaceMetadata) {
		return trimmedPrompt;
	}
	return `${trimmedPrompt}\n\n${workspaceMetadata}`;
}

/**
 * Create a spawn_agent tool that can run a delegated task with a focused sub-agent.
 */
export function createSpawnAgentTool(
	config: SpawnAgentToolConfig,
): Tool<SpawnAgentInput, SpawnAgentOutput> {
	return createTool<SpawnAgentInput, SpawnAgentOutput>({
		name: "spawn_agent",
		description: `Spawn a sub-agent with a custom system prompt for specialized tasks. Use when delegating work that benefits from focused expertise.`,
		inputSchema: zodToJsonSchema(SpawnAgentInputSchema),
		execute: async (input, context) => {
			const tools = config.createSubAgentTools
				? await config.createSubAgentTools(input, context)
				: (config.subAgentTools ?? []);

			const subAgent = new Agent({
				providerId: config.providerId,
				modelId: config.modelId,
				apiKey: config.apiKey,
				baseUrl: config.baseUrl,
				providerConfig: config.providerConfig,
				knownModels: config.knownModels,
				thinking: config.thinking,
				systemPrompt: normalizeSubAgentSystemPrompt(input.systemPrompt, config),
				tools,
				maxIterations: input.maxIterations ?? config.defaultMaxIterations,
				parentAgentId: context.agentId,
				abortSignal: context.abortSignal,
				onEvent: config.onSubAgentEvent,
				hooks: config.hooks,
				extensions: config.extensions,
				hookErrorMode: config.hookErrorMode,
				toolPolicies: config.toolPolicies,
				requestToolApproval: config.requestToolApproval,
				logger: config.logger,
			});
			const subAgentId = subAgent.getAgentId();
			const conversationId = subAgent.getConversationId();
			const parentAgentId = context.agentId;
			if (config.onSubAgentStart) {
				try {
					await config.onSubAgentStart({
						subAgentId,
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
							conversationId,
							parentAgentId,
							input,
							result: output,
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
