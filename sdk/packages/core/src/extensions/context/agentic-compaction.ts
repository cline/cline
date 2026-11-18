import {
	type BasicLogger,
	estimateRequestInputTokens,
	type Message,
	type ToolDefinition,
} from "@cline/shared";
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
	buildInPlaceSummaryInstruction,
	buildSummaryMessage,
	buildSummaryRequest,
	type EstimateMessageTokens,
	ensureFilesSection,
	estimateTokens,
	extractFileOps,
	type FileOperationSummary,
	findCutIndex,
	findLatestSummaryIndex,
	getCompactionSummaryMetadata,
	isSameModelAsActiveSession,
	resolveProviderMaxInputTokens,
	resolveSummarizerConfig,
	serializeConversation,
} from "./compaction-shared";
import { generateSummary } from "./summary-generation";

const MIN_AGENTIC_SUMMARY_INPUT_TOKENS = 1_024;

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

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

type InPlaceSummaryPlan = {
	systemPrompt: string;
	messages: Message[];
	tools: ToolDefinition[];
	estimatedInputTokens: number;
};

/**
 * Fuse consecutive pure tool-result user messages exactly the way the live
 * model request renders them: `agentMessagesToMessages` (agent-message-codec)
 * performs this fusion before `MessageBuilder.buildForApi`, and
 * `buildForApi`'s own `addMissingToolResults` re-performs it whenever a
 * repair happens. The prepareTurn API transcript is derived WITHOUT the
 * codec fusion, so replaying it verbatim would render different chat-template
 * bytes than the prompt the provider already evaluated for this session;
 * re-fusing restores a byte-identical prefix even for tool-heavy transcripts.
 * Messages are cloned so the shared API transcript is never mutated.
 */
function fuseConsecutiveToolResultMessages(
	messages: readonly Message[],
): Message[] {
	const out: Message[] = [];
	for (const message of messages) {
		const previous = out[out.length - 1];
		if (
			message.role === "user" &&
			Array.isArray(message.content) &&
			message.content.length > 0 &&
			message.content.every((block) => block.type === "tool_result") &&
			previous?.role === "user" &&
			Array.isArray(previous.content) &&
			previous.content.every((block) => block.type === "tool_result")
		) {
			previous.content.push(...message.content);
			continue;
		}
		out.push(
			Array.isArray(message.content)
				? { ...message, content: [...message.content] }
				: message,
		);
	}
	return out;
}

/**
 * Plan an in-place summary: replay the session transcript verbatim (plus one
 * short instruction message) instead of re-serializing it as plain text. When
 * the summarizer IS the active session model, the replayed prefix is
 * byte-identical to the prompt the provider already evaluated for this
 * session, so prompt-prefix caching (e.g. llama.cpp slots) skips the
 * full-conversation re-prefill. Every condition below must hold; any doubt
 * falls back to the serialized request path — and every refusal is logged as
 * a plain string because the VS Code OutputChannel drops structured payloads.
 */
function resolveInPlaceSummary(options: {
	messages: CoreCompactionContext["messages"];
	cutIndex: number;
	fileOps: FileOperationSummary;
	systemPrompt: string | undefined;
	apiMessages: CoreCompactionContext["messages"] | undefined;
	tools: readonly unknown[] | undefined;
	activeProviderConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	summarizerInputLimit: number;
	preserveRecentTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): InPlaceSummaryPlan | undefined {
	const { systemPrompt, apiMessages } = options;
	if (!systemPrompt || !apiMessages) {
		options.logger?.debug(
			`In-place summary unavailable: missing request context (systemPrompt ${systemPrompt ? "present" : "missing"}, api transcript ${apiMessages ? "present" : "missing"})`,
		);
		return undefined;
	}
	// The replayed head must render to a strict prefix of the bytes the live
	// model request sends. prepareTurn's API transcript is derived from the
	// canonical one; when the two are 1:1 aligned the canonical cut applies
	// verbatim. When they are not aligned (provider message builders added or
	// dropped messages), re-cut the API transcript itself so the slice stays a
	// true prefix of it.
	let cutIndex = options.cutIndex;
	if (apiMessages.length !== options.messages.length) {
		cutIndex = findCutIndex(
			apiMessages,
			options.preserveRecentTokens,
			options.estimateMessageTokens,
		);
		options.logger?.debug(
			`In-place summary note: transcripts not 1:1 aligned (${options.messages.length} canonical / ${apiMessages.length} api) — re-cut on the API transcript (cut=${cutIndex})`,
		);
	}
	if (cutIndex <= 0 || cutIndex >= apiMessages.length) {
		options.logger?.debug(
			`In-place summary unavailable: no valid cut on the API transcript (cut=${cutIndex}/${apiMessages.length})`,
		);
		return undefined;
	}
	const head = apiMessages.slice(0, cutIndex);
	if (
		!isSameModelAsActiveSession({
			activeProviderConfig: options.activeProviderConfig,
			summarizer: options.summarizer,
		})
	) {
		options.logger?.debug(
			"In-place summary unavailable: summarizer is not the active session model",
		);
		return undefined;
	}
	const tools = toToolDefinitions(options.tools ?? []);
	const messages: Message[] = [
		...fuseConsecutiveToolResultMessages(head),
		{
			role: "user",
			content: buildInPlaceSummaryInstruction({ fileOps: options.fileOps }),
		},
	];
	const estimatedInputTokens = estimateRequestInputTokens({
		systemPrompt,
		messages,
		tools,
	});
	if (estimatedInputTokens > options.summarizerInputLimit) {
		options.logger?.debug(
			`Skipping in-place summary: transcript exceeds the summarizer input budget (${estimatedInputTokens} > ${options.summarizerInputLimit})`,
		);
		return undefined;
	}
	options.logger?.debug(
		`In-place summary planned: cut=${cutIndex}/${apiMessages.length} estimatedInputTokens=${estimatedInputTokens}`,
	);
	return { systemPrompt, messages, tools, estimatedInputTokens };
}

/** Same tool mapping as the model request (apihandler-agent-model-adapter). */
function toToolDefinitions(tools: readonly unknown[]): ToolDefinition[] {
	return tools.map((tool) => {
		const definition = tool as Partial<ToolDefinition>;
		return {
			name: String(definition.name ?? ""),
			description: String(definition.description ?? ""),
			inputSchema: (definition.inputSchema ?? {}) as Record<string, unknown>,
		};
	});
}

export async function runAgenticCompaction(options: {
	context: CoreCompactionContext;
	providerConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
	preserveRecentTokens: number;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
	/** System prompt of the live session turn; enables in-place summaries. */
	systemPrompt?: string;
	/** API-safe transcript; must stay 1:1 aligned with `context.messages`. */
	apiMessages?: CoreCompactionContext["messages"];
	/** Session tool definitions — the same objects the model request gets. */
	tools?: readonly unknown[];
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
	const summaryInputBudget = buildAgenticSummaryInputBudget({
		messages: newMessagesToFold,
		targetTokens: availableSummaryInputTokens,
		estimateMessageTokens: options.estimateMessageTokens,
	});
	if (summaryInputBudget.status === "failed") {
		options.logger?.log(
			"Skipped agentic compaction: summary input budget failed",
			{
				severity: "warn",
				budgetWarnings: summaryInputBudget.warnings.map(
					(warning) => warning.code,
				),
				summaryInputEstimatedTokens: summaryInputBudget.estimatedTokens,
				targetTokens: availableSummaryInputTokens,
				summarizerProviderId: summarizerProviderConfig.providerId,
				summarizerModelId: summarizerProviderConfig.modelId,
			},
		);
		return undefined;
	}
	const fileOps = extractFileOps(summaryInputBudget.messages);
	const inPlace = resolveInPlaceSummary({
		messages,
		cutIndex,
		fileOps,
		systemPrompt: options.systemPrompt,
		apiMessages: options.apiMessages,
		tools: options.tools,
		activeProviderConfig: options.providerConfig,
		summarizer: options.summarizer,
		summarizerInputLimit,
		preserveRecentTokens: options.preserveRecentTokens,
		estimateMessageTokens: options.estimateMessageTokens,
		logger: options.logger,
	});
	// Plain string on purpose: the VS Code OutputChannel drops structured
	// payloads, so this is the only way to see the chosen path in logs.
	options.logger?.debug(
		`Agentic compaction summarizer path: ${inPlace ? "in_place" : "serialized"}`,
	);
	let summaryResult: Awaited<ReturnType<typeof generateSummary>>;
	if (inPlace) {
		summaryResult = await generateSummary({
			providerConfig: summarizerProviderConfig,
			systemPrompt: inPlace.systemPrompt,
			messages: inPlace.messages,
			tools: inPlace.tools,
		});
		options.logger?.debug("Generated compaction summary", {
			mode: "in_place",
			outputChars: summaryResult.text.length,
			reasoningChars: summaryResult.reasoningChars,
			incompleteReason: summaryResult.incompleteReason,
			modelId: summarizerProviderConfig.modelId,
			providerId: summarizerProviderConfig.providerId,
			estimatedInputTokens: inPlace.estimatedInputTokens,
		});
	} else {
		const conversationText = serializeConversation(summaryInputBudget.messages);
		const summaryRequest = buildSummaryRequest({
			previousSummary,
			conversationText,
			fileOps,
		});
		options.logger?.debug("Agentic compaction summarizer diagnostics", {
			messagesToSummarize: messagesToSummarize.length,
			newMessagesToFold: newMessagesToFold.length,
			preservedMessages: messages.length - cutIndex,
			previousSummaryChars: previousSummary?.length ?? 0,
			conversationTextChars: conversationText.length,
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
		summaryResult = await generateSummary({
			providerConfig: summarizerProviderConfig,
			systemPrompt:
				"Summarize the provided coding session into a concise continuation note with detailed next steps.",
			request: summaryRequest,
		});
		options.logger?.debug("Generated compaction summary", {
			mode: "serialized",
			outputChars: summaryResult.text.length,
			reasoningChars: summaryResult.reasoningChars,
			incompleteReason: summaryResult.incompleteReason,
			modelId: summarizerProviderConfig.modelId,
			providerId: summarizerProviderConfig.providerId,
		});
	}
	const rawSummary = summaryResult.text.trim();
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
