import type {
	ContentBlock,
	MessageWithMetadata,
	ToolResultContent,
} from "@cline/shared";
import type {
	BudgetAction,
	BudgetMutationAction,
	BudgetProjectionOptions,
	BudgetProjectionResult,
	BudgetProjectionWarning,
	BudgetPolicyIntent,
} from "./types";

type EstimateMessageTokens = (message: MessageWithMetadata) => number;

interface ProjectionPolicy {
	protectLatestTypedUser: boolean;
	protectLiveTailFromDrop: boolean;
	dropUnsafeOutsideLiveTail: boolean;
	dropThinkingBlocks: boolean;
}

function resolveProjectionPolicy(
	intent: BudgetPolicyIntent,
): ProjectionPolicy {
	switch (intent) {
		case "agentic_summary":
		case "basic_compaction_projection":
			return {
				protectLatestTypedUser: true,
				protectLiveTailFromDrop: true,
				dropUnsafeOutsideLiveTail: true,
				dropThinkingBlocks: true,
			};
		case "normal_provider_request":
			return {
				protectLatestTypedUser: true,
				protectLiveTailFromDrop: true,
				dropUnsafeOutsideLiveTail: false,
				dropThinkingBlocks: false,
			};
	}
}

function cloneMessages(messages: MessageWithMetadata[]): MessageWithMetadata[] {
	return messages.map((message) => ({
		...message,
		content: Array.isArray(message.content)
			? message.content.map((block) => ({ ...block }) as ContentBlock)
			: message.content,
		...(message.metadata ? { metadata: { ...message.metadata } } : {}),
	}));
}

function safeJsonSize(value: unknown): number {
	try {
		return JSON.stringify(value).length;
	} catch {
		return String(value).length;
	}
}

function totalTokens(
	messages: MessageWithMetadata[],
	estimateMessageTokens: EstimateMessageTokens,
): number {
	return messages.reduce(
		(total, message) => total + estimateMessageTokens(message),
		0,
	);
}

function isToolResultOnlyUserMessage(message: MessageWithMetadata): boolean {
	return (
		message.role === "user" &&
		Array.isArray(message.content) &&
		message.content.length > 0 &&
		message.content.every((block) => block.type === "tool_result")
	);
}

export function findLatestTypedUserMessageIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "user" && !isToolResultOnlyUserMessage(message)) {
			return index;
		}
	}
	return -1;
}

function findFirstTypedUserMessageIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role === "user" && !isToolResultOnlyUserMessage(message)) {
			return index;
		}
	}
	return -1;
}

function collectToolIds(message: MessageWithMetadata): Set<string> {
	const ids = new Set<string>();
	if (!Array.isArray(message.content)) {
		return ids;
	}
	for (const block of message.content) {
		if (block.type === "tool_use") {
			ids.add(block.id);
		} else if (block.type === "tool_result") {
			ids.add(block.tool_use_id);
		}
	}
	return ids;
}

function buildToolPairIndex(
	messages: MessageWithMetadata[],
): Map<string, Set<number>> {
	const index = new Map<string, Set<number>>();
	for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
		for (const id of collectToolIds(messages[messageIndex])) {
			const existing = index.get(id);
			if (existing) {
				existing.add(messageIndex);
			} else {
				index.set(id, new Set([messageIndex]));
			}
		}
	}
	return index;
}

function findProtectedTailStartIndex(messages: MessageWithMetadata[]): number {
	const resolvedToolUseIds = new Set<string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_result") {
				resolvedToolUseIds.add(block.tool_use_id);
			}
		}
	}
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!Array.isArray(message.content)) {
			continue;
		}
		if (
			message.content.some(
				(block) =>
					block.type === "tool_use" && !resolvedToolUseIds.has(block.id),
			)
		) {
			return index;
		}
	}
	return messages.length;
}

function collectMessageClosure(
	messages: MessageWithMetadata[],
	startIndex: number,
): Set<number> {
	const pairIndex = buildToolPairIndex(messages);
	const removal = new Set<number>();
	const queue = [startIndex];
	while (queue.length > 0) {
		const index = queue.shift();
		if (index === undefined || removal.has(index)) {
			continue;
		}
		removal.add(index);
		for (const id of collectToolIds(messages[index])) {
			for (const linked of pairIndex.get(id) ?? []) {
				if (!removal.has(linked)) {
					queue.push(linked);
				}
			}
		}
	}
	return removal;
}

function isUnsafeBlock(block: ContentBlock): boolean {
	return block.type === "image" || block.type === "redacted_thinking";
}

function isNestedUnsafeToolResultBlock(
	block: Extract<ToolResultContent["content"], unknown[]>[number],
): boolean {
	return block.type === "image";
}

function shouldDropWholeBlock(
	block: ContentBlock,
	policy: ProjectionPolicy,
	isProtected: boolean,
): boolean {
	if (policy.dropThinkingBlocks && block.type === "thinking") {
		return true;
	}
	return policy.dropUnsafeOutsideLiveTail && !isProtected && isUnsafeBlock(block);
}

function pruneEmptyMessages(
	messages: MessageWithMetadata[],
	originalIndexes: number[],
	actions: BudgetAction[],
	reason: BudgetMutationAction["reason"] = "over_budget",
): { messages: MessageWithMetadata[]; originalIndexes: number[] } {
	const next: MessageWithMetadata[] = [];
	const nextOriginalIndexes: number[] = [];
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (Array.isArray(message.content) && message.content.length === 0) {
				actions.push({
					kind: "dropped_message",
					path: { messageIndex: originalIndexes[index] },
					reason,
					originalSize: safeJsonSize(message),
					finalSize: 0,
				});
			continue;
		}
		next.push(message);
		nextOriginalIndexes.push(originalIndexes[index]);
	}
	return { messages: next, originalIndexes: nextOriginalIndexes };
}

function dropUnsafeBlocks(
	messages: MessageWithMetadata[],
	originalIndexes: number[],
	actions: BudgetAction[],
	latestTypedUserIndex: number,
	protectedTailStartIndex: number,
	policy: ProjectionPolicy,
): MessageWithMetadata[] {
	return messages.map((message, messageIndex) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		let changed = false;
		const protectedBlock =
			messageIndex === latestTypedUserIndex ||
			messageIndex >= protectedTailStartIndex;
		const content = message.content.flatMap((block, blockIndex) => {
			if (shouldDropWholeBlock(block, policy, protectedBlock)) {
				changed = true;
				actions.push({
					kind: "dropped_block",
					path: { messageIndex: originalIndexes[messageIndex], blockIndex },
					reason: "unsafe_to_truncate",
					originalSize: safeJsonSize(block),
					finalSize: 0,
				});
				return [];
			}
			if (block.type === "tool_result" && Array.isArray(block.content)) {
				const nestedContent = block.content.filter((nestedBlock) => {
					if (
						policy.dropUnsafeOutsideLiveTail &&
						!protectedBlock &&
						isNestedUnsafeToolResultBlock(nestedBlock)
					) {
						return false;
					}
					return true;
				});
				if (nestedContent.length !== block.content.length) {
					changed = true;
					const nextBlock = { ...block, content: nestedContent };
					actions.push({
						kind: "dropped_block",
						path: { messageIndex: originalIndexes[messageIndex], blockIndex },
						reason: "unsafe_to_truncate",
						originalSize: safeJsonSize(block),
						finalSize: safeJsonSize(nextBlock),
					});
					return [nextBlock];
				}
			}
			return [block];
		});
		return changed ? { ...message, content } : message;
	});
}

function dropThinkingBlocks(
	messages: MessageWithMetadata[],
	originalIndexes: number[],
	actions: BudgetAction[],
): MessageWithMetadata[] {
	return messages.map((message, messageIndex) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		let changed = false;
		const content = message.content.filter((block, blockIndex) => {
			if (block.type !== "thinking") {
				return true;
			}
			changed = true;
			actions.push({
				kind: "dropped_block",
				path: { messageIndex: originalIndexes[messageIndex], blockIndex },
				reason: "unsafe_to_truncate",
				originalSize: safeJsonSize(block),
				finalSize: 0,
			});
			return false;
		});
		return changed ? { ...message, content } : message;
	});
}


function truncateText(text: string, maxChars: number): string {
	if (maxChars <= 0) {
		return "";
	}
	if (text.length <= maxChars) {
		return text;
	}
	if (maxChars <= 16) {
		return text.slice(0, Math.max(1, maxChars));
	}
	const estimateMarker = `\n...[truncated ${text.length - maxChars} chars]`;
	const keep = Math.max(1, maxChars - estimateMarker.length);
	const marker = `\n...[truncated ${text.length - keep} chars]`;
	return `${text.slice(0, keep)}${marker}`;
}

function truncateToolResultContent(
	content: ToolResultContent["content"],
	maxChars: number,
): ToolResultContent["content"] {
	if (typeof content === "string") {
		return truncateText(content, maxChars);
	}
	let remaining = maxChars;
	return content.map((block) => {
		if (remaining <= 0) {
			if (block.type === "text") {
				return { ...block, text: "" };
			}
			if (block.type === "file") {
				return { ...block, content: "" };
			}
			return block;
		}
		if (block.type === "text") {
			const text = truncateText(block.text, remaining);
			remaining -= text.length;
			return { ...block, text };
		}
		if (block.type === "file") {
			const content = truncateText(block.content, remaining);
			remaining -= content.length;
			return { ...block, content };
		}
		return block;
	});
}

function toolResultTextLength(content: ToolResultContent["content"]): number {
	if (typeof content === "string") {
		return content.length;
	}
	return content.reduce((total, block) => {
		if (block.type === "text") {
			return total + block.text.length;
		}
		if (block.type === "file") {
			return total + block.content.length;
		}
		return total;
	}, 0);
}

function truncateMessageText(
	message: MessageWithMetadata,
	maxChars: number,
): MessageWithMetadata {
	if (typeof message.content === "string") {
		return { ...message, content: truncateText(message.content, maxChars) };
	}
	let remaining = maxChars;
	return {
		...message,
		content: message.content.map((block) => {
			if (remaining <= 0) {
				if (block.type === "text") {
					return { ...block, text: "" };
				}
				if (block.type === "file") {
					return { ...block, content: "" };
				}
				if (block.type === "tool_result") {
					return {
						...block,
						content: truncateToolResultContent(block.content, 0),
					};
				}
				return block;
			}
			if (block.type === "text") {
				const text = truncateText(block.text, remaining);
				remaining -= text.length;
				return { ...block, text };
			}
			if (block.type === "file") {
				const content = truncateText(block.content, remaining);
				remaining -= content.length;
				return { ...block, content };
			}
			if (block.type === "tool_result") {
				const content = truncateToolResultContent(block.content, remaining);
				remaining -= toolResultTextLength(content);
				return { ...block, content };
			}
			return block;
		}),
	};
}

function hasTruncatableText(message: MessageWithMetadata): boolean {
	if (typeof message.content === "string") {
		return message.content.length > 0;
	}
	return message.content.some(
		(block) =>
			block.type === "text" ||
			block.type === "file" ||
			block.type === "tool_result",
	);
}

function removeMessagesAt(
	messages: MessageWithMetadata[],
	originalIndexes: number[],
	removal: Set<number>,
): { messages: MessageWithMetadata[]; originalIndexes: number[] } {
	return {
		messages: messages.filter((_, index) => !removal.has(index)),
		originalIndexes: originalIndexes.filter((_, index) => !removal.has(index)),
	};
}

function closureTouchesProtectedTail(
	closure: Set<number>,
	protectedStartIndex: number,
): boolean {
	if (protectedStartIndex < 0) {
		return false;
	}
	for (const removalIndex of closure) {
		if (removalIndex >= protectedStartIndex) {
			return true;
		}
	}
	return false;
}

function closureTouchesPinnedMessage(
	closure: Set<number>,
	pinnedIndex: number,
): boolean {
	return pinnedIndex >= 0 && closure.has(pinnedIndex);
}

export function buildBudgetProjection(
	options: BudgetProjectionOptions,
): BudgetProjectionResult {
	const actions: BudgetAction[] = [];
	const warnings: BudgetProjectionWarning[] = [];
	const policy = resolveProjectionPolicy(options.policyIntent);
	if (options.targetTokens <= 0) {
		return {
			status: "failed",
			messages: cloneMessages(options.messages),
			actions,
			liveTailHandling: "preserved_out_of_band",
			estimatedTokens: totalTokens(
				options.messages,
				options.estimateMessageTokens,
			),
			warnings: [
				{
					code: "budget_impossible",
					message: "Target budget must be greater than zero.",
				},
			],
		};
	}

	let messages = cloneMessages(options.messages);
	let originalIndexes = messages.map((_, index) => index);
	if (policy.dropThinkingBlocks) {
		const prunedThinking = pruneEmptyMessages(
			dropThinkingBlocks(messages, originalIndexes, actions),
			originalIndexes,
			actions,
			"unsafe_to_truncate",
		);
		messages = prunedThinking.messages;
		originalIndexes = prunedThinking.originalIndexes;
	}
	const latestTypedUserIndex = policy.protectLatestTypedUser
		? findLatestTypedUserMessageIndex(messages)
		: -1;
	const protectedTailStartIndex = policy.protectLiveTailFromDrop
		? findProtectedTailStartIndex(messages)
		: messages.length;
	if (policy.dropUnsafeOutsideLiveTail) {
		const prunedUnsafe = pruneEmptyMessages(
			dropUnsafeBlocks(
				messages,
				originalIndexes,
				actions,
				latestTypedUserIndex,
				protectedTailStartIndex,
				policy,
			),
			originalIndexes,
			actions,
		);
		messages = prunedUnsafe.messages;
		originalIndexes = prunedUnsafe.originalIndexes;
	}
	let estimatedTokens = totalTokens(messages, options.estimateMessageTokens);
	if (estimatedTokens <= options.targetTokens) {
		return {
			status: "ok",
			messages,
			actions,
			liveTailHandling:
				actions.length > 0 ? "included_degraded" : "included_verbatim",
			estimatedTokens,
			warnings,
		};
	}

	for (
		let index = messages.length - 1;
		index >= 0 && estimatedTokens > options.targetTokens;
		index -= 1
	) {
		const latestTypedUserIndex = findLatestTypedUserMessageIndex(messages);
		if (index === latestTypedUserIndex) {
			continue;
		}
		if (
			policy.protectLiveTailFromDrop &&
			index >= findProtectedTailStartIndex(messages)
		) {
			continue;
		}
		if (!hasTruncatableText(messages[index])) {
			continue;
		}
		const originalSize = safeJsonSize(messages[index]);
		const charsPerToken = Math.max(
			1,
			originalSize /
				Math.max(1, options.estimateMessageTokens(messages[index])),
		);
		const targetChars = Math.max(
			16,
			Math.floor(
				(options.targetTokens * charsPerToken) /
					Math.max(1, messages.length),
			),
		);
		messages[index] = truncateMessageText(messages[index], targetChars);
		actions.push({
			kind: "truncated_text",
			path: { messageIndex: originalIndexes[index] },
			reason: "over_budget",
			originalSize,
			finalSize: safeJsonSize(messages[index]),
		});
		estimatedTokens = totalTokens(messages, options.estimateMessageTokens);
	}

	for (
		let index = 0;
		index < messages.length && estimatedTokens > options.targetTokens;
	) {
		const firstTypedUserIndex = findFirstTypedUserMessageIndex(messages);
		const latestTypedUserIndex = findLatestTypedUserMessageIndex(messages);
		const protectedStartIndex = policy.protectLiveTailFromDrop
			? findProtectedTailStartIndex(messages)
			: messages.length;
		if (index === firstTypedUserIndex || index === latestTypedUserIndex) {
			actions.push({
				kind: "preserved",
				path: { messageIndex: originalIndexes[index] },
				reason: "protected_live_tail",
				originalSize: safeJsonSize(messages[index]),
				finalSize: safeJsonSize(messages[index]),
			});
			index += 1;
			continue;
		}
		const closure = collectMessageClosure(messages, index);
		if (closureTouchesPinnedMessage(closure, firstTypedUserIndex)) {
			index += 1;
			continue;
		}
		if (closureTouchesPinnedMessage(closure, latestTypedUserIndex)) {
			index += 1;
			continue;
		}
		if (closureTouchesProtectedTail(closure, protectedStartIndex)) {
			index += 1;
			continue;
		}
		for (const removalIndex of closure) {
			actions.push({
				kind: "dropped_message",
				path: { messageIndex: originalIndexes[removalIndex] },
				reason:
					closure.size > 1 || collectToolIds(messages[removalIndex]).size > 0
						? "tool_pair_boundary"
						: "over_budget",
				originalSize: safeJsonSize(messages[removalIndex]),
				finalSize: 0,
			});
		}
		const removed = removeMessagesAt(messages, originalIndexes, closure);
		messages = removed.messages;
		originalIndexes = removed.originalIndexes;
		estimatedTokens = totalTokens(messages, options.estimateMessageTokens);
	}

	if (estimatedTokens > options.targetTokens) {
		warnings.push({
			code: "budget_unachievable_with_protections",
			message:
				"Projection could not reach budget without violating protected content.",
		});
		return {
			status: "failed",
			messages,
			actions,
			liveTailHandling: "included_degraded",
			estimatedTokens,
			warnings,
		};
	}

	return {
		status: "ok",
		messages,
		actions,
		liveTailHandling:
			actions.length > 0 ? "included_degraded" : "included_verbatim",
		estimatedTokens,
		warnings,
	};
}
