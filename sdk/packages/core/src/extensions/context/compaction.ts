import {
	captureCompactionExecuted,
	captureCompactionSkipped,
	type TelemetryCompactionStrategy,
} from "../../services/telemetry/core-events";
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
	DEFAULT_TARGET_RATIO,
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

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function resolveMaxInputTokens(input: {
	configMaxInputTokens?: number;
	modelMaxInputTokens?: number;
	contextWindow?: number;
	modelMaxTokens?: number;
}): number {
	const candidates: number[] = [];
	if (isPositiveFiniteNumber(input.configMaxInputTokens)) {
		candidates.push(input.configMaxInputTokens);
	}
	if (isPositiveFiniteNumber(input.modelMaxInputTokens)) {
		candidates.push(input.modelMaxInputTokens);
	}
	if (isPositiveFiniteNumber(input.contextWindow)) {
		candidates.push(input.contextWindow);
		if (
			isPositiveFiniteNumber(input.modelMaxTokens) &&
			input.modelMaxTokens < input.contextWindow
		) {
			const derivedInputTokens = input.contextWindow - input.modelMaxTokens;
			if (derivedInputTokens > DEFAULT_RESERVE_TOKENS) {
				candidates.push(derivedInputTokens);
			}
		}
	}
	return candidates.length > 0
		? Math.min(...candidates)
		: DEFAULT_MAX_INPUT_TOKENS;
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
							context.targetTokens ?? context.triggerTokens,
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

	if (typeof input.config.thresholdRatio === "number") {
		const thresholdRatio = input.config.thresholdRatio;
		const triggerTokens = input.maxInputTokens * thresholdRatio;
		return {
			shouldCompact: input.inputTokens > triggerTokens,
			triggerTokens,
			thresholdRatio,
		};
	}

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

function resolveManualTargetState(input: {
	inputTokens: number;
	autoTriggerTokens: number;
	manualTargetRatio: number | undefined;
}): { targetTokens: number } {
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
		targetTokens,
	};
}

function resolveBasicTargetTokens(input: {
	maxInputTokens: number;
	modelMaxTokens?: number;
	triggerTokens: number;
}): number {
	const targetBaseTokens =
		typeof input.modelMaxTokens === "number" &&
		Number.isFinite(input.modelMaxTokens) &&
		input.modelMaxTokens < input.maxInputTokens
			? input.maxInputTokens - input.modelMaxTokens
			: input.triggerTokens;
	return Math.max(
		1,
		Math.min(
			Math.floor(targetBaseTokens * DEFAULT_TARGET_RATIO),
			input.maxInputTokens,
		),
	);
}

/**
 * Build the `prepareTurn` callback used by the agent runtime to compact the
 * transcript before each model request.
 *
 * Telemetry: emits `task.compaction_executed` on a successful compaction and
 * `task.compaction_skipped` when the configured strategy returns `undefined`.
 * Telemetry is keyed by `config.sessionId` (falling back to the per-turn
 * `conversationId`) and tagged with `provider` / `modelId`.
 *
 * Known gap: compactions performed via plugin `registerMessageBuilder()` or
 * via the `beforeModel` runtime hook bypass this wrapper entirely, so they
 * do not emit compaction telemetry. If we want coverage there too, the
 * plugin/hook pipelines must be instrumented separately.
 */
export function createContextCompactionPrepareTurn(
	config: Pick<
		CoreSessionConfig,
		| "providerConfig"
		| "providerId"
		| "modelId"
		| "compaction"
		| "logger"
		| "telemetry"
		| "sessionId"
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
	const telemetryStrategy: TelemetryCompactionStrategy = userCompaction?.compact
		? "custom"
		: strategy;

	return async (context) => {
		const inputTokens = context.apiMessages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const maxInputTokens = resolveMaxInputTokens({
			configMaxInputTokens: userCompaction?.maxInputTokens,
			modelMaxInputTokens: context.model.info?.maxInputTokens,
			contextWindow: context.model.info?.contextWindow,
			modelMaxTokens: context.model.info?.maxTokens,
		});

		const triggerState = resolveTriggerState({
			inputTokens,
			maxInputTokens,
			config: {
				maxInputTokens: userCompaction?.maxInputTokens,
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
		const targetTokens =
			mode === "manual"
				? resolveManualTargetState({
						inputTokens,
						autoTriggerTokens: triggerState.triggerTokens,
						manualTargetRatio: options.manualTargetRatio,
					}).targetTokens
				: resolveBasicTargetTokens({
						maxInputTokens,
						modelMaxTokens: context.model.info?.maxTokens,
						triggerTokens: triggerState.triggerTokens,
					});

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId,
			iteration: context.iteration,
			messages: context.messages,
			model: context.model,
			maxInputTokens,
			triggerTokens: triggerState.triggerTokens,
			targetTokens,
			thresholdRatio: triggerState.thresholdRatio,
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
				triggerTokens: triggerState.triggerTokens,
				targetTokens,
				maxInputTokens,
			},
		);

		const beforeMessageCount = context.messages.length;
		const startedAt = Date.now();

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

		const durationMs = Date.now() - startedAt;
		// Telemetry identity: surface the agent/conversation passed into the
		// prepareTurn so multi-agent runs can attribute compactions correctly.
		// `sessionId` is the host-owned session id (ulid). We fall back to the
		// conversation id when no sessionId is supplied (e.g. ad-hoc callers).
		const telemetryUlid = config.sessionId ?? context.conversationId;
		const telemetryIdentity = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId ?? undefined,
		};

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
				thresholdTrigger: `${(triggerState.thresholdRatio * 100).toFixed(1)}%`,
				targetTrigger: `${((targetTokens / maxInputTokens) * 100).toFixed(1)}%`,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
			} as Record<string, unknown>);
			captureCompactionExecuted(config.telemetry, {
				ulid: telemetryUlid,
				strategy: telemetryStrategy,
				mode,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
				tokensBefore: inputTokens,
				tokensAfter: afterTokens,
				tokensSaved: inputTokens - afterTokens,
				triggerTokens: triggerState.triggerTokens,
				maxInputTokens,
				thresholdRatio: triggerState.thresholdRatio,
				durationMs,
				// Matches the field name used by other TASK telemetry helpers
				// (e.g. captureTaskCompleted, captureToolUsage).
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
		} else {
			captureCompactionSkipped(config.telemetry, {
				ulid: telemetryUlid,
				strategy: telemetryStrategy,
				mode,
				reason: "no_result",
				tokensBefore: inputTokens,
				triggerTokens: triggerState.triggerTokens,
				maxInputTokens,
				thresholdRatio: triggerState.thresholdRatio,
				durationMs,
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
		}

		return result;
	};
}
