import { createHandlerAsync } from "@cline/llms";
import type { BasicLogger } from "@cline/shared";
import { countUserRunMessages } from "../../session/user-run-messages";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
	CoreCompactionSummarizerConfig,
} from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import {
	type BudgetProjectionResult,
	buildBudgetProjection,
} from "./budget-projection";
import {
	buildSummaryMessage,
	buildSummaryRequest,
	type EstimateMessageTokens,
	ensureFilesSection,
	estimateTokens,
	extractFileOps,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	resolveEffectiveMaxInputTokens,
	resolveSummarizerConfig,
	serializeConversation,
} from "./compaction-shared";

const MIN_AGENTIC_SUMMARY_INPUT_TOKENS = 1_024;

// Fraction of the available summary-input budget used for the single retry after
// the provider reports the summary was cut off.
const TRUNCATED_SUMMARY_RETRY_INPUT_RATIO = 0.5;

function logTruncatedSummary(options: {
	attempt: 1 | 2;
	reason: string;
	reasoningChars: number;
	summaryChars: number;
	messagesFolded: number;
	targetTokens: number;
	summarizerProviderConfig: ProviderConfig;
	logger?: BasicLogger;
}): void {
	options.logger?.log(
		`Agentic compaction summarizer returned an incomplete summary (attempt ${options.attempt})`,
		{
			severity: "warn",
			incompleteReason: options.reason,
			summaryChars: options.summaryChars,
			reasoningChars: options.reasoningChars,
			messagesFolded: options.messagesFolded,
			summaryInputTargetTokens: options.targetTokens,
			summarizerProviderId: options.summarizerProviderConfig.providerId,
			summarizerModelId: options.summarizerProviderConfig.modelId,
			summarizerMaxOutputTokens:
				options.summarizerProviderConfig.maxOutputTokens,
			likelyCause:
				options.reasoningChars > 0
					? "output_budget_consumed_by_reasoning"
					: "output_budget_exhausted",
		},
	);
}

function resolveProviderMaxInputTokens(
	providerConfig: ProviderConfig,
): number | undefined {
	const modelInfoLimit = resolveEffectiveMaxInputTokens({
		maxInputTokens:
			providerConfig.maxInputTokens ?? providerConfig.modelInfo?.maxInputTokens,
		contextWindow: providerConfig.modelInfo?.contextWindow,
	});
	if (modelInfoLimit !== undefined) {
		return modelInfoLimit;
	}
	const knownModelInfo = providerConfig.knownModels?.[providerConfig.modelId];
	return resolveEffectiveMaxInputTokens({
		maxInputTokens: knownModelInfo?.maxInputTokens,
		contextWindow: knownModelInfo?.contextWindow,
	});
}

export function buildAgenticSummaryInputBudget(options: {
	messages: CoreCompactionContext["messages"];
	targetTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
}): BudgetProjectionResult {
	return buildBudgetProjection({
		messages: options.messages,
		targetTokens: Math.max(1, options.targetTokens),
		policyIntent: "agentic_summary",
		estimateMessageTokens: options.estimateMessageTokens,
	});
}

interface SummaryGenerationResult {
	text: string;
	/** Reasoning/thinking output length; discarded from the summary itself. */
	reasoningChars: number;
	/** Provider-reported reason the response is incomplete (e.g. "max_output_tokens"). */
	incompleteReason?: string;
}

async function generateSummary(options: {
	providerConfig: ProviderConfig;
	request: string;
	logger?: BasicLogger;
}): Promise<SummaryGenerationResult> {
	const handler = await createHandlerAsync(options.providerConfig);
	let text = "";
	let reasoningChars = 0;
	let incompleteReason: string | undefined;
	for await (const chunk of handler.createMessage(
		"Summarize the provided coding session into a concise continuation note with detailed next steps.",
		[{ role: "user", content: options.request }],
	)) {
		if (chunk.type === "text") {
			text += chunk.text;
			continue;
		}
		if (chunk.type === "reasoning") {
			reasoningChars += chunk.reasoning?.length ?? 0;
			continue;
		}
		if (chunk.type === "done") {
			if (!chunk.success && chunk.error) {
				throw new Error(chunk.error);
			}
			incompleteReason = chunk.incompleteReason ?? incompleteReason;
		}
	}
	options.logger?.debug("Generated compaction summary", {
		outputChars: text.length,
		reasoningChars,
		incompleteReason,
		modelId: options.providerConfig.modelId,
		providerId: options.providerConfig.providerId,
	});
	return { text: text.trim(), reasoningChars, incompleteReason };
}

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

export async function runAgenticCompaction(options: {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	preserveRecentTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): Promise<CoreCompactionResult | undefined> {
	const messages = options.context.messages;
	if (messages.length < 2) {
		return undefined;
	}

	const cutIndex = findCutIndex(
		messages,
		options.preserveRecentTokens,
		options.estimateMessageTokens,
	);
	if (cutIndex <= 0 || cutIndex >= messages.length) {
		return undefined;
	}

	const messagesToSummarize = messages.slice(0, cutIndex);
	const latestSummaryIndex = findLatestSummaryIndex(messagesToSummarize);
	const previousSummary =
		latestSummaryIndex >= 0
			? getCompactionSummaryMetadata(messagesToSummarize[latestSummaryIndex])
					?.summary
			: undefined;
	const newMessagesToFold =
		latestSummaryIndex >= 0
			? messagesToSummarize.slice(latestSummaryIndex + 1)
			: messagesToSummarize;
	if (newMessagesToFold.length === 0) {
		return undefined;
	}

	const preProjectionFileOps = extractFileOps(messagesToSummarize);
	const summarizerProviderConfig = resolveSummarizerConfig({
		activeProviderConfig: options.providerConfig,
		summarizer: options.summarizer,
	});
	const resolvedSummarizerInputLimit = resolveProviderMaxInputTokens(
		summarizerProviderConfig,
	);
	const canUseActiveContextLimit = options.summarizer === undefined;
	const activeCompactionInputLimit = Math.max(
		options.context.budget.request.maxInputTokens,
		options.context.budget.request.triggerTokens,
		MIN_AGENTIC_SUMMARY_INPUT_TOKENS,
	);
	if (resolvedSummarizerInputLimit === undefined && !canUseActiveContextLimit) {
		options.logger?.log(
			"Agentic compaction summarizer has no known input limit; using conservative summary budget",
			{
				severity: "warn",
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				fallbackInputLimit: MIN_AGENTIC_SUMMARY_INPUT_TOKENS,
			},
		);
	}
	const summarizerInputLimit =
		resolvedSummarizerInputLimit ??
		(canUseActiveContextLimit
			? activeCompactionInputLimit
			: MIN_AGENTIC_SUMMARY_INPUT_TOKENS);
	const summaryRequestOverheadTokens = estimateTokens(
		buildSummaryRequest({
			previousSummary,
			conversationText: "",
			fileOps: preProjectionFileOps,
		}).length,
	);
	const availableSummaryInputTokens =
		summarizerInputLimit - summaryRequestOverheadTokens;
	if (availableSummaryInputTokens <= 0) {
		options.logger?.debug(
			"Skipped agentic compaction: summarizer budget exhausted",
			{
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				summarizerInputLimit,
				summaryRequestOverheadTokens,
			},
		);
		return undefined;
	}
	// Build one summarizer attempt for a given summary-input target. `request` is
	// undefined when the projection cannot be made to fit at all; the budget is
	// always returned so the caller can report why.
	const buildAttemptForTarget = (targetTokens: number) => {
		const budget = buildAgenticSummaryInputBudget({
			messages: newMessagesToFold,
			targetTokens,
			estimateMessageTokens: options.estimateMessageTokens,
		});
		if (budget.status === "failed") {
			return { budget, fileOps: undefined, request: undefined };
		}
		const ops = extractFileOps(budget.messages);
		return {
			budget,
			fileOps: ops,
			request: buildSummaryRequest({
				previousSummary,
				conversationText: serializeConversation(budget.messages),
				fileOps: ops,
			}),
		};
	};

	const attempt = buildAttemptForTarget(availableSummaryInputTokens);
	if (attempt.request === undefined) {
		options.logger?.log(
			"Skipped agentic compaction: summary input budget failed",
			{
				severity: "warn",
				budgetWarnings: attempt.budget.warnings.map((warning) => warning.code),
				summaryInputEstimatedTokens: attempt.budget.estimatedTokens,
				targetTokens: availableSummaryInputTokens,
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
			},
		);
		return undefined;
	}
	let summaryInputBudget = attempt.budget;
	let fileOps = attempt.fileOps;
	let summaryRequest = attempt.request;
	options.logger?.debug("Agentic compaction summarizer diagnostics", {
		messagesToSummarize: messagesToSummarize.length,
		newMessagesToFold: newMessagesToFold.length,
		preservedMessages: messages.length - cutIndex,
		previousSummaryChars: previousSummary?.length ?? 0,
		conversationTextChars: serializeConversation(summaryInputBudget.messages)
			.length,
		summaryRequestChars: summaryRequest.length,
		summaryRequestEstimatedTokens: estimateTokens(summaryRequest.length),
		newMessagesJsonChars: safeJsonSize(newMessagesToFold),
		summaryInputEstimatedTokens: summaryInputBudget.estimatedTokens,
		summaryInputActions: summaryInputBudget.actions.length,
		summaryInputWarnings: summaryInputBudget.warnings.map(
			(warning) => warning.code,
		),
		summaryRequestOverheadTokens,
		summarizerProviderId: summarizerProviderConfig.providerId,
		summarizerModelId: summarizerProviderConfig.modelId,
		summarizerInputLimit,
		maxInputTokens: options.context.budget.request.maxInputTokens,
		triggerTokens: options.context.budget.request.triggerTokens,
	});
	let summaryResult = await generateSummary({
		providerConfig: summarizerProviderConfig,
		request: summaryRequest,
		logger: options.logger,
	});
	// A summary the provider reports as incomplete was cut off mid-sentence. It is
	// still usable text, but installing it silently is what makes the truncation
	// invisible: an empty summary gets a warning and this path got none.
	let truncatedReason = summaryResult.incompleteReason;
	let retriedAfterTruncation = false;
	if (truncatedReason) {
		logTruncatedSummary({
			attempt: 1,
			reason: truncatedReason,
			reasoningChars: summaryResult.reasoningChars,
			summaryChars: summaryResult.text.length,
			messagesFolded: summaryInputBudget.messages.length,
			targetTokens: availableSummaryInputTokens,
			summarizerProviderConfig,
			logger: options.logger,
		});

		// `max_output_tokens` caps the summary itself, so fewer source messages is
		// what makes a shorter summary more likely. Retry once with a reduced input
		// budget before accepting a cut-off summary.
		const retryTargetTokens = Math.max(
			Math.floor(
				availableSummaryInputTokens * TRUNCATED_SUMMARY_RETRY_INPUT_RATIO,
			),
			1,
		);
		const retry = buildAttemptForTarget(retryTargetTokens);
		if (retry.request !== undefined && retry.request !== summaryRequest) {
			retriedAfterTruncation = true;
			summaryInputBudget = retry.budget;
			fileOps = retry.fileOps;
			summaryRequest = retry.request;
			summaryResult = await generateSummary({
				providerConfig: summarizerProviderConfig,
				request: summaryRequest,
				logger: options.logger,
			});
			truncatedReason = summaryResult.incompleteReason;
			if (truncatedReason) {
				logTruncatedSummary({
					attempt: 2,
					reason: truncatedReason,
					reasoningChars: summaryResult.reasoningChars,
					summaryChars: summaryResult.text.length,
					messagesFolded: retry.budget.messages.length,
					targetTokens: retryTargetTokens,
					summarizerProviderConfig,
					logger: options.logger,
				});
			}
		}
	}
	const rawSummary = summaryResult.text;
	if (!rawSummary) {
		options.logger?.log(
			"Skipped agentic compaction: summarizer returned no summary text",
			{
				severity: "warn",
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
				summarizerMaxOutputTokens: summarizerProviderConfig.maxOutputTokens,
				reasoningChars: summaryResult.reasoningChars,
				incompleteReason: summaryResult.incompleteReason,
				likelyCause:
					summaryResult.reasoningChars > 0
						? "output_budget_consumed_by_reasoning"
						: "empty_response",
			},
		);
		return undefined;
	}

	const summary = ensureFilesSection(rawSummary, fileOps);
	const tokensBefore = messages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	const resultMessages = [
		buildSummaryMessage({
			summary,
			fileOps,
			tokensBefore,
			userRunSpan: countUserRunMessages(messagesToSummarize),
			truncated: truncatedReason !== undefined,
			truncatedReason,
			retriedAfterTruncation,
		}),
		...messages.slice(cutIndex),
	];
	const tokensAfter = resultMessages.reduce(
		(total, message) => total + options.estimateMessageTokens(message),
		0,
	);
	options.logger?.debug("Performed agentic compaction", {
		messagesBefore: messages.length,
		messagesAfter: resultMessages.length,
		messagesSummarized: cutIndex,
		messagesPreserved: messages.length - cutIndex,
		tokensBefore,
		tokensAfter,
		maxInputTokens: options.context.budget.request.maxInputTokens,
		summaryTruncated: truncatedReason !== undefined,
		summaryTruncatedReason: truncatedReason,
		summaryRetriedAfterTruncation: retriedAfterTruncation,
	});
	const budgetActionCount = summaryInputBudget.actions.filter(
		(action) =>
			action.reason === "over_budget" || action.reason === "tool_pair_boundary",
	).length;
	return {
		messages: resultMessages,
		budget: {
			policyIntent: "agentic_summary",
			actionCount: budgetActionCount,
			warningCount: summaryInputBudget.warnings.length,
			liveTailHandling: summaryInputBudget.liveTailHandling,
		},
	};
}
