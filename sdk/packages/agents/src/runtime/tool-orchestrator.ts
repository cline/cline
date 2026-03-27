import type * as LlmsProviders from "@clinebot/llms/providers";
import {
	executeToolsInParallel,
	formatStructuredToolResult,
} from "../tools/index.js";
import type {
	AgentEvent,
	AgentHookControl,
	PendingToolCall,
	Tool,
	ToolCallRecord,
	ToolContext,
} from "../types.js";

export interface ToolOrchestratorOptions {
	getAgentId: () => string;
	getConversationId: () => string;
	getParentAgentId: () => string | null;
	emit: (event: AgentEvent) => void;
	dispatchLifecycle: (input: {
		source: string;
		iteration: number;
		stage: "tool_call_before" | "tool_call_after";
		payload: Record<string, unknown>;
	}) => Promise<AgentHookControl | undefined>;
	authorizeToolCall: (
		call: PendingToolCall,
		context: ToolContext,
	) => Promise<{ allowed: true } | { allowed: false; reason: string }>;
	onCancelRequested?: () => void;
	onLog?: (
		level: "debug" | "warn",
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}

export class ToolOrchestrator {
	private readonly options: ToolOrchestratorOptions;

	constructor(options: ToolOrchestratorOptions) {
		this.options = options;
	}

	async execute(
		toolRegistry: Map<string, Tool>,
		calls: PendingToolCall[],
		context: ToolContext,
		metadata: {
			iteration: number;
			runId: string;
		},
		executionOptions?: {
			maxConcurrency?: number;
		},
	): Promise<{ results: ToolCallRecord[]; cancelRequested: boolean }> {
		let cancelRequested = false;
		const results = await executeToolsInParallel(
			toolRegistry,
			calls,
			context,
			{
				onToolCallStart: async (call) => {
					this.options.onLog?.("debug", "Tool call started", {
						agentId: this.options.getAgentId(),
						conversationId: this.options.getConversationId(),
						runId: metadata.runId,
						iteration: metadata.iteration,
						toolCallId: call.id,
						toolName: call.name,
					});
					this.options.emit({
						type: "content_start",
						contentType: "tool",
						toolName: call.name,
						toolCallId: call.id,
						input: call.input,
					});
					const mergedControl = await this.options.dispatchLifecycle({
						source: "hook.tool_call_before",
						iteration: metadata.iteration,
						stage: "tool_call_before",
						payload: {
							agentId: this.options.getAgentId(),
							conversationId: this.options.getConversationId(),
							parentAgentId: this.options.getParentAgentId(),
							iteration: metadata.iteration,
							call,
						},
					});
					if (mergedControl?.overrideInput !== undefined) {
						call.input = mergedControl.overrideInput;
					}
					if (mergedControl?.review) {
						call.review = true;
					}
					if (mergedControl?.cancel) {
						cancelRequested = true;
						this.options.onCancelRequested?.();
					}
				},
				onToolCallEnd: async (record) => {
					this.options.onLog?.("debug", "Tool call finished", {
						agentId: this.options.getAgentId(),
						conversationId: this.options.getConversationId(),
						runId: metadata.runId,
						iteration: metadata.iteration,
						toolCallId: record.id,
						toolName: record.name,
						durationMs: record.durationMs,
						error: record.error,
					});
					this.options.emit({
						type: "content_end",
						contentType: "tool",
						toolName: record.name,
						toolCallId: record.id,
						output: record.output,
						error: record.error,
						durationMs: record.durationMs,
					});
					const mergedControl = await this.options.dispatchLifecycle({
						source: "hook.tool_call_after",
						iteration: metadata.iteration,
						stage: "tool_call_after",
						payload: {
							agentId: this.options.getAgentId(),
							conversationId: this.options.getConversationId(),
							parentAgentId: this.options.getParentAgentId(),
							iteration: metadata.iteration,
							record,
						},
					});
					if (mergedControl?.cancel) {
						cancelRequested = true;
					}
				},
			},
			{
				authorize: async (call, toolContext) =>
					this.options.authorizeToolCall(call, toolContext),
			},
			executionOptions,
		);

		return { results, cancelRequested };
	}

	buildToolResultMessage(
		results: ToolCallRecord[],
		iteration: number,
		reminder: {
			afterIterations: number;
			text: string;
		},
	): LlmsProviders.Message {
		const content: LlmsProviders.ContentBlock[] = [];

		for (const result of results) {
			content.push({
				type: "tool_result" as const,
				tool_use_id: result.id,
				content: formatStructuredToolResult(result),
				is_error: !!result.error,
			});
		}

		if (shouldInjectReminder(iteration, reminder.afterIterations)) {
			content.push({
				type: "text" as const,
				text: reminder.text,
			});
		}

		return {
			role: "user",
			content,
		};
	}
}

function shouldInjectReminder(
	iteration: number,
	afterIterations: number,
): boolean {
	return (
		afterIterations > 0 &&
		iteration > afterIterations &&
		(iteration - 1) % afterIterations === 0
	);
}
