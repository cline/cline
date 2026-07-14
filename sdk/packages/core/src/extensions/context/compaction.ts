import { estimateRequestInputTokens } from "@cline/shared";
import {
	captureCompactionBudgetEmergency,
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
	CoreCompactionMode,
	CoreCompactionResult,
	CoreCompactionStrategy,
	CoreSessionConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import { runAgenticCompaction } from "./agentic-compaction";
import { runBasicCompaction } from "./basic-compaction";
import {
	COMPACTION_TRIGGER_RATIO,
	createTokenEstimator,
	DEFAULT_MAX_INPUT_TOKENS,
	DEFAULT_PRESERVE_RECENT_TOKENS,
	DEFAULT_TARGET_RATIO,
	resolveEffectiveMaxInputTokens,
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
	estimateMessageTokens: EstimateMessageTokens;
	logger: Pick<CoreSessionConfig, "logger">["logger"];
};

type BuiltinCompactionStrategyRunner = (
	options: BuiltinCompactionStrategyOptions,
) =>
	| Promise<CoreCompactionResult | undefined>
	| CoreCompactionResult
	| undefined;

export interface ContextCompactionPrepareTurnOptions {
	mode?: CoreCompactionMode;
	manualTargetRatio?: number;
}

const LONG_CONVERSATION_TARGET_RATIO = 0.5;

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
		estimateMessageTokens,
		logger,
	}) =>
		runAgenticCompaction({
			context,
			providerConfig,
			summarizer: compaction?.summarizer,
			preserveRecentTokens: Math.min(
				compaction?.preserveRecentTokens ?? DEFAULT_PRESERVE_RECENT_TOKENS,
				context.budget.messages.targetTokens,
			),
			estimateMessageTokens,
			logger,
		}),
} satisfies Record<CoreCompactionStrategy, BuiltinCompactionStrategyRunner>;

function resolveManualMessageTargetTokens(input: {
	messageInputTokens: number;
	messageTriggerTokens: number;
	manualTargetRatio: number | undefined;
}): number {
	const ratio =
		typeof input.manualTargetRatio === "number" &&
		Number.isFinite(input.manualTargetRatio)
			? input.manualTargetRatio
			: 0.5;
	const targetRatio = Math.min(0.95, Math.max(0.05, ratio));
	return Math.max(
		1,
		Math.floor(
			Math.min(
				input.messageTriggerTokens,
				input.messageInputTokens * targetRatio,
			),
		),
	);
}

function resolveAutoRequestTargetTokens(input: {
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

function translateRequestBudgetToMessages(
	requestTokens: number,
	overheadTokens: number,
): number {
	return Math.max(1, Math.floor(requestTokens - overheadTokens));
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
		const apiMessageTokens = context.apiMessages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const requestInputTokens = estimateRequestInputTokens({
			systemPrompt: context.systemPrompt,
			messages: context.apiMessages,
			tools: context.tools,
		});
		const messageInputTokens = context.messages.reduce(
			(total: number, message) => total + estimateMessageTokens(message),
			0,
		);
		const requestOverheadTokens = Math.max(
			0,
			requestInputTokens - apiMessageTokens,
		);
		const maxInputTokens =
			resolveEffectiveMaxInputTokens({
				maxInputTokens: context.model.info?.maxInputTokens,
				contextWindow: context.model.info?.contextWindow,
			}) ?? DEFAULT_MAX_INPUT_TOKENS;
		const requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO;
		const messageTriggerTokens = translateRequestBudgetToMessages(
			requestTriggerTokens,
			requestOverheadTokens,
		);
		const shouldCompact = requestInputTokens >= requestTriggerTokens;
		config.logger?.debug("Context compaction diagnostics", {
			mode,
			strategy,
			iteration: context.iteration,
			providerId: config.providerId,
			modelId: config.modelId,
			requestInputTokens,
			apiMessageTokens,
			messageInputTokens,
			requestOverheadTokens,
			maxInputTokens,
			requestTriggerTokens,
			messageTriggerTokens,
			thresholdRatio: COMPACTION_TRIGGER_RATIO,
			shouldCompact,
			messageCount: context.messages.length,
			apiMessageCount: context.apiMessages.length,
			apiMessagesJsonChars: safeJsonSize(context.apiMessages),
			...summarizeToolResults(context.apiMessages),
		});
		if (mode === "auto" && !shouldCompact) {
			return undefined;
		}
		let requestTargetTokens: number;
		let messageTargetTokens: number;
		if (mode === "auto") {
			requestTargetTokens = resolveAutoRequestTargetTokens({
				maxInputTokens,
				modelMaxTokens: context.model.info?.maxTokens,
				triggerTokens: requestTriggerTokens,
				messagePairCount: countUserAssistantPairs(context.messages),
			});
			messageTargetTokens = translateRequestBudgetToMessages(
				requestTargetTokens,
				requestOverheadTokens,
			);
		} else {
			messageTargetTokens = resolveManualMessageTargetTokens({
				messageInputTokens,
				messageTriggerTokens,
				manualTargetRatio: options.manualTargetRatio,
			});
			requestTargetTokens = requestOverheadTokens + messageTargetTokens;
		}

		const compactionContext = {
			agentId: context.agentId,
			conversationId: context.conversationId,
			parentAgentId: context.parentAgentId,
			iteration: context.iteration,
			messages: context.messages,
			model: context.model,
			mode,
			budget: {
				request: {
					inputTokens: requestInputTokens,
					maxInputTokens,
					triggerTokens: requestTriggerTokens,
					targetTokens: requestTargetTokens,
					overheadTokens: requestOverheadTokens,
					thresholdRatio: COMPACTION_TRIGGER_RATIO,
					utilizationRatio:
						maxInputTokens > 0 ? requestInputTokens / maxInputTokens : 0,
				},
				messages: {
					inputTokens: messageInputTokens,
					triggerTokens: messageTriggerTokens,
					targetTokens: messageTargetTokens,
				},
			},
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
				triggerTokens: requestTriggerTokens,
				targetTokens: requestTargetTokens,
				maxInputTokens,
				messageTargetTokens,
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
			const afterMessageTokens = result.messages.reduce(
				(total: number, message) => total + estimateMessageTokens(message),
				0,
			);
			const afterRequestTokens = requestOverheadTokens + afterMessageTokens;
			config.logger?.log("Context compaction completed", {
				severity: "info",
				strategy: strategy,
				maxInputTokens,
				messageInputTokens,
				apiInputTokens: apiMessageTokens,
				requestInputTokens,
				requestOverheadTokens,
				afterMessageTokens,
				afterRequestTokens,
				tokensSaved: requestInputTokens - afterRequestTokens,
				utilizationBefore: `${((requestInputTokens / maxInputTokens) * 100).toFixed(1)}%`,
				utilizationAfter: `${((afterRequestTokens / maxInputTokens) * 100).toFixed(1)}%`,
				thresholdTrigger: `${(COMPACTION_TRIGGER_RATIO * 100).toFixed(1)}%`,
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
				tokensBefore: requestInputTokens,
				tokensAfter: afterRequestTokens,
				tokensSaved: requestInputTokens - afterRequestTokens,
				triggerTokens: requestTriggerTokens,
				maxInputTokens,
				thresholdRatio: COMPACTION_TRIGGER_RATIO,
				durationMs,
				// Matches the field name used by other TASK telemetry helpers
				// (e.g. captureTaskCompleted, captureToolUsage).
				provider: config.providerId,
				modelId: config.modelId,
				...telemetryIdentity,
			});
			if (
				result.budget &&
				(result.budget.actionCount > 0 || result.budget.warningCount > 0)
			) {
				captureCompactionBudgetEmergency(config.telemetry, {
					ulid: telemetryUlid,
					strategy: telemetryStrategy,
					mode,
					policyIntent: result.budget.policyIntent,
					actionCount: result.budget.actionCount,
					warningCount: result.budget.warningCount,
					liveTailHandling: result.budget.liveTailHandling,
					provider: config.providerId,
					modelId: config.modelId,
					...telemetryIdentity,
				});
				context.emitStatusNotice?.("compaction-budget-adjusted", {
					kind: "compaction_budget_emergency",
					reason: "compaction_budget_emergency",
					iteration: context.iteration,
					policyIntent: result.budget.policyIntent,
					actionCount: result.budget.actionCount,
					warningCount: result.budget.warningCount,
				});
			}
		} else {
			captureCompactionSkipped(config.telemetry, {
				ulid: telemetryUlid,
				strategy: telemetryStrategy,
				mode,
				reason: "no_result",
				tokensBefore: requestInputTokens,
				triggerTokens: requestTriggerTokens,
				maxInputTokens,
				thresholdRatio: COMPACTION_TRIGGER_RATIO,
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
