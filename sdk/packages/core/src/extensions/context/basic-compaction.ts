import type { BasicLogger, MessageWithMetadata } from "@clinebot/shared";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
} from "../../types/config";
import {
	type EstimateMessageTokens,
	findFirstUserMessageIndex,
	findLastAssistantIndex,
	findLastTurnStartIndex,
	isCompactionSummaryMessage,
	MIN_TRUNCATED_MESSAGE_TOKENS,
	truncateText,
} from "./compaction-shared";

interface BasicCompactionCandidate {
	index: number;
	message: MessageWithMetadata;
	estimatedTokens: number;
	isFirstUser: boolean;
	isLastUser: boolean;
	isLastAssistant: boolean;
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

	// Preserve array structure: keep only text blocks with non-empty content.
	const kept = message.content.filter(
		(block) => block.type === "text" && block.text.trim(),
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
): BasicCompactionCandidate[] {
	const firstUserIndex = findFirstUserMessageIndex(messages);
	const lastUserIndex = findLastTurnStartIndex(messages);
	const lastAssistantIndex = findLastAssistantIndex(messages);
	const candidates: BasicCompactionCandidate[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const sanitized = sanitizeMessageForBasic(messages[index]);
		if (!sanitized) {
			continue;
		}
		candidates.push({
			index,
			message: sanitized,
			estimatedTokens: estimateMessageTokens(sanitized),
			isFirstUser: index === firstUserIndex,
			isLastUser: index === lastUserIndex,
			isLastAssistant: index === lastAssistantIndex,
		});
	}
	return candidates;
}

function updateCandidate(
	candidates: BasicCompactionCandidate[],
	index: number,
	message: MessageWithMetadata,
	estimateMessageTokens: EstimateMessageTokens,
): void {
	const candidate = candidates[index];
	candidate.message = message;
	candidate.estimatedTokens = estimateMessageTokens(message);
}

function removeCandidatesByPredicate(
	candidates: BasicCompactionCandidate[],
	predicate: (candidate: BasicCompactionCandidate) => boolean,
	targetTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): void {
	let totalTokens = getTotalTokens(
		candidates.map((candidate) => candidate.message),
		estimateMessageTokens,
	);
	for (
		let index = 0;
		index < candidates.length && totalTokens > targetTokens;
	) {
		if (!predicate(candidates[index])) {
			index += 1;
			continue;
		}
		totalTokens -= candidates[index].estimatedTokens;
		candidates.splice(index, 1);
	}
}

function trimCandidatesToBudget(
	candidates: BasicCompactionCandidate[],
	targetTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): void {
	let totalTokens = getTotalTokens(
		candidates.map((candidate) => candidate.message),
		estimateMessageTokens,
	);
	if (totalTokens <= targetTokens) {
		return;
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
		updateCandidate(
			candidates,
			index,
			truncateMessageToTokens(candidate.message, desiredTokens),
			estimateMessageTokens,
		);
		totalTokens = getTotalTokens(
			candidates.map((item) => item.message),
			estimateMessageTokens,
		);
	}

	if (totalTokens <= targetTokens) {
		return;
	}

	const firstUserIndex = candidates.findIndex(
		(candidate) => candidate.isFirstUser,
	);
	if (firstUserIndex >= 0) {
		const desiredTokens = Math.max(
			1,
			candidates[firstUserIndex].estimatedTokens - (totalTokens - targetTokens),
		);
		updateCandidate(
			candidates,
			firstUserIndex,
			truncateMessageToTokens(
				candidates[firstUserIndex].message,
				desiredTokens,
			),
			estimateMessageTokens,
		);
	}
}

function haveMessagesChanged(
	original: MessageWithMetadata[],
	next: MessageWithMetadata[],
): boolean {
	return JSON.stringify(original) !== JSON.stringify(next);
}

export function runBasicCompaction(options: {
	context: CoreCompactionContext;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): CoreCompactionResult | undefined {
	const targetTokens = Math.max(
		1,
		Math.min(
			options.context.triggerTokens,
			options.context.contextWindowTokens,
		),
	);
	const candidates = buildBasicCandidates(
		options.context.messages,
		options.estimateMessageTokens,
	);
	if (candidates.length === 0) {
		return undefined;
	}

	removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "assistant" && !candidate.isLastAssistant,
		targetTokens,
		options.estimateMessageTokens,
	);
	removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "user" &&
			!candidate.isFirstUser &&
			!candidate.isLastUser,
		targetTokens,
		options.estimateMessageTokens,
	);
	removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "assistant" && candidate.isLastAssistant,
		targetTokens,
		options.estimateMessageTokens,
	);
	removeCandidatesByPredicate(
		candidates,
		(candidate) =>
			candidate.message.role === "user" &&
			candidate.isLastUser &&
			!candidate.isFirstUser,
		targetTokens,
		options.estimateMessageTokens,
	);

	trimCandidatesToBudget(
		candidates,
		targetTokens,
		options.estimateMessageTokens,
	);

	const nextMessages = candidates.map((candidate) => candidate.message);
	if (!haveMessagesChanged(options.context.messages, nextMessages)) {
		return undefined;
	}

	const beforeTokens = getTotalTokens(
		options.context.messages.map((m) => sanitizeMessageForBasic(m) ?? m),
		options.estimateMessageTokens,
	);
	const afterTokens = getTotalTokens(
		nextMessages,
		options.estimateMessageTokens,
	);
	options.logger?.debug("Performed basic compaction", {
		messagesBefore: options.context.messages.length,
		messagesAfter: nextMessages.length,
		messagesRemoved: options.context.messages.length - nextMessages.length,
		tokensBefore: beforeTokens,
		tokensAfter: afterTokens,
		targetTokens,
		contextWindowTokens: options.context.contextWindowTokens,
	});

	return { messages: nextMessages };
}
