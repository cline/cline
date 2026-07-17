import type {
	BasicLogger,
	ContentBlock,
	MessageWithMetadata,
} from "@cline/shared";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
} from "../../types/config";
import { buildBudgetProjection } from "./budget-projection";
import {
	type EstimateMessageTokens,
	formatToolActivitySummary,
	hasToolActivity,
	isTurnStartMessage,
	summarizeToolActivity,
	type ToolActivitySummary,
} from "./compaction-shared";

function getTotalTokens(
	messages: MessageWithMetadata[],
	estimateMessageTokens: EstimateMessageTokens,
): number {
	return messages.reduce(
		(total, message) => total + estimateMessageTokens(message),
		0,
	);
}

function sanitizeTypedUserMessage(
	message: MessageWithMetadata,
): MessageWithMetadata | undefined {
	if (typeof message.content === "string") {
		const text = message.content.trim();
		return text ? { ...message, content: text } : undefined;
	}
	const kept = message.content.filter(
		(block) => block.type !== "text" || block.text.trim(),
	);
	if (kept.length === 0) {
		return undefined;
	}
	return {
		...message,
		content: kept.map((block) =>
			block.type === "text" ? { ...block, text: block.text.trim() } : block,
		),
	};
}

function haveMessagesChanged(
	original: MessageWithMetadata[],
	next: MessageWithMetadata[],
): boolean {
	return JSON.stringify(original) !== JSON.stringify(next);
}

/** How many of the conversation's most recent assistant text contents
 * survive verbatim inside the dropped-work summaries. */
const PRESERVED_ASSISTANT_TEXT_COUNT = 3;

function assistantTextContent(
	message: MessageWithMetadata,
): string | undefined {
	if (message.role !== "assistant") {
		return undefined;
	}
	if (typeof message.content === "string") {
		const text = message.content.trim();
		return text || undefined;
	}
	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text.trim())
		.filter(Boolean)
		.join("\n");
	return text || undefined;
}

function buildDroppedWorkSummaryBlock(
	summary: ToolActivitySummary,
	preservedResponses: string[],
): ContentBlock {
	const responsesSection =
		preservedResponses.length > 0
			? `\n\nYour recent responses:\n${preservedResponses.join("\n---\n")}`
			: "";
	return {
		type: "text",
		text: `<SYSTEM_NOTICE>\nEarlier context was compacted. Summary of your actions after the request above:\n${formatToolActivitySummary(summary)}${responsesSection}</SYSTEM_NOTICE>`,
	};
}

function userContentBlocks(
	message: MessageWithMetadata,
	keepAttachments: boolean,
): ContentBlock[] {
	if (typeof message.content === "string") {
		return message.content.trim()
			? [{ type: "text", text: message.content }]
			: [];
	}
	if (keepAttachments) {
		return [...message.content];
	}
	// Attached files and images are stale context bloat once the turn is
	// old enough to compact; the dropped-work summaries carry file paths.
	// Only the latest typed prompt keeps its attachments — they may be
	// load-bearing for the active request.
	return message.content.filter(
		(block) => block.type !== "file" && block.type !== "image",
	);
}

/**
 * Collapse runs of adjacent typed user messages — left behind when the
 * assistant turns between them were removed — into a single user message.
 * Each gap is bridged with a summary of the tool work that was dropped
 * there, resolved by message id against the original transcript. Work
 * dropped after a typed user message with no surviving messages in
 * between (e.g. the current turn's tool calls) gets a trailing summary
 * appended to that message.
 */
function mergeAdjacentUserTurns(
	messages: MessageWithMetadata[],
	originalMessages: MessageWithMetadata[],
): MessageWithMetadata[] {
	const originalIndexById = new Map<string, number>();
	originalMessages.forEach((message, index) => {
		if (message.id) {
			originalIndexById.set(message.id, index);
		}
	});
	const resolveOriginalIndex = (
		message: MessageWithMetadata,
	): number | undefined =>
		message.id ? originalIndexById.get(message.id) : undefined;

	// The conversation's most recent assistant text contents survive
	// verbatim inside the summary block covering the span they were
	// dropped from.
	const preservedTextIndices = new Set<number>();
	for (
		let scan = originalMessages.length - 1;
		scan >= 0 && preservedTextIndices.size < PRESERVED_ASSISTANT_TEXT_COUNT;
		scan -= 1
	) {
		if (assistantTextContent(originalMessages[scan])) {
			preservedTextIndices.add(scan);
		}
	}
	const collectPreservedResponses = (start: number, end: number): string[] => {
		const responses: string[] = [];
		for (let position = start; position < end; position += 1) {
			if (!preservedTextIndices.has(position)) {
				continue;
			}
			const text = assistantTextContent(originalMessages[position]);
			if (text) {
				responses.push(text);
			}
		}
		return responses;
	};

	interface MergedEntry {
		message: MessageWithMetadata;
		firstOriginalIndex: number | undefined;
		lastOriginalIndex: number | undefined;
		isTypedUser: boolean;
	}

	let latestTypedIndex = -1;
	for (let scan = messages.length - 1; scan >= 0; scan -= 1) {
		if (isTurnStartMessage(messages[scan])) {
			latestTypedIndex = scan;
			break;
		}
	}

	const entries: MergedEntry[] = [];
	let index = 0;
	while (index < messages.length) {
		if (!isTurnStartMessage(messages[index])) {
			const originalIndex = resolveOriginalIndex(messages[index]);
			entries.push({
				message: messages[index],
				firstOriginalIndex: originalIndex,
				lastOriginalIndex: originalIndex,
				isTypedUser: false,
			});
			index += 1;
			continue;
		}
		let runEnd = index;
		while (
			runEnd + 1 < messages.length &&
			isTurnStartMessage(messages[runEnd + 1])
		) {
			runEnd += 1;
		}
		let message = messages[index];
		if (runEnd > index) {
			const blocks: ContentBlock[] = [];
			for (let member = index; member <= runEnd; member += 1) {
				if (member > index) {
					const previousIndex = resolveOriginalIndex(messages[member - 1]);
					const currentIndex = resolveOriginalIndex(messages[member]);
					if (
						previousIndex !== undefined &&
						currentIndex !== undefined &&
						currentIndex > previousIndex + 1
					) {
						const summary = summarizeToolActivity(
							originalMessages.slice(previousIndex + 1, currentIndex),
						);
						const responses = collectPreservedResponses(
							previousIndex + 1,
							currentIndex,
						);
						if (hasToolActivity(summary) || responses.length > 0) {
							blocks.push(buildDroppedWorkSummaryBlock(summary, responses));
						}
					}
				}
				blocks.push(
					...userContentBlocks(messages[member], member === latestTypedIndex),
				);
			}
			message = { ...messages[index], content: blocks };
		} else {
			const blocks = userContentBlocks(message, index === latestTypedIndex);
			if (
				Array.isArray(message.content) &&
				blocks.length !== message.content.length
			) {
				message = { ...message, content: blocks };
			}
		}
		entries.push({
			message,
			firstOriginalIndex: resolveOriginalIndex(messages[index]),
			lastOriginalIndex: resolveOriginalIndex(messages[runEnd]),
			isTypedUser: true,
		});
		index = runEnd + 1;
	}

	// Trailing gaps: dropped work between a typed user message and the next
	// surviving message (or the end of the transcript) is summarized into
	// that user message so the model keeps a trace of its own actions.
	for (let entry = 0; entry < entries.length; entry += 1) {
		const current = entries[entry];
		if (!current.isTypedUser || current.lastOriginalIndex === undefined) {
			continue;
		}
		const next = entries[entry + 1];
		const gapEnd = next ? next.firstOriginalIndex : originalMessages.length;
		if (gapEnd === undefined || gapEnd <= current.lastOriginalIndex + 1) {
			continue;
		}
		const summary = summarizeToolActivity(
			originalMessages.slice(current.lastOriginalIndex + 1, gapEnd),
		);
		const responses = collectPreservedResponses(
			current.lastOriginalIndex + 1,
			gapEnd,
		);
		if (!hasToolActivity(summary) && responses.length === 0) {
			continue;
		}
		current.message = {
			...current.message,
			content: [
				...userContentBlocks(current.message, true),
				buildDroppedWorkSummaryBlock(summary, responses),
			],
		};
	}
	return entries.map((entry) => entry.message);
}

/**
 * Per-message token metrics describe the request context at the time the
 * message was produced; after compaction rewrites the transcript they no
 * longer add up, so they are dropped from the compacted result.
 */
function stripStaleMetrics(message: MessageWithMetadata): MessageWithMetadata {
	if (!message.metrics) {
		return message;
	}
	const { metrics: _metrics, ...rest } = message;
	return rest;
}

/**
 * Sum the per-message usage metrics that compaction is about to strip, so
 * the aggregate survives on the compaction message's metadata.
 */
function aggregateUsageMetrics(messages: MessageWithMetadata[]):
	| {
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
			cost: number;
	  }
	| undefined {
	let found = false;
	const totals = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cost: 0,
	};
	for (const message of messages) {
		const metrics = message.metrics;
		if (!metrics) {
			continue;
		}
		found = true;
		totals.inputTokens += metrics.inputTokens ?? 0;
		totals.outputTokens += metrics.outputTokens ?? 0;
		totals.cacheReadTokens += metrics.cacheReadTokens ?? 0;
		totals.cacheWriteTokens += metrics.cacheWriteTokens ?? 0;
		totals.cost += metrics.cost ?? 0;
	}
	return found ? totals : undefined;
}

/**
 * Fold the whole conversation history. Only typed user prompts survive
 * verbatim; every assistant turn and tool exchange — including the ones
 * after the latest typed prompt — is dropped and re-surfaced as
 * dropped-work summaries when the surviving prompts merge into a single
 * user message. No summarizer model is involved.
 */
export function runBasicCompaction(options: {
	context: CoreCompactionContext;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): CoreCompactionResult | undefined {
	const originalMessages = options.context.messages;
	// A lone message has nothing to compact around it; truncating the only
	// prompt would just corrupt the active request.
	if (originalMessages.length < 2) {
		return undefined;
	}
	const totalTargetTokens = Math.max(
		1,
		Math.min(
			options.context.budget.messages.targetTokens,
			options.context.budget.messages.triggerTokens,
		),
	);
	const keptMessages: MessageWithMetadata[] = [];
	for (const message of originalMessages) {
		if (!isTurnStartMessage(message)) {
			continue;
		}
		const sanitized = sanitizeTypedUserMessage(message);
		if (sanitized) {
			keptMessages.push(sanitized);
		}
	}
	if (keptMessages.length === 0) {
		return undefined;
	}
	const beforeTokens = getTotalTokens(
		originalMessages,
		options.estimateMessageTokens,
	);
	// Safety valve for pathological budgets: if the typed prompts alone
	// exceed the target, the projection trims them best-effort.
	const budgeted = buildBudgetProjection({
		messages: keptMessages,
		targetTokens: totalTargetTokens,
		policyIntent: "basic_compaction_projection",
		estimateMessageTokens: options.estimateMessageTokens,
	});
	if (budgeted.status === "failed") {
		options.logger?.debug("Basic compaction returned best-effort projection", {
			budgetWarnings: budgeted.warnings.map((warning) => warning.code),
			projectedTokens: budgeted.estimatedTokens,
			targetTokens: totalTargetTokens,
			maxInputTokens: options.context.budget.request.maxInputTokens,
		});
	}
	const mergedMessages = mergeAdjacentUserTurns(
		budgeted.messages,
		originalMessages,
	);

	if (!haveMessagesChanged(originalMessages, mergedMessages)) {
		return undefined;
	}
	// Mirror the recovery_notice metadata convention: mark the folded
	// message as system-inserted and record what the fold removed, since
	// the per-message metrics it aggregates are stripped below.
	const usageBefore = aggregateUsageMetrics(originalMessages);
	const compactionMetadata = {
		kind: "compaction",
		reason:
			options.context.mode === "manual"
				? "manual_compaction"
				: "auto_compaction",
		displayRole: "system",
		messagesRemoved: originalMessages.length - mergedMessages.length,
		...(usageBefore ? { usageBefore } : {}),
	};
	const resultMessages = mergedMessages.map((message, index) =>
		stripStaleMetrics(
			index === 0 && isTurnStartMessage(message)
				? {
						...message,
						metadata: { ...message.metadata, ...compactionMetadata },
					}
				: message,
		),
	);

	const afterTokens = getTotalTokens(
		resultMessages,
		options.estimateMessageTokens,
	);
	const budgetActionCount = budgeted.actions.filter(
		(action) =>
			action.reason === "over_budget" || action.reason === "tool_pair_boundary",
	).length;
	options.logger?.debug("Performed basic compaction", {
		messagesBefore: originalMessages.length,
		messagesAfter: resultMessages.length,
		messagesRemoved: originalMessages.length - resultMessages.length,
		tokensBefore: beforeTokens,
		tokensAfter: afterTokens,
		budgetStatus: budgeted.status,
		budgetActions: budgetActionCount,
		budgetWarnings: budgeted.warnings.map((warning) => warning.code),
		targetTokens: totalTargetTokens,
		maxInputTokens: options.context.budget.request.maxInputTokens,
	});

	return {
		messages: resultMessages,
		budget: {
			policyIntent: "basic_compaction_projection",
			actionCount: budgetActionCount,
			warningCount: budgeted.warnings.length,
			liveTailHandling: budgeted.liveTailHandling,
		},
	};
}
