import {
	captureCompactionExecuted,
	captureCompactionSkipped,
	type TelemetryCompactionStrategy,
} from "../../services/telemetry/core-events";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
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

export type ContextPipelinePrepareTurn = (
	context: ContextPipelinePrepareTurnInput,
) => Promise<ContextPipelinePrepareTurnResult | undefined>;

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

const MIN_CONTEXT_DERIVED_INPUT_RATIO = 0.5;
const LONG_CONVERSATION_TARGET_RATIO = 0.5;

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
		const derivedInputTokens = isPositiveFiniteNumber(input.modelMaxTokens)
			? input.contextWindow - input.modelMaxTokens
			: undefined;
		if (
			isPositiveFiniteNumber(derivedInputTokens) &&
			derivedInputTokens >=
				input.contextWindow * MIN_CONTEXT_DERIVED_INPUT_RATIO
		) {
			candidates.push(derivedInputTokens);
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

function resolveBasicTargetTokens(input: {
	maxInputTokens: number;
	modelMaxTokens?: number;
	triggerTokens: number;
	messagePairCount: number;
}): number {
	const targetTokens =
		input.messagePairCount >= 5 &&
		typeof input.modelMaxTokens === "number" &&
		Number.isFinite(input.modelMaxTokens) &&
		input.modelMaxTokens < input.maxInputTokens
			? Math.floor(input.maxInputTokens * LONG_CONVERSATION_TARGET_RATIO)
			: Math.floor(input.triggerTokens * DEFAULT_TARGET_RATIO);
	const triggerCeiling = Math.max(1, input.triggerTokens - 1);
	return Math.max(
		1,
		Math.min(targetTokens, input.maxInputTokens, triggerCeiling),
	);
}

function countUserAssistantPairs(
	messages: CoreCompactionContext["messages"],
): number {
	let pairs = 0;
	let hasPendingUser = false;
	for (const message of messages) {
		if (message.role === "user") {
			hasPendingUser = true;
		} else if (message.role === "assistant" && hasPendingUser) {
			pairs += 1;
			hasPendingUser = false;
		}
	}
	return pairs;
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
		const targetState =
			mode === "manual"
				? resolveManualTargetState({
						inputTokens,
						maxInputTokens,
						autoTriggerTokens: triggerState.triggerTokens,
						manualTargetRatio: options.manualTargetRatio,
					})
				: triggerState;
		const targetTokens =
			mode === "auto"
				? resolveBasicTargetTokens({
						maxInputTokens,
						modelMaxTokens: context.model.info?.maxTokens,
						triggerTokens: targetState.triggerTokens,
						messagePairCount: countUserAssistantPairs(context.messages),
					})
				: undefined;

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId,
			iteration: context.iteration,
			messages: context.messages,
			model: context.model,
			maxInputTokens,
			triggerTokens: targetState.triggerTokens,
			targetTokens,
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
				phase: "started",
				iteration: context.iteration,
				triggerTokens: targetState.triggerTokens,
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
				thresholdTrigger: `${(targetState.thresholdRatio * 100).toFixed(1)}%`,
				messagesBefore: beforeMessageCount,
				messagesAfter: result.messages.length,
				messagesRemoved: beforeMessageCount - result.messages.length,
			} as Record<string, unknown>);
			context.emitStatusNotice?.(
				mode === "manual" ? "compacted" : "auto-compacted",
				{
					kind: statusReason,
					reason: statusReason,
					phase: "completed",
					iteration: context.iteration,
					tokensBefore: inputTokens,
					tokensAfter: afterTokens,
					messagesBefore: beforeMessageCount,
					messagesAfter: result.messages.length,
					maxInputTokens,
				},
			);
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
				triggerTokens: targetState.triggerTokens,
				maxInputTokens,
				thresholdRatio: targetState.thresholdRatio,
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
				triggerTokens: targetState.triggerTokens,
				maxInputTokens,
				thresholdRatio: targetState.thresholdRatio,
				durationMs,
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
		}

		return result;
	};
}

export function createCompactionStateAwarePrepareTurn(input: {
	compact?: ContextPipelinePrepareTurn;
	getState?: () => SessionCompactionState | undefined;
	saveState?: (state: SessionCompactionState) => void | Promise<void>;
}): ContextPipelinePrepareTurn {
	return async (context) => {
		const existingState = input.getState?.();
		const projectedMessages = existingState
			? projectSessionCompactionState(existingState, context.messages)
			: undefined;
		if (existingState && projectedMessages) {
			// Re-compaction intentionally starts from the compacted projection plus
			// canonical tail. This keeps automatic turns bounded without rebuilding a
			// full-transcript summary every turn; manual `/compact` is the path for a
			// fresh summary from canonical history.
			const result = input.compact
				? await input.compact({
						...context,
						messages: projectedMessages,
						apiMessages: projectedMessages,
					})
				: undefined;
			if (result?.messages) {
				const systemPrompt = result.systemPrompt ?? existingState.system_prompt;
				const nextState = createSessionCompactionState({
					sourceMessages: context.messages,
					compactedMessages: result.messages,
					conversationId: context.conversationId,
					systemPrompt,
				});
				await input.saveState?.(nextState);
				return {
					...result,
					...(systemPrompt !== undefined ? { systemPrompt } : {}),
				};
			}
			return {
				messages: projectedMessages,
				...(result?.systemPrompt !== undefined
					? { systemPrompt: result.systemPrompt }
					: existingState.system_prompt !== undefined
						? { systemPrompt: existingState.system_prompt }
						: {}),
			};
		}
		const result = input.compact ? await input.compact(context) : undefined;
		if (result?.messages) {
			const nextState = createSessionCompactionState({
				sourceMessages: context.messages,
				compactedMessages: result.messages,
				conversationId: context.conversationId,
				systemPrompt: result.systemPrompt,
			});
			await input.saveState?.(nextState);
		}
		return result;
	};
}
