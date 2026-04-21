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
	DEFAULT_CONTEXT_WINDOW_TOKENS,
	DEFAULT_PRESERVE_RECENT_TOKENS,
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
	estimateMessageTokens: EstimateMessageTokens;
	logger: Pick<CoreSessionConfig, "logger">["logger"];
};

type BuiltinCompactionStrategyRunner = (
	options: BuiltinCompactionStrategyOptions,
) =>
	| Promise<CoreCompactionResult | undefined>
	| CoreCompactionResult
	| undefined;

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
		estimateMessageTokens,
		logger,
	}) =>
		runAgenticCompaction({
			context,
			providerConfig,
			summarizer: compaction?.summarizer,
			preserveRecentTokens:
				compaction?.preserveRecentTokens ?? DEFAULT_PRESERVE_RECENT_TOKENS,
			estimateMessageTokens,
			logger,
		}),
} satisfies Record<CoreCompactionStrategy, BuiltinCompactionStrategyRunner>;

function resolveTriggerState(input: {
	inputTokens: number;
	contextWindowTokens: number;
	config: CoreCompactionConfig;
}): { shouldCompact: boolean; triggerTokens: number; thresholdRatio: number } {
	if (typeof input.config.reserveTokens === "number") {
		const reserveTokens = Math.max(0, input.config.reserveTokens);
		const triggerTokens = Math.max(
			0,
			input.contextWindowTokens - reserveTokens,
		);
		return {
			shouldCompact: input.inputTokens > triggerTokens,
			triggerTokens,
			thresholdRatio:
				input.contextWindowTokens > 0
					? triggerTokens / input.contextWindowTokens
					: 0,
		};
	}

	const thresholdRatio = input.config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
	const triggerTokens = input.contextWindowTokens * thresholdRatio;
	return {
		shouldCompact: input.inputTokens > triggerTokens,
		triggerTokens,
		thresholdRatio,
	};
}

export function createContextCompactionPrepareTurn(
	config: Pick<
		CoreSessionConfig,
		"providerConfig" | "providerId" | "modelId" | "compaction" | "logger"
	>,
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

	return async (context) => {
		const inputTokens = context.apiMessages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const contextWindowTokens =
			userCompaction?.contextWindowTokens ??
			context.model.info?.contextWindow ??
			DEFAULT_CONTEXT_WINDOW_TOKENS;
		if (
			typeof contextWindowTokens !== "number" ||
			!Number.isFinite(contextWindowTokens) ||
			contextWindowTokens <= 0
		) {
			return undefined;
		}

		const triggerState = resolveTriggerState({
			inputTokens,
			contextWindowTokens,
			config: {
				reserveTokens: userCompaction?.reserveTokens,
				thresholdRatio: userCompaction?.thresholdRatio,
			},
		});
		if (!triggerState.shouldCompact) {
			return undefined;
		}

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId,
			iteration: context.iteration,
			messages: context.messages,
			model: context.model,
			contextWindowTokens,
			triggerTokens: triggerState.triggerTokens,
			thresholdRatio: triggerState.thresholdRatio,
			utilizationRatio:
				contextWindowTokens > 0 ? inputTokens / contextWindowTokens : 0,
		};

		context.emitStatusNotice?.("auto-compacting", {
			kind: "auto_compaction",
			reason: "auto_compaction",
			iteration: context.iteration,
			triggerTokens: triggerState.triggerTokens,
			contextWindowTokens,
		});

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
				contextWindowTokens,
				inputTokens,
				afterTokens,
				tokensSaved: inputTokens - afterTokens,
				utilizationBefore: `${((inputTokens / contextWindowTokens) * 100).toFixed(1)}%`,
				utilizationAfter: `${((afterTokens / contextWindowTokens) * 100).toFixed(1)}%`,
				thresholdTrigger: `${(triggerState.thresholdRatio * 100).toFixed(1)}%`,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
			} as Record<string, unknown>);
		}

		return result;
	};
}
