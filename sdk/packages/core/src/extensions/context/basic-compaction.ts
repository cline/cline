import type { BasicLogger, MessageWithMetadata } from "@cline/shared";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
} from "../../types/config";
import {
	DEFAULT_TARGET_RATIO,
	type EstimateMessageTokens,
	findFirstUserMessageIndex,
	findLastAssistantIndex,
	findLastTurnStartIndex,
	isCompactionSummaryMessage,
	isTurnStartMessage,
	MIN_TRUNCATED_MESSAGE_TOKENS,
	truncateText,
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

function truncateMessageToTokens(
	message: MessageWithMetadata,
	maxTokens: number,
): MessageWithMetadata {
	const safeMaxTokens = Math.max(1, maxTokens);
	const targetChars = Math.max(16, safeMaxTokens * 4);

	if (typeof message.content === "string") {
		const truncated = truncateText(message.content, targetChars).trim();
		return { ...message, content: truncated || "..." };
	}

	// Preserve content block array structure while truncating text blocks.
	let remaining = targetChars;
	const truncatedBlocks = message.content.map((block) => {
		if (block.type !== "text" || remaining <= 0) {
			return block;
		}
		const truncated = truncateText(block.text, remaining).trim();
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
		const desiredTokens = Math.max(
			1,
			candidates[firstUserIndex].estimatedTokens - (totalTokens - targetTokens),
		);
		totalTokens += updateCandidate(
			candidates,
			firstUserIndex,
			truncateMessageToTokens(
				candidates[firstUserIndex].message,
				desiredTokens,
			),
			estimateMessageTokens,
		);
	}
	return totalTokens;
}

function haveMessagesChanged(
	original: MessageWithMetadata[],
	next: MessageWithMetadata[],
): boolean {
	return JSON.stringify(original) !== JSON.stringify(next);
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
	const targetTokens = Math.max(
		1,
		Math.min(
			Math.floor(options.context.triggerTokens * DEFAULT_TARGET_RATIO),
			options.context.maxInputTokens,
		),
	);
	const { compactable, protectedTail } = splitLatestTurn(
		options.context.messages,
	);
	if (compactable.length === 0) {
		return undefined;
	}
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
		options.estimateMessageTokens,
	);

	const nextMessages = [
		...candidates.map((candidate) => candidate.message),
		...protectedTail,
	];
	if (!haveMessagesChanged(options.context.messages, nextMessages)) {
		return undefined;
	}

	const protectedTailTokens = getTotalTokens(
		protectedTail,
		options.estimateMessageTokens,
	);
	const beforeTokens = beforeCompactableTokens + protectedTailTokens;
	const afterTokens = totalTokens + protectedTailTokens;
	options.logger?.debug("Performed basic compaction", {
		messagesBefore: options.context.messages.length,
		messagesAfter: nextMessages.length,
		messagesRemoved: options.context.messages.length - nextMessages.length,
		tokensBefore: beforeTokens,
		tokensAfter: afterTokens,
		targetTokens,
		maxInputTokens: options.context.maxInputTokens,
	});

	return { messages: nextMessages };
}
