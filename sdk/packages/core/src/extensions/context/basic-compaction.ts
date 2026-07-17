import {
	type BasicLogger,
	CHARS_PER_TOKEN,
	type ContentBlock,
	type MessageWithMetadata,
} from "@cline/shared";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
} from "../../types/config";
import { buildBudgetProjection } from "./budget-projection";
import {
	type EstimateMessageTokens,
	findFirstUserMessageIndex,
	findLastAssistantIndex,
	findLastTurnStartIndex,
	formatToolActivitySummary,
	hasToolActivity,
	isCompactionSummaryMessage,
	isTurnStartMessage,
	MIN_TRUNCATED_MESSAGE_TOKENS,
	summarizeToolActivity,
	type ToolActivitySummary,
	truncateToolResultContentForCompaction,
} from "./compaction-shared";

interface BasicCompactionCandidate {
	index: number;
	message: MessageWithMetadata;
	estimatedTokens: number;
	toolPairIds: string[];
	isFirstUser: boolean;
	isLastUser: boolean;
	isLastAssistant: boolean;
}

interface BasicCompactionCandidateSet {
	candidates: BasicCompactionCandidate[];
	totalTokens: number;
}

function sanitizeMessageForBasic(
	message: MessageWithMetadata,
): MessageWithMetadata | undefined {
	if (isCompactionSummaryMessage(message)) {
		return undefined;
	}
	if (typeof message.content === "string") {
		const text = message.content.trim();
		return text ? { ...message, content: text } : undefined;
	}

	// Preserve multimodal structure: trim text blocks, keep non-text blocks intact.
	const kept = message.content.filter(
		(block) => block.type !== "text" || block.text.trim(),
	);
	if (kept.length === 0) {
		return undefined;
	}
	return {
		...message,
		content: kept.map((block) =>
			block.type === "text"
				? { ...block, text: block.text.trim() }
				: block.type === "tool_result"
					? {
							...block,
							content: truncateToolResultContentForCompaction(block.content),
						}
					: block,
		),
	};
}

function getTotalTokens(
	messages: MessageWithMetadata[],
	estimateMessageTokens: EstimateMessageTokens,
): number {
	return messages.reduce(
		(total, message) => total + estimateMessageTokens(message),
		0,
	);
}

function truncateMessageText(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	const suffix = "\n...";
	const sliceLength = Math.max(1, limit - suffix.length);
	return `${text.slice(0, sliceLength)}${suffix}`;
}

function truncateMessageToTokens(
	message: MessageWithMetadata,
	maxTokens: number,
): MessageWithMetadata {
	const safeMaxTokens = Number.isFinite(maxTokens) ? Math.max(1, maxTokens) : 1;
	const targetChars = Math.max(16, safeMaxTokens * CHARS_PER_TOKEN);

	if (typeof message.content === "string") {
		const truncated = truncateMessageText(message.content, targetChars).trim();
		return { ...message, content: truncated || "..." };
	}

	// Preserve content block array structure while truncating text blocks.
	let remaining = targetChars;
	const truncatedBlocks = message.content.map((block) => {
		if (block.type !== "text" || remaining <= 0) {
			return block;
		}
		const truncated = truncateMessageText(block.text, remaining).trim();
		remaining -= truncated.length;
		return { ...block, text: truncated || "..." };
	});
	return { ...message, content: truncatedBlocks };
}

function buildBasicCandidates(
	messages: MessageWithMetadata[],
	estimateMessageTokens: EstimateMessageTokens,
): BasicCompactionCandidateSet {
	const firstUserIndex = findFirstUserMessageIndex(messages);
	const lastUserIndex = findLastTurnStartIndex(messages);
	const lastAssistantIndex = findLastAssistantIndex(messages);
	const candidates: BasicCompactionCandidate[] = [];
	let totalTokens = 0;
	for (let index = 0; index < messages.length; index += 1) {
		const sanitized = sanitizeMessageForBasic(messages[index]);
		if (!sanitized) {
			continue;
		}
		const estimatedTokens = estimateMessageTokens(sanitized);
		totalTokens += estimatedTokens;
		candidates.push({
			index,
			message: sanitized,
			estimatedTokens,
			toolPairIds: collectToolPairIds(sanitized),
			isFirstUser: index === firstUserIndex,
			isLastUser: index === lastUserIndex,
			isLastAssistant: index === lastAssistantIndex,
		});
	}
	return { candidates, totalTokens };
}

function updateCandidate(
	candidates: BasicCompactionCandidate[],
	index: number,
	message: MessageWithMetadata,
	estimateMessageTokens: EstimateMessageTokens,
): number {
	const candidate = candidates[index];
	const previousTokens = candidate.estimatedTokens;
	candidate.message = message;
	candidate.estimatedTokens = estimateMessageTokens(message);
	candidate.toolPairIds = collectToolPairIds(message);
	return candidate.estimatedTokens - previousTokens;
}

function collectToolPairIds(message: MessageWithMetadata): string[] {
	if (!Array.isArray(message.content)) {
		return [];
	}
	const ids: string[] = [];
	for (const block of message.content) {
		if (block.type === "tool_use") {
			ids.push(block.id);
		} else if (block.type === "tool_result") {
			ids.push(block.tool_use_id);
		}
	}
	return ids;
}

function buildToolPairCandidateIndex(
	candidates: BasicCompactionCandidate[],
): Map<string, Set<BasicCompactionCandidate>> {
	const indexByToolUseId = new Map<string, Set<BasicCompactionCandidate>>();
	for (const candidate of candidates) {
		for (const id of candidate.toolPairIds) {
			const existing = indexByToolUseId.get(id);
			if (existing) {
				existing.add(candidate);
			} else {
				indexByToolUseId.set(id, new Set([candidate]));
			}
		}
	}
	return indexByToolUseId;
}

function collectAtomicRemovalCandidates(
	activeCandidates: Set<BasicCompactionCandidate>,
	pairIndex: Map<string, Set<BasicCompactionCandidate>>,
	startCandidate: BasicCompactionCandidate,
): Set<BasicCompactionCandidate> {
	const removalCandidates = new Set<BasicCompactionCandidate>();
	const queue = [startCandidate];
	let queueIndex = 0;

	while (queueIndex < queue.length) {
		const candidate = queue[queueIndex];
		queueIndex += 1;
		if (
			candidate === undefined ||
			!activeCandidates.has(candidate) ||
			removalCandidates.has(candidate)
		) {
			continue;
		}
		removalCandidates.add(candidate);
		for (const id of candidate.toolPairIds) {
			for (const linkedCandidate of pairIndex.get(id) ?? []) {
				if (!removalCandidates.has(linkedCandidate)) {
					queue.push(linkedCandidate);
				}
			}
		}
	}

	return removalCandidates;
}

function removeCandidateSetInPlace(
	candidates: BasicCompactionCandidate[],
	removalCandidates: Set<BasicCompactionCandidate>,
): void {
	let writeIndex = 0;
	for (const candidate of candidates) {
		if (removalCandidates.has(candidate)) {
			continue;
		}
		candidates[writeIndex] = candidate;
		writeIndex += 1;
	}
	candidates.length = writeIndex;
}

function removeCandidatesByPredicate(
	candidates: BasicCompactionCandidate[],
	predicate: (candidate: BasicCompactionCandidate) => boolean,
	targetTokens: number,
	totalTokens: number,
): number {
	const activeCandidates = new Set(candidates);
	const pairIndex = buildToolPairCandidateIndex(candidates);
	for (
		let index = 0;
		index < candidates.length && totalTokens > targetTokens;
	) {
		if (!predicate(candidates[index])) {
			index += 1;
			continue;
		}
		const removalCandidates = collectAtomicRemovalCandidates(
			activeCandidates,
			pairIndex,
			candidates[index],
		);
		if (removalCandidates.size === 0) {
			index += 1;
			continue;
		}
		let removedTokens = 0;
		for (const candidate of removalCandidates) {
			removedTokens += candidate.estimatedTokens;
			activeCandidates.delete(candidate);
		}
		totalTokens -= removedTokens;
		removeCandidateSetInPlace(candidates, removalCandidates);
	}
	return totalTokens;
}

function trimCandidatesToBudget(
	candidates: BasicCompactionCandidate[],
	targetTokens: number,
	totalTokens: number,
	triggerTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): number {
	if (totalTokens <= targetTokens) {
		return totalTokens;
	}

	for (
		let index = candidates.length - 1;
		index >= 0 && totalTokens > targetTokens;
		index -= 1
	) {
		const candidate = candidates[index];
		if (candidate.isFirstUser) {
			continue;
		}
		const desiredTokens = Math.max(
			MIN_TRUNCATED_MESSAGE_TOKENS,
			candidate.estimatedTokens - (totalTokens - targetTokens),
		);
		if (desiredTokens >= candidate.estimatedTokens) {
			continue;
		}
		totalTokens += updateCandidate(
			candidates,
			index,
			truncateMessageToTokens(candidate.message, desiredTokens),
			estimateMessageTokens,
		);
	}

	if (totalTokens <= targetTokens) {
		return totalTokens;
	}

	const firstUserIndex = candidates.findIndex(
		(candidate) => candidate.isFirstUser,
	);
	if (firstUserIndex >= 0) {
		const firstUser = candidates[firstUserIndex];
		if (firstUser.estimatedTokens <= triggerTokens) {
			return totalTokens;
		}
		while (totalTokens > targetTokens) {
			const candidate = candidates[firstUserIndex];
			const desiredTokens = Math.max(
				1,
				candidate.estimatedTokens - (totalTokens - targetTokens),
			);
			if (desiredTokens >= candidate.estimatedTokens) {
				break;
			}
			const previousTokens = candidate.estimatedTokens;
			totalTokens += updateCandidate(
				candidates,
				firstUserIndex,
				truncateMessageToTokens(candidate.message, desiredTokens),
				estimateMessageTokens,
			);
			if (candidate.estimatedTokens >= previousTokens) {
				break;
			}
		}
	}
	return totalTokens;
}

function haveMessagesChanged(
	original: MessageWithMetadata[],
	next: MessageWithMetadata[],
): boolean {
	return JSON.stringify(original) !== JSON.stringify(next);
}

function buildDroppedWorkSummaryBlock(
	summary: ToolActivitySummary,
): ContentBlock {
	return {
		type: "text",
		text: `<SYSTEM>\nEarlier context was compacted. Summary of your actions before the user's next request:\n${formatToolActivitySummary(summary)}</SYSTEM>`,
	};
}

function userContentBlocks(message: MessageWithMetadata): ContentBlock[] {
	if (typeof message.content === "string") {
		return message.content.trim()
			? [{ type: "text", text: message.content }]
			: [];
	}
	// Attached file contents are stale context bloat once the turn is old
	// enough to compact; the dropped-work summaries carry the file paths.
	return message.content.filter((block) => block.type !== "file");
}

/**
 * Collapse runs of adjacent typed user messages — left behind when the
 * assistant turns between them were removed — into a single user message.
 * Each gap is bridged with a summary of the tool work that was dropped
 * there, resolved by message id against the original transcript.
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

	const merged: MessageWithMetadata[] = [];
	let index = 0;
	while (index < messages.length) {
		if (!isTurnStartMessage(messages[index])) {
			merged.push(messages[index]);
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
		if (runEnd === index) {
			merged.push(messages[index]);
			index += 1;
			continue;
		}
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
					if (hasToolActivity(summary)) {
						blocks.push(buildDroppedWorkSummaryBlock(summary));
					}
				}
			}
			blocks.push(...userContentBlocks(messages[member]));
		}
		merged.push({ ...messages[index], content: blocks });
		index = runEnd + 1;
	}
	return merged;
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

function splitLatestTurn(messages: MessageWithMetadata[]): {
	compactable: MessageWithMetadata[];
	protectedTail: MessageWithMetadata[];
} {
	const lastTurnStartIndex = findLastTurnStartIndex(messages);
	if (
		lastTurnStartIndex < 0 ||
		(lastTurnStartIndex === 0 && !isTurnStartMessage(messages[0]))
	) {
		return { compactable: messages, protectedTail: [] };
	}
	return {
		compactable: messages.slice(0, lastTurnStartIndex),
		protectedTail: messages.slice(lastTurnStartIndex),
	};
}

export function runBasicCompaction(options: {
	context: CoreCompactionContext;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): CoreCompactionResult | undefined {
	const totalTargetTokens = Math.max(
		1,
		Math.min(
			options.context.budget.messages.targetTokens,
			options.context.budget.messages.triggerTokens,
		),
	);
	const { compactable, protectedTail } = splitLatestTurn(
		options.context.messages,
	);
	if (compactable.length === 0) {
		return undefined;
	}
	const protectedTailTokens = getTotalTokens(
		protectedTail,
		options.estimateMessageTokens,
	);
	const targetTokens = Math.max(1, totalTargetTokens - protectedTailTokens);
	const candidateSet = buildBasicCandidates(
		compactable,
		options.estimateMessageTokens,
	);
	const { candidates } = candidateSet;
	if (candidates.length === 0) {
		return undefined;
	}
	const beforeCompactableTokens = candidateSet.totalTokens;
	let totalTokens = beforeCompactableTokens;

	totalTokens = removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "assistant" && !candidate.isLastAssistant,
		targetTokens,
		totalTokens,
	);
	totalTokens = removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "user" &&
			!candidate.isFirstUser &&
			!candidate.isLastUser,
		targetTokens,
		totalTokens,
	);
	totalTokens = removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "assistant" && candidate.isLastAssistant,
		targetTokens,
		totalTokens,
	);
	totalTokens = removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "user" &&
			candidate.isLastUser &&
			!candidate.isFirstUser,
		targetTokens,
		totalTokens,
	);

	totalTokens = trimCandidatesToBudget(
		candidates,
		targetTokens,
		totalTokens,
		options.context.budget.messages.triggerTokens,
		options.estimateMessageTokens,
	);

	const nextMessages = [
		...candidates.map((candidate) => candidate.message),
		...protectedTail,
	];
	const budgeted = buildBudgetProjection({
		messages: nextMessages,
		targetTokens: totalTargetTokens,
		policyIntent: "basic_compaction_projection",
		estimateMessageTokens: options.estimateMessageTokens,
	});
	// This final projection owns the hard output budget. Unlike the earlier
	// basic candidate passes, it can drop completed tool pairs after the latest
	// typed prompt while preserving coherent tool closures.
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
		options.context.messages,
	);

	if (!haveMessagesChanged(options.context.messages, mergedMessages)) {
		return undefined;
	}
	const resultMessages = mergedMessages.map(stripStaleMetrics);

	const beforeTokens = beforeCompactableTokens + protectedTailTokens;
	const afterTokens = getTotalTokens(
		resultMessages,
		options.estimateMessageTokens,
	);
	const budgetActionCount = budgeted.actions.filter(
		(action) =>
			action.reason === "over_budget" || action.reason === "tool_pair_boundary",
	).length;
	options.logger?.debug("Performed basic compaction", {
		messagesBefore: options.context.messages.length,
		messagesAfter: resultMessages.length,
		messagesRemoved: options.context.messages.length - resultMessages.length,
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
