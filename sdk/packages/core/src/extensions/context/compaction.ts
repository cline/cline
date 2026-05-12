import type {
	CoreCompactionConfig,
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionStrategy,
	CoreSessionConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import { runAgenticCompaction } from "./agentic-compaction";
import { runBasicCompaction } from "./basic-compaction";
import {
	createTokenEstimator,
	DEFAULT_MAX_INPUT_TOKENS,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	DEFAULT_RESERVE_TOKENS,
	DEFAULT_THRESHOLD_RATIO,
} from "./compaction-shared";

export interface ContextPipelinePrepareTurnInput {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	messages: CoreCompactionContext["messages"];
	apiMessages: CoreCompactionContext["messages"];
	abortSignal: AbortSignal;
	systemPrompt: string;
	tools: unknown[];
	model: CoreCompactionContext["model"];
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
}

export interface ContextPipelinePrepareTurnResult {
	messages: CoreCompactionContext["messages"];
	systemPrompt?: string;
}

type EstimateMessageTokens = ReturnType<typeof createTokenEstimator>;

type BuiltinCompactionStrategyOptions = {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	compaction: CoreCompactionConfig | undefined;
	mode: ContextCompactionMode;
	estimateMessageTokens: EstimateMessageTokens;
	logger: Pick<CoreSessionConfig, "logger">["logger"];
};

type BuiltinCompactionStrategyRunner = (
	options: BuiltinCompactionStrategyOptions,
) =>
	| Promise<CoreCompactionResult | undefined>
	| CoreCompactionResult
	| undefined;

export type ContextCompactionMode = "auto" | "manual";

export interface ContextCompactionPrepareTurnOptions {
	mode?: ContextCompactionMode;
	manualTargetRatio?: number;
}

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

function summarizeToolResults(messages: CoreCompactionContext["messages"]): {
	toolResultCount: number;
	toolResultSerializedChars: number;
	maxToolResultSerializedChars: number;
} {
	let toolResultCount = 0;
	let toolResultSerializedChars = 0;
	let maxToolResultSerializedChars = 0;
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_result") {
				continue;
			}
			const size = safeJsonSize(block.content);
			toolResultCount += 1;
			toolResultSerializedChars += size;
			maxToolResultSerializedChars = Math.max(
				maxToolResultSerializedChars,
				size,
			);
		}
	}
	return {
		toolResultCount,
		toolResultSerializedChars,
		maxToolResultSerializedChars,
	};
}

const BUILTIN_COMPACTION_STRATEGIES = {
	basic: ({ context, estimateMessageTokens, logger }) =>
		runBasicCompaction({
			context,
			estimateMessageTokens,
			logger,
		}),
	agentic: ({
		context,
		providerConfig,
		compaction,
		mode,
		estimateMessageTokens,
		logger,
	}) =>
		runAgenticCompaction({
			context,
			providerConfig,
			summarizer: compaction?.summarizer,
			preserveRecentTokens:
				mode === "manual"
					? Math.min(
							compaction?.preserveRecentTokens ??
								DEFAULT_PRESERVE_RECENT_TOKENS,
							context.triggerTokens,
						)
					: (compaction?.preserveRecentTokens ??
						DEFAULT_PRESERVE_RECENT_TOKENS),
			estimateMessageTokens,
			logger,
		}),
} satisfies Record<CoreCompactionStrategy, BuiltinCompactionStrategyRunner>;

function resolveTriggerState(input: {
	inputTokens: number;
	maxInputTokens: number;
	config: CoreCompactionConfig;
}): { shouldCompact: boolean; triggerTokens: number; thresholdRatio: number } {
	if (typeof input.config.reserveTokens === "number") {
		const reserveTokens = Math.max(0, input.config.reserveTokens);
		const triggerTokens = Math.max(0, input.maxInputTokens - reserveTokens);
		return {
			shouldCompact: input.inputTokens > triggerTokens,
			triggerTokens,
			thresholdRatio:
				input.maxInputTokens > 0 ? triggerTokens / input.maxInputTokens : 0,
		};
	}

	if (typeof input.config.thresholdRatio !== "number") {
		const triggerTokens = Math.max(
			0,
			Math.min(
				input.maxInputTokens - DEFAULT_RESERVE_TOKENS,
				input.maxInputTokens * DEFAULT_THRESHOLD_RATIO,
			),
		);
		return {
			shouldCompact: input.inputTokens > triggerTokens,
			triggerTokens,
			thresholdRatio:
				input.maxInputTokens > 0 ? triggerTokens / input.maxInputTokens : 0,
		};
	}

	const thresholdRatio = input.config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
	const triggerTokens = input.maxInputTokens * thresholdRatio;
	return {
		shouldCompact: input.inputTokens > triggerTokens,
		triggerTokens,
		thresholdRatio,
	};
}

function resolveManualTargetState(input: {
	inputTokens: number;
	maxInputTokens: number;
	autoTriggerTokens: number;
	manualTargetRatio: number | undefined;
}): { triggerTokens: number; thresholdRatio: number } {
	const ratio =
		typeof input.manualTargetRatio === "number" &&
		Number.isFinite(input.manualTargetRatio)
			? input.manualTargetRatio
			: 0.5;
	const targetRatio = Math.min(0.95, Math.max(0.05, ratio));
	// Keep manual compaction at least as aggressive as the configured auto
	// threshold; very low thresholdRatio values intentionally dominate here.
	const targetTokens = Math.max(
		1,
		Math.floor(
			Math.min(input.autoTriggerTokens, input.inputTokens * targetRatio),
		),
	);
	return {
		triggerTokens: targetTokens,
		thresholdRatio:
			input.maxInputTokens > 0 ? targetTokens / input.maxInputTokens : 0,
	};
}

export function createContextCompactionPrepareTurn(
	config: Pick<
		CoreSessionConfig,
		"providerConfig" | "providerId" | "modelId" | "compaction" | "logger"
	>,
	options: ContextCompactionPrepareTurnOptions = {},
):
	| ((
			context: ContextPipelinePrepareTurnInput,
	  ) => Promise<ContextPipelinePrepareTurnResult | undefined>)
	| undefined {
	const userCompaction = config.compaction;
	if (userCompaction?.enabled !== true) {
		return undefined;
	}

	const providerConfig =
		config.providerConfig ??
		({
			providerId: config.providerId,
			modelId: config.modelId,
		} as ProviderConfig);
	const estimateMessageTokens = createTokenEstimator();
	const strategy = userCompaction?.strategy ?? "basic";
	const runBuiltinStrategy = BUILTIN_COMPACTION_STRATEGIES[strategy];
	const mode = options.mode ?? "auto";

	return async (context) => {
		const inputTokens = context.apiMessages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const maxInputTokens =
			userCompaction?.maxInputTokens ??
			context.model.info?.maxInputTokens ??
			context.model.info?.contextWindow ??
			DEFAULT_MAX_INPUT_TOKENS;
		if (
			typeof maxInputTokens !== "number" ||
			!Number.isFinite(maxInputTokens) ||
			maxInputTokens <= 0
		) {
			return undefined;
		}

		const triggerState = resolveTriggerState({
			inputTokens,
			maxInputTokens,
			config: {
				reserveTokens: userCompaction?.reserveTokens,
				thresholdRatio: userCompaction?.thresholdRatio,
			},
		});
		config.logger?.debug("Context compaction diagnostics", {
			mode,
			strategy,
			iteration: context.iteration,
			providerId: config.providerId,
			modelId: config.modelId,
			inputTokens,
			maxInputTokens,
			triggerTokens: triggerState.triggerTokens,
			thresholdRatio: triggerState.thresholdRatio,
			shouldCompact: triggerState.shouldCompact,
			messageCount: context.messages.length,
			apiMessageCount: context.apiMessages.length,
			apiMessagesJsonChars: safeJsonSize(context.apiMessages),
			...summarizeToolResults(context.apiMessages),
		});
		if (mode === "auto" && !triggerState.shouldCompact) {
			return undefined;
		}
		const targetState =
			mode === "manual"
				? resolveManualTargetState({
						inputTokens,
						maxInputTokens,
						autoTriggerTokens: triggerState.triggerTokens,
						manualTargetRatio: options.manualTargetRatio,
					})
				: triggerState;

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId,
			iteration: context.iteration,
			messages: context.messages,
			model: context.model,
			maxInputTokens,
			triggerTokens: targetState.triggerTokens,
			thresholdRatio: targetState.thresholdRatio,
			utilizationRatio: maxInputTokens > 0 ? inputTokens / maxInputTokens : 0,
		};

		const statusReason =
			mode === "manual" ? "manual_compaction" : "auto_compaction";
		context.emitStatusNotice?.(
			mode === "manual" ? "compacting" : "auto-compacting",
			{
				kind: statusReason,
				reason: statusReason,
				iteration: context.iteration,
				triggerTokens: targetState.triggerTokens,
				maxInputTokens,
			},
		);

		const beforeMessageCount = context.messages.length;

		const result = userCompaction?.compact
			? await userCompaction.compact(compactionContext)
			: await runBuiltinStrategy({
					context: compactionContext,
					providerConfig: {
						...providerConfig,
						abortSignal: context.abortSignal,
					},
					compaction: userCompaction,
					mode,
					estimateMessageTokens,
					logger: config.logger,
				});

		if (result?.messages) {
			const afterTokens = result.messages.reduce(
				(total: number, message) => total + estimateMessageTokens(message),
				0,
			);
			config.logger?.log("Context compaction completed", {
				severity: "info",
				strategy: strategy,
				maxInputTokens,
				inputTokens,
				afterTokens,
				tokensSaved: inputTokens - afterTokens,
				utilizationBefore: `${((inputTokens / maxInputTokens) * 100).toFixed(1)}%`,
				utilizationAfter: `${((afterTokens / maxInputTokens) * 100).toFixed(1)}%`,
				thresholdTrigger: `${(targetState.thresholdRatio * 100).toFixed(1)}%`,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
			} as Record<string, unknown>);
		}

		return result;
	};
}
