import type { BasicLogger, MessageWithMetadata } from "@cline/shared";
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
	isTurnStartMessage,
	MIN_TRUNCATED_MESSAGE_TOKENS,
	truncateText,
	truncateToolResultContentForCompaction,
} from "./compaction-shared";

/**
 * Minimum candidate shape that the atomic-pair removal helpers below need.
 * Both the prefix-compaction candidates (BasicCompactionCandidate) and the
 * tail-compaction candidates (TailCandidate) extend this; the closure logic
 * is identical for both.
 */
interface MinimalCandidate {
	message: MessageWithMetadata;
	estimatedTokens: number;
}

interface BasicCompactionCandidate extends MinimalCandidate {
	index: number;
	isFirstUser: boolean;
	isLastUser: boolean;
	isLastAssistant: boolean;
}

/**
 * Tail-compaction candidate. Lives inside the post-CLINE-2136 protected
 * tail (everything from the latest typed user prompt onward). The flags
 * here drive a stricter preservation predicate than the prefix candidates
 * use; see runBasicCompaction / trimProtectedTail.
 */
interface TailCandidate extends MinimalCandidate {
	index: number;
	isTurnStart: boolean;
	isLastAssistant: boolean;
	hasInFlightToolUse: boolean;
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

function reconstructPrefixMessages(
	compactable: MessageWithMetadata[],
	initialCandidates: BasicCompactionCandidate[],
	remainingCandidates: BasicCompactionCandidate[],
): MessageWithMetadata[] {
	const initialCandidateIndexes = new Set(
		initialCandidates.map((candidate) => candidate.index),
	);
	const remainingByIndex = new Map(
		remainingCandidates.map((candidate) => [
			candidate.index,
			candidate.message,
		]),
	);
	const messages: MessageWithMetadata[] = [];
	for (let index = 0; index < compactable.length; index += 1) {
		const remaining = remainingByIndex.get(index);
		if (remaining) {
			messages.push(remaining);
			continue;
		}
		if (initialCandidateIndexes.has(index)) {
			continue;
		}
		if (isCompactionSummaryMessage(compactable[index])) {
			messages.push(compactable[index]);
		}
	}
	return messages;
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

function collectToolUseIds(message: MessageWithMetadata): Set<string> {
	const ids = new Set<string>();
	if (!Array.isArray(message.content)) {
		return ids;
	}
	for (const block of message.content) {
		if (block.type === "tool_use") {
			ids.add(block.id);
		}
	}
	return ids;
}

function collectToolResultIds(message: MessageWithMetadata): Set<string> {
	const ids = new Set<string>();
	if (!Array.isArray(message.content)) {
		return ids;
	}
	for (const block of message.content) {
		if (block.type === "tool_result") {
			ids.add(block.tool_use_id);
		}
	}
	return ids;
}

function collectToolPairIds<C extends MinimalCandidate>(
	candidate: C,
): Set<string> {
	return new Set([
		...collectToolUseIds(candidate.message),
		...collectToolResultIds(candidate.message),
	]);
}

function buildToolPairCandidateIndex<C extends MinimalCandidate>(
	candidates: C[],
): Map<string, Set<number>> {
	const indexByToolUseId = new Map<string, Set<number>>();
	for (let index = 0; index < candidates.length; index += 1) {
		for (const id of collectToolPairIds(candidates[index])) {
			const existing = indexByToolUseId.get(id);
			if (existing) {
				existing.add(index);
			} else {
				indexByToolUseId.set(id, new Set([index]));
			}
		}
	}
	return indexByToolUseId;
}

function collectAtomicRemovalIndexes<C extends MinimalCandidate>(
	candidates: C[],
	startIndex: number,
): Set<number> {
	const pairIndex = buildToolPairCandidateIndex(candidates);
	const removalIndexes = new Set<number>();
	const queue = [startIndex];

	while (queue.length > 0) {
		const index = queue.shift();
		if (index === undefined || removalIndexes.has(index)) {
			continue;
		}
		removalIndexes.add(index);
		for (const id of collectToolPairIds(candidates[index])) {
			for (const linkedIndex of pairIndex.get(id) ?? []) {
				if (!removalIndexes.has(linkedIndex)) {
					queue.push(linkedIndex);
				}
			}
		}
	}

	return removalIndexes;
}

function removeCandidatesByPredicate<C extends MinimalCandidate>(
	candidates: C[],
	predicate: (candidate: C) => boolean,
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
		const removalIndexes = collectAtomicRemovalIndexes(candidates, index);
		totalTokens -= Array.from(removalIndexes).reduce(
			(total, removalIndex) => total + candidates[removalIndex].estimatedTokens,
			0,
		);
		for (const removalIndex of Array.from(removalIndexes).sort(
			(left, right) => right - left,
		)) {
			candidates.splice(removalIndex, 1);
		}
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

/**
 * Collect tool_use ids inside the tail that do NOT have a matching
 * tool_result anywhere in the same tail. These are "in-flight" tool
 * calls — the model has emitted them but the runtime hasn't recorded
 * a result yet. We must NEVER fold them into a summary or drop them,
 * or the provider will reject the next request with "No tool call
 * found for function call output with call_id ..." (the inverse of
 * the orphaned-tool_result failure mode CLINE-2136 fixed for the
 * historical prefix).
 *
 * The tail snapshot we receive is the one the agent runtime passes
 * into prepareTurn BEFORE the next model request. By construction
 * any tool_result that has already arrived is in `state.messages`,
 * so a missing result reliably means "in-flight" — not "lost".
 */
function findInFlightToolUseIdsInTail(
	tail: readonly MessageWithMetadata[],
): Set<string> {
	const uses = new Set<string>();
	const results = new Set<string>();
	for (const message of tail) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				uses.add(block.id);
			}
			if (block.type === "tool_result") {
				results.add(block.tool_use_id);
			}
		}
	}
	for (const id of results) {
		uses.delete(id);
	}
	return uses;
}

function buildTailCandidates(
	tail: MessageWithMetadata[],
	estimateMessageTokens: EstimateMessageTokens,
	inFlightToolUseIds: Set<string>,
): TailCandidate[] {
	const lastAssistantIndex = findLastAssistantIndex(tail);
	const candidates: TailCandidate[] = [];
	for (let index = 0; index < tail.length; index += 1) {
		const sanitized = sanitizeMessageForBasic(tail[index]) ?? tail[index];
		let hasInFlightToolUse = false;
		if (Array.isArray(sanitized.content)) {
			for (const block of sanitized.content) {
				if (block.type === "tool_use" && inFlightToolUseIds.has(block.id)) {
					hasInFlightToolUse = true;
					break;
				}
			}
		}
		candidates.push({
			index,
			message: sanitized,
			estimatedTokens: estimateMessageTokens(sanitized),
			// By construction the tail starts at findLastTurnStartIndex,
			// so the typed user prompt is always at index 0.
			isTurnStart: index === 0 && isTurnStartMessage(tail[0]),
			isLastAssistant: index === lastAssistantIndex,
			hasInFlightToolUse,
		});
	}
	return candidates;
}

/**
 * Same shape as `removeCandidatesByPredicate` but with one key
 * difference: if the atomic-pair closure of a seed candidate touches
 * ANY candidate that the predicate marks as not-removable, we abort
 * that seed and move on. This is what makes tail trimming safe:
 * dropping a tool_result whose matching tool_use is the last
 * assistant message would otherwise drag the last assistant into
 * the removal set via the closure, violating the preservation
 * contract.
 *
 * On the prefix path the existing `removeCandidatesByPredicate`
 * is still used; its closures only group same-role candidates
 * (e.g. a non-last assistant with its non-last user tool_result),
 * so the two predicates collapse there and behavior is unchanged.
 */
function removeTailCandidatesByPredicate<C extends MinimalCandidate>(
	candidates: C[],
	predicate: (candidate: C) => boolean,
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
		const removalIndexes = collectAtomicRemovalIndexes(candidates, index);
		let closureRemovable = true;
		for (const linked of removalIndexes) {
			if (!predicate(candidates[linked])) {
				closureRemovable = false;
				break;
			}
		}
		if (!closureRemovable) {
			index += 1;
			continue;
		}
		totalTokens -= Array.from(removalIndexes).reduce(
			(total, removalIndex) => total + candidates[removalIndex].estimatedTokens,
			0,
		);
		for (const removalIndex of Array.from(removalIndexes).sort(
			(left, right) => right - left,
		)) {
			candidates.splice(removalIndex, 1);
		}
	}
}

/**
 * Drop the oldest completed tool_use/tool_result pairs inside the
 * post-CLINE-2136 protected tail when the tail alone exceeds the
 * compaction target. Preserves the typed user prompt, the latest
 * assistant message, and any assistant message carrying an in-flight
 * tool_use (see findInFlightToolUseIdsInTail).
 */
function trimProtectedTail(
	tail: MessageWithMetadata[],
	targetTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): MessageWithMetadata[] {
	if (tail.length <= 1) {
		return tail;
	}
	const inFlightToolUseIds = findInFlightToolUseIdsInTail(tail);
	const candidates = buildTailCandidates(
		tail,
		estimateMessageTokens,
		inFlightToolUseIds,
	);
	removeTailCandidatesByPredicate(
		candidates,
		(c) => !c.isTurnStart && !c.isLastAssistant && !c.hasInFlightToolUse,
		targetTokens,
		estimateMessageTokens,
	);
	return candidates.map((c) => c.message);
}

export function runBasicCompaction(options: {
	context: CoreCompactionContext;
	estimateMessageTokens: EstimateMessageTokens;
	logger?: BasicLogger;
}): CoreCompactionResult | undefined {
	const targetTokens = Math.max(
		1,
		Math.min(options.context.triggerTokens, options.context.maxInputTokens),
	);
	const { compactable, protectedTail } = splitLatestTurn(
		options.context.messages,
	);
	// CLINE-2185: previously this function bailed out when there was
	// no historical prefix to compact. The tail-trim path below still
	// needs to run in that case, so we no longer return undefined here.
	// Instead we build candidates over whatever prefix we have (which
	// may be empty) and let the prefix passes be no-ops.
	const candidates = buildBasicCandidates(
		compactable,
		options.estimateMessageTokens,
	);
	const initialCandidates = candidates.map((candidate) => ({ ...candidate }));

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

	// CLINE-2185: the protected tail (the in-flight turn after the user's
	// latest typed prompt) can itself exceed the compaction target when
	// the agent has produced many large tool results in a single turn.
	// Trim oldest completed tool pairs out of the tail while preserving
	// the typed prompt, the latest assistant message, and any in-flight
	// tool_use (whose result has not yet arrived). Atomic-pair closure
	// guarantees no orphaned tool_use/tool_result blocks.
	const tailTokensBefore = getTotalTokens(
		protectedTail,
		options.estimateMessageTokens,
	);
	const tailMessagesBefore = protectedTail.length;
	let finalTail = protectedTail;
	if (tailTokensBefore > targetTokens) {
		finalTail = trimProtectedTail(
			protectedTail,
			targetTokens,
			options.estimateMessageTokens,
		);
	}

	const prefixMessages = reconstructPrefixMessages(
		compactable,
		initialCandidates,
		candidates,
	);
	const nextMessages = [...prefixMessages, ...finalTail];
	if (!haveMessagesChanged(options.context.messages, nextMessages)) {
		return undefined;
	}

	const beforeTokens = getTotalTokens(
		[
			...compactable.map((m) => sanitizeMessageForBasic(m) ?? m),
			...protectedTail,
		],
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
		maxInputTokens: options.context.maxInputTokens,
		tailTokensBefore,
		tailMessagesBefore,
		tailMessagesAfter: finalTail.length,
	});

	return { messages: nextMessages };
}
