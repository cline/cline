/**
 * API-safe message builder for provider payloads.
 *
 * @see PLAN.md §3.1 — moved from `packages/agents/src/context/message-builder.ts`.
 * @see PLAN.md §3.2.3 — public surface of `MessageBuilder`.
 *
 * Walks the conversation to produce provider-ready messages, handling
 * tool-result truncation and outdated-file-content rewrite for compaction.
 * Per-instance caches make this host state.
 */

import {
	type ContentBlock,
	createMediaBudgetState,
	IMAGE_OMITTED_PLACEHOLDER,
	type ImageContent,
	type MediaBudgetOptions,
	type MediaBudgetState,
	type Message,
	normalizeUserInput,
	type ResolvedMediaBudget,
	resolveMediaBudget,
	type TextContent,
	type ToolResultContent,
	validateAndReserveImageMedia,
} from "@cline/shared";

export const DEFAULT_MAX_TOOL_RESULT_CHARS = 8_000;
export const DEFAULT_MAX_FILE_CONTENT_CHARS = 50_000;
// The aggregate budget intentionally stays far above what the per-result cap
// usually produces: budget truncation rewrites bytes mid-transcript, which
// invalidates provider prefix caches from the first rewritten block onward,
// so it must remain a rare overflow valve rather than the steady state.
export const DEFAULT_MAX_TOTAL_TEXT_BYTES = 6_000_000;
export const DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 200_000;
export const DEFAULT_MAX_ASSISTANT_TOOL_MARKUP_CHARS = 12_000;
// Batch stale-read rewrites to avoid breaking provider prefix caches on every re-read.
// 64KB is roughly 8 provider-capped read results; set to 0 for eager rewriting.
export const DEFAULT_MIN_OUTDATED_REWRITE_BYTES = 65_536;
const MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES = 2_000;
const MIN_TOTAL_BUDGET_ASSISTANT_TEXT_BYTES = 40_000;
const REPEATED_TOOL_CALL_MARKUP_THRESHOLD = 8;
export const MESSAGE_BUILDER_LIMIT_ENV = {
	maxToolResultChars: "CLINE_MESSAGE_BUILDER_MAX_TOOL_RESULT_CHARS",
	maxTotalTextBytes: "CLINE_MESSAGE_BUILDER_MAX_TOTAL_TEXT_BYTES",
	minOutdatedRewriteBytes: "CLINE_MESSAGE_BUILDER_MIN_OUTDATED_REWRITE_BYTES",
} as const;
const READ_TOOL_NAMES = new Set(["read", "read_files"]);
const OUTDATED_FILE_CONTENT = "[outdated - see the latest file content]";
const MISSING_TOOL_RESULT_TEXT =
	"Tool execution was interrupted before a result was produced.";
const TRUNCATE_MARKER_DEFAULT = (n: number) =>
	`\n\n...[truncated ${n} chars]...\n\n`;
const TRUNCATE_MARKER_BUDGET = (n: number) =>
	`\n\n...[truncated ${n} chars to fit provider request budget]...\n\n`;
const TRUNCATE_ASSISTANT_TEXT_MARKER = (n: number) =>
	`\n\n...[assistant text truncated: omitted ${n} chars]...\n\n`;
const TRUNCATE_ASSISTANT_TEXT_BUDGET_MARKER = (n: number) =>
	`\n\n...[assistant text truncated: omitted ${n} chars to fit provider request budget]...\n\n`;
const TRUNCATE_ASSISTANT_TOOL_MARKUP_MARKER = (n: number) =>
	`\n\n...[assistant text truncated: omitted ${n} chars due to repeated tool-call markup]...\n\n`;

interface ReadLocator {
	path: string;
	startLine: number | null;
	endLine: number | null;
}

interface TruncationCandidate {
	byteLength: number;
	minBytes: number;
	makeMarker: (removed: number) => string;
	get(): string;
	set(value: string): void;
}

export interface MessageBuilderOptions {
	maxToolResultChars?: number;
	maxFileContentChars?: number;
	maxTotalTextBytes?: number;
	mediaBudget?: MediaBudgetOptions;
	maxAssistantTextChars?: number;
	maxAssistantToolMarkupChars?: number;
	minOutdatedRewriteBytes?: number;
}

export function getMessageBuilderOptionsFromEnv(
	env: Record<string, string | undefined> = process.env,
): MessageBuilderOptions {
	// Size caps reject zero/negative overrides; stale-read batching accepts 0
	// for eager mode and "disable"/"Infinity" for rollback.
	return {
		maxToolResultChars: parsePositiveIntegerEnv(
			env[MESSAGE_BUILDER_LIMIT_ENV.maxToolResultChars],
		),
		maxTotalTextBytes: parsePositiveIntegerEnv(
			env[MESSAGE_BUILDER_LIMIT_ENV.maxTotalTextBytes],
		),
		minOutdatedRewriteBytes: parseNonNegativeLimitEnv(
			env[MESSAGE_BUILDER_LIMIT_ENV.minOutdatedRewriteBytes],
		),
	};
}

/**
 * Builds an API-safe message copy without mutating original conversation history.
 */
export class MessageBuilder {
	private indexedMessageCount = 0;
	private indexedTailRef: Message | undefined;
	private readonly toolNameByIdCache = new Map<string, string>();
	private readonly readLocatorsByToolUseIdCache = new Map<
		string,
		ReadLocator[]
	>();
	private readonly latestReadToolUseByLocatorCache = new Map<string, string>();
	private readonly latestFullContentOwnerByPathCache = new Map<
		string,
		string
	>();
	private readResultLocatorCache = new WeakMap<object, ReadLocator[]>();
	private readonly maxToolResultChars: number;
	private readonly maxFileContentChars: number;
	private readonly maxTotalTextBytes: number;
	private readonly mediaBudget: MediaBudgetOptions;
	private readonly maxAssistantTextChars: number;
	private readonly maxAssistantToolMarkupChars: number;
	private readonly minOutdatedRewriteBytes: number;
	// Sticky rewrite decisions. Kept across resetIndexes because production
	// rebuilds fresh Message objects; entries are revalidated/pruned per build.
	private readonly committedOutdatedRewrites = new Map<string, Set<string>>();

	constructor(options: MessageBuilderOptions = {}) {
		this.maxToolResultChars = normalizePositiveLimit(
			options.maxToolResultChars,
			DEFAULT_MAX_TOOL_RESULT_CHARS,
		);
		this.maxFileContentChars = normalizePositiveLimit(
			options.maxFileContentChars,
			DEFAULT_MAX_FILE_CONTENT_CHARS,
		);
		this.maxTotalTextBytes = normalizePositiveLimit(
			options.maxTotalTextBytes,
			DEFAULT_MAX_TOTAL_TEXT_BYTES,
		);
		this.mediaBudget = options.mediaBudget ?? {};
		this.maxAssistantTextChars = normalizePositiveLimit(
			options.maxAssistantTextChars,
			DEFAULT_MAX_ASSISTANT_TEXT_CHARS,
		);
		this.maxAssistantToolMarkupChars = normalizePositiveLimit(
			options.maxAssistantToolMarkupChars,
			DEFAULT_MAX_ASSISTANT_TOOL_MARKUP_CHARS,
		);
		this.minOutdatedRewriteBytes = normalizeNonNegativeLimit(
			options.minOutdatedRewriteBytes,
			DEFAULT_MIN_OUTDATED_REWRITE_BYTES,
		);
	}

	resetConversationState(): void {
		this.resetIndexes();
		this.committedOutdatedRewrites.clear();
	}

	buildForApi(messages: Message[]): Message[] {
		this.reindex(messages);
		this.commitOutdatedRewrites(messages);
		const repairedMessages = this.addMissingToolResults(messages);

		const prepared = repairedMessages.map((message) => {
			if (!Array.isArray(message.content)) {
				if (message.role === "user" && typeof message.content === "string") {
					const normalized = normalizeUserInput(message.content);
					if (normalized !== message.content) {
						return { ...message, content: normalized };
					}
				}
				if (
					message.role === "assistant" &&
					typeof message.content === "string"
				) {
					const truncated = this.truncateAssistantText(message.content);
					if (truncated !== message.content) {
						return { ...message, content: truncated };
					}
				}
				return message;
			}

			let changed = false;
			const content = message.content.map((block) => {
				const next = this.transformBlock(block, message.role);
				if (next !== block) {
					changed = true;
				}
				return next;
			});

			return changed ? { ...message, content } : message;
		});

		const mediaLimited = this.applyMediaBudget(prepared);
		return this.truncateToTotalTextBudget(mediaLimited);
	}

	private transformBlock(
		block: ContentBlock,
		role: Message["role"],
	): ContentBlock {
		if (
			role === "user" &&
			block.type === "text" &&
			typeof block.text === "string"
		) {
			const normalized = normalizeUserInput(block.text);
			if (normalized !== block.text) {
				return { ...block, text: normalized };
			}
			return block;
		}

		if (
			role === "assistant" &&
			block.type === "text" &&
			typeof block.text === "string"
		) {
			const truncated = this.truncateAssistantText(block.text);
			return truncated === block.text ? block : { ...block, text: truncated };
		}

		if (block.type === "file") {
			// Top-level file blocks are user attachments, not tool output; they
			// get their own (looser) cap so the aggressive tool-result limit
			// does not mutilate content the user explicitly supplied.
			const truncated = truncateMiddleByChars(
				block.content,
				this.maxFileContentChars,
				TRUNCATE_MARKER_DEFAULT,
			);
			return truncated === block.content
				? block
				: { ...block, content: truncated };
		}

		if (block.type !== "tool_result") {
			return block;
		}

		const toolName = this.resolveToolName(block);
		let nextContent = block.content;

		if (this.isReadTool(toolName) && block.is_error !== true) {
			const committed = this.committedOutdatedRewrites.get(block.tool_use_id);
			if (committed && committed.size > 0) {
				const locators = this.getReadLocators(block);
				const outdated = locators.filter(
					(locator) =>
						committed.has(this.toReadLocatorKey(locator)) &&
						this.isOutdatedReadLocator(locator, block.tool_use_id),
				);
				if (outdated.length > 0) {
					nextContent = this.replaceOutdatedReadContent(nextContent, outdated);
				}
			}
		}

		// Truncation is default-on for every tool result: MCP and custom SDK
		// tools produce payloads just as large as the built-in ones, and any
		// allowlist gate silently exempts them.
		nextContent = this.truncateToolResultContent(nextContent);

		return nextContent === block.content
			? block
			: { ...block, content: nextContent };
	}

	private reindex(messages: Message[]): void {
		const tailUnchanged =
			this.indexedMessageCount === 0 ||
			(messages.length >= this.indexedMessageCount &&
				messages[this.indexedMessageCount - 1] === this.indexedTailRef);
		if (messages.length < this.indexedMessageCount || !tailUnchanged) {
			this.resetIndexes();
		}

		for (let i = this.indexedMessageCount; i < messages.length; i++) {
			const message = messages[i];
			if (!Array.isArray(message.content)) {
				continue;
			}

			for (let j = 0; j < message.content.length; j++) {
				const block = message.content[j];
				if (block.type === "file") {
					this.latestFullContentOwnerByPathCache.set(
						block.path,
						`file:${i}:${j}`,
					);
				} else if (block.type === "tool_use") {
					const normalizedName = block.name.toLowerCase();
					this.toolNameByIdCache.set(block.id, normalizedName);
					if (this.isReadTool(normalizedName)) {
						const locators = this.extractLocatorsFromReadToolInput(block.input);
						if (locators.length > 0) {
							this.readLocatorsByToolUseIdCache.set(block.id, locators);
						}
					}
				} else if (block.type === "tool_result") {
					const toolName = this.resolveToolName(block);
					if (!this.isReadTool(toolName) || block.is_error === true) {
						continue;
					}
					const locators = this.getReadLocators(block);
					for (const locator of locators) {
						this.latestReadToolUseByLocatorCache.set(
							this.toReadLocatorKey(locator),
							block.tool_use_id,
						);
						if (this.isFullFileRead(locator)) {
							this.latestFullContentOwnerByPathCache.set(
								locator.path,
								block.tool_use_id,
							);
						}
					}
				}
			}
		}
		this.indexedMessageCount = messages.length;
		this.indexedTailRef =
			messages.length > 0 ? messages[messages.length - 1] : undefined;
	}

	/** Commits pending stale-read rewrites once reclaimable bytes cross the threshold. */
	private commitOutdatedRewrites(messages: Message[]): void {
		const pending = new Map<string, Set<string>>();
		const seenToolUseIds = new Set<string>();
		let pendingBytes = 0;

		for (const message of messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type !== "tool_result" || block.is_error === true) {
					continue;
				}
				const toolName = this.resolveToolName(block);
				if (!this.isReadTool(toolName)) {
					continue;
				}
				seenToolUseIds.add(block.tool_use_id);
				const committed = this.committedOutdatedRewrites.get(block.tool_use_id);
				const newKeys = new Set<string>();
				const validKeys = new Set<string>();
				for (const locator of this.getReadLocators(block)) {
					const key = this.toReadLocatorKey(locator);
					if (!this.isOutdatedReadLocator(locator, block.tool_use_id)) {
						continue;
					}
					validKeys.add(key);
					if (!committed?.has(key)) {
						newKeys.add(key);
					}
				}
				// Rollback can make a committed locator current again.
				if (committed) {
					for (const key of committed) {
						if (!validKeys.has(key)) {
							committed.delete(key);
						}
					}
					if (committed.size === 0) {
						this.committedOutdatedRewrites.delete(block.tool_use_id);
					}
				}
				if (newKeys.size === 0) {
					continue;
				}
				let keys = pending.get(block.tool_use_id);
				if (!keys) {
					keys = new Set<string>();
					pending.set(block.tool_use_id, keys);
				}
				for (const key of newKeys) {
					keys.add(key);
				}
				// Attribute provider-bound bytes to the newly-stale locators, not
				// raw history bytes or the whole block.
				pendingBytes += this.estimateOutdatedReclaimBytes(
					block.content,
					newKeys,
				);
			}
		}

		for (const toolUseId of this.committedOutdatedRewrites.keys()) {
			if (!seenToolUseIds.has(toolUseId)) {
				this.committedOutdatedRewrites.delete(toolUseId);
			}
		}

		if (pending.size === 0 || pendingBytes < this.minOutdatedRewriteBytes) {
			return;
		}

		for (const [toolUseId, keys] of pending) {
			let committed = this.committedOutdatedRewrites.get(toolUseId);
			if (!committed) {
				committed = new Set<string>();
				this.committedOutdatedRewrites.set(toolUseId, committed);
			}
			for (const key of keys) {
				committed.add(key);
			}
		}
	}

	/** Estimates reclaimable bytes for stale locators inside one tool-result block. */
	private estimateOutdatedReclaimBytes(
		content: ToolResultContent["content"],
		outdatedKeys: ReadonlySet<string>,
	): number {
		const allLocators = this.extractReadLocatorsFromToolResultContent(content);
		const blockFullyOutdated =
			allLocators.length > 0 &&
			allLocators.every((locator) =>
				outdatedKeys.has(this.toReadLocatorKey(locator)),
			);

		const attributeText = (text: string): number => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(text);
			} catch {
				return blockFullyOutdated || allLocators.length === 0
					? utf8ByteLength(this.truncateMiddle(text))
					: 0;
			}
			const entries = Array.isArray(parsed) ? parsed : [parsed];
			let total = 0;
			for (const entry of entries) {
				const locator = this.extractLocatorFromResultEntry(entry);
				if (locator && outdatedKeys.has(this.toReadLocatorKey(locator))) {
					total += this.providerBoundEntryBytes(entry);
				}
			}
			return total;
		};

		if (typeof content === "string") {
			return attributeText(content);
		}
		// Image siblings are rewritten positionally, so count them positionally too.
		const outdatedKeySet = new Set(outdatedKeys);
		let outdatedImageCount = 0;
		for (const entry of content) {
			if (entry.type === "text") {
				outdatedImageCount += this.countOutdatedImageEntries(
					entry.text,
					outdatedKeySet,
				);
			}
		}
		let total = 0;
		for (const entry of content) {
			if (entry.type === "text") {
				total += attributeText(entry.text);
			} else if (entry.type === "image") {
				if (outdatedImageCount > 0) {
					outdatedImageCount -= 1;
					total += utf8ByteLength(entry.data);
				}
			} else if (isStructuredToolResultEntry(entry)) {
				const locator = this.extractLocatorFromResultEntry(entry);
				if (locator && outdatedKeys.has(this.toReadLocatorKey(locator))) {
					total += this.providerBoundEntryBytes(entry);
				}
			} else if (entry.type === "file") {
				if (
					outdatedKeys.has(
						this.toReadLocatorKey({
							path: entry.path,
							startLine: null,
							endLine: null,
						}),
					)
				) {
					total += utf8ByteLength(this.truncateMiddle(entry.content));
				}
			}
		}
		return total;
	}

	private providerBoundEntryBytes(entry: unknown): number {
		const providerBound = this.truncateNestedStrings(entry);
		return utf8ByteLength(JSON.stringify(providerBound));
	}

	private addMissingToolResults(messages: Message[]): Message[] {
		const existingToolResultIds = this.collectToolResultIds(messages);
		const repaired: Message[] = [];
		const pendingMissingToolCalls = new Map<string, string>();
		let changed = false;

		const flushMissing = () => {
			if (pendingMissingToolCalls.size === 0) {
				return;
			}
			pushRepairedMessage(
				this.createMissingToolResultMessage(pendingMissingToolCalls),
			);
			pendingMissingToolCalls.clear();
			changed = true;
		};

		const pushRepairedMessage = (message: Message) => {
			const previous = repaired.at(-1);
			if (this.shouldMergeUserAfterToolResults(previous, message)) {
				repaired[repaired.length - 1] = {
					...previous,
					content: [
						...previous.content,
						...this.contentBlocksForUserMerge(message.content),
					],
				};
				changed = true;
				return;
			}
			repaired.push(message);
		};

		for (const message of messages) {
			if (this.isToolResultOnlyMessage(message)) {
				pushRepairedMessage(
					this.appendMissingToolResults(message, pendingMissingToolCalls),
				);
				if (pendingMissingToolCalls.size > 0) {
					pendingMissingToolCalls.clear();
					changed = true;
				}
				continue;
			}

			if (Array.isArray(message.content)) {
				const toolResults = message.content.filter(
					(block): block is ToolResultContent => block.type === "tool_result",
				);
				const otherBlocks = message.content.filter(
					(block) => block.type !== "tool_result",
				);

				if (toolResults.length > 0) {
					const toolResultMessage = this.appendMissingToolResults(
						{
							...message,
							role: "user",
							content: toolResults,
						},
						pendingMissingToolCalls,
					);
					pushRepairedMessage(toolResultMessage);
					if (pendingMissingToolCalls.size > 0) {
						pendingMissingToolCalls.clear();
					}
					changed = true;
				}

				if (otherBlocks.length > 0 || toolResults.length === 0) {
					if (toolResults.length === 0) {
						flushMissing();
					}
					const nextMessage =
						toolResults.length > 0
							? {
									...message,
									content: otherBlocks,
								}
							: message;
					pushRepairedMessage(nextMessage);
					if (nextMessage.role === "assistant") {
						this.trackMissingToolCalls(
							nextMessage,
							existingToolResultIds,
							pendingMissingToolCalls,
						);
					}
				}
				continue;
			}

			flushMissing();
			pushRepairedMessage(message);
		}

		flushMissing();
		return changed ? repaired : messages;
	}

	private appendMissingToolResults(
		message: Message,
		pendingMissingToolCalls: ReadonlyMap<string, string>,
	): Message {
		if (pendingMissingToolCalls.size === 0 || !Array.isArray(message.content)) {
			return message;
		}
		return {
			...message,
			role: "user",
			content: [
				...message.content,
				...this.createMissingToolResultBlocks(pendingMissingToolCalls),
			],
		};
	}

	private shouldMergeUserAfterToolResults(
		previous: Message | undefined,
		next: Message,
	): previous is Message & { content: ToolResultContent[] } {
		return (
			previous?.role === "user" &&
			next.role === "user" &&
			this.isToolResultOnlyMessage(previous) &&
			this.contentBlocksForUserMerge(next.content).length > 0
		);
	}

	private contentBlocksForUserMerge(
		content: Message["content"],
	): ContentBlock[] {
		return typeof content === "string"
			? content.length > 0
				? [{ type: "text", text: content } satisfies TextContent]
				: []
			: content;
	}

	private collectToolResultIds(messages: Message[]): Set<string> {
		const ids = new Set<string>();
		for (const message of messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type === "tool_result") {
					ids.add(block.tool_use_id);
				}
			}
		}
		return ids;
	}

	private isToolResultOnlyMessage(message: Message): boolean {
		return (
			message.role === "user" &&
			Array.isArray(message.content) &&
			message.content.length > 0 &&
			message.content.every((block) => block.type === "tool_result")
		);
	}

	private trackMissingToolCalls(
		message: Message,
		existingToolResultIds: Set<string>,
		pendingMissingToolCalls: Map<string, string>,
	): void {
		if (!Array.isArray(message.content)) {
			return;
		}
		for (const block of message.content) {
			if (block.type !== "tool_use" || existingToolResultIds.has(block.id)) {
				continue;
			}
			pendingMissingToolCalls.set(block.id, block.name);
		}
	}

	private createMissingToolResultMessage(
		toolCalls: ReadonlyMap<string, string>,
	): Message {
		return {
			role: "user",
			content: this.createMissingToolResultBlocks(toolCalls),
		};
	}

	private createMissingToolResultBlocks(
		toolCalls: ReadonlyMap<string, string>,
	): ToolResultContent[] {
		return Array.from(toolCalls, ([toolUseId, toolName]) => ({
			type: "tool_result",
			tool_use_id: toolUseId,
			name: toolName,
			content: [
				{
					type: "text",
					text: this.formatMissingToolResultText(toolName),
				},
			],
			is_error: true,
		}));
	}

	private formatMissingToolResultText(toolName: string): string {
		return toolName
			? `${MISSING_TOOL_RESULT_TEXT} Tool: ${toolName}.`
			: MISSING_TOOL_RESULT_TEXT;
	}

	private resetIndexes(): void {
		this.indexedMessageCount = 0;
		this.indexedTailRef = undefined;
		this.toolNameByIdCache.clear();
		this.readLocatorsByToolUseIdCache.clear();
		this.latestReadToolUseByLocatorCache.clear();
		this.latestFullContentOwnerByPathCache.clear();
		this.readResultLocatorCache = new WeakMap<object, ReadLocator[]>();
	}

	private getReadLocators(block: ToolResultContent): ReadLocator[] {
		const blockRef = block as unknown as object;
		let parsed = this.readResultLocatorCache.get(blockRef);
		if (parsed === undefined) {
			parsed = this.extractReadLocatorsFromToolResultContent(block.content);
			this.readResultLocatorCache.set(blockRef, parsed);
		}
		if (parsed.length > 0) {
			return parsed;
		}
		return this.readLocatorsByToolUseIdCache.get(block.tool_use_id) ?? [];
	}

	private extractLocatorsFromReadToolInput(input: unknown): ReadLocator[] {
		if (!input || typeof input !== "object") {
			return [];
		}

		const record = input as Record<string, unknown>;
		const locators: ReadLocator[] = [];
		const direct = this.extractLocatorFromReadRequest(record);
		if (direct) {
			locators.push(direct);
		}

		if (Array.isArray(record.files)) {
			for (const value of record.files) {
				const locator = this.extractLocatorFromReadRequest(value);
				if (locator) {
					locators.push(locator);
				}
			}
		}

		if (Array.isArray(record.file_paths)) {
			for (const value of record.file_paths) {
				if (typeof value === "string" && value.length > 0) {
					locators.push({ path: value, startLine: null, endLine: null });
				}
			}
		}

		return this.dedupeReadLocators(locators);
	}

	private extractReadLocatorsFromToolResultContent(
		content: ToolResultContent["content"],
	): ReadLocator[] {
		if (typeof content === "string") {
			return this.tryParseReadLocators(content);
		}
		const locators: ReadLocator[] = [];
		for (const entry of content) {
			if (entry.type === "text") {
				locators.push(...this.tryParseReadLocators(entry.text));
				continue;
			}
			if (isStructuredToolResultEntry(entry)) {
				const locator = this.extractLocatorFromResultEntry(entry);
				if (locator) {
					locators.push(locator);
				}
			}
		}
		return this.dedupeReadLocators(locators);
	}

	private tryParseReadLocators(text: string): ReadLocator[] {
		try {
			return this.extractLocatorsFromParsedReadResult(JSON.parse(text));
		} catch {
			return [];
		}
	}

	private extractLocatorsFromParsedReadResult(value: unknown): ReadLocator[] {
		if (Array.isArray(value)) {
			const locators: ReadLocator[] = [];
			for (const item of value) {
				const locator = this.extractLocatorFromResultEntry(item);
				if (locator) {
					locators.push(locator);
				}
			}
			return this.dedupeReadLocators(locators);
		}
		const locator = this.extractLocatorFromResultEntry(value);
		return locator ? [locator] : [];
	}

	private extractLocatorFromReadRequest(
		value: unknown,
	): ReadLocator | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const record = value as Record<string, unknown>;
		const path = this.extractPath(record);
		if (!path) {
			return undefined;
		}
		return {
			path,
			startLine: this.extractLineNumber(record.start_line),
			endLine: this.extractLineNumber(record.end_line),
		};
	}

	private extractLocatorFromResultEntry(
		value: unknown,
	): ReadLocator | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const record = value as Record<string, unknown>;
		const path = this.extractPath(record);
		if (path) {
			return {
				path,
				startLine: this.extractLineNumber(record.start_line),
				endLine: this.extractLineNumber(record.end_line),
			};
		}
		if (typeof record.query === "string" && record.query.length > 0) {
			return this.parseReadQuery(record.query);
		}
		return undefined;
	}

	private extractPath(record: Record<string, unknown>): string | undefined {
		const candidates = [record.path, record.file_path, record.filePath];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.length > 0) {
				return candidate;
			}
		}
		return undefined;
	}

	private extractLineNumber(value: unknown): number | null {
		return typeof value === "number" && Number.isInteger(value) ? value : null;
	}

	/**
	 * Read-result queries echo the request as a JSON object string
	 * (`{"path":...,"start_line":...}`); older transcripts carry the legacy
	 * fused `path:start-end` format, so both must parse.
	 */
	private parseReadQuery(query: string): ReadLocator {
		const jsonLocator = this.parseJsonReadQuery(query);
		if (jsonLocator) {
			return jsonLocator;
		}
		const match = /^(.*):(\d+)-(EOF|\d+)$/.exec(query);
		if (!match) {
			return { path: query, startLine: null, endLine: null };
		}
		return {
			path: match[1],
			startLine: Number(match[2]),
			endLine: match[3] === "EOF" ? null : Number(match[3]),
		};
	}

	private parseJsonReadQuery(query: string): ReadLocator | undefined {
		if (!query.startsWith("{")) {
			return undefined;
		}
		try {
			return this.extractLocatorFromReadRequest(JSON.parse(query));
		} catch {
			return undefined;
		}
	}

	private dedupeReadLocators(locators: ReadLocator[]): ReadLocator[] {
		const unique = new Map<string, ReadLocator>();
		for (const locator of locators) {
			unique.set(this.toReadLocatorKey(locator), locator);
		}
		return Array.from(unique.values());
	}

	private toReadLocatorKey(locator: ReadLocator): string {
		if (this.isFullFileRead(locator)) {
			return locator.path;
		}
		return `${locator.path}:${locator.startLine ?? 1}-${locator.endLine ?? "EOF"}`;
	}

	private isFullFileRead(locator: ReadLocator): boolean {
		return locator.startLine == null && locator.endLine == null;
	}

	private isOutdatedReadLocator(
		locator: ReadLocator,
		toolUseId: string,
	): boolean {
		const fullOwner = this.latestFullContentOwnerByPathCache.get(locator.path);
		if (fullOwner && fullOwner !== toolUseId) {
			return true;
		}
		return (
			this.latestReadToolUseByLocatorCache.get(
				this.toReadLocatorKey(locator),
			) !== toolUseId
		);
	}

	private replaceOutdatedReadContent(
		content: ToolResultContent["content"],
		outdated: ReadLocator[],
	): ToolResultContent["content"] {
		const outdatedKeys = new Set(outdated.map((l) => this.toReadLocatorKey(l)));
		const outdatedPaths = new Set(outdated.map((l) => l.path));

		if (typeof content === "string") {
			return (
				this.replaceOutdatedInString(content, outdatedKeys) ??
				OUTDATED_FILE_CONTENT
			);
		}

		// Image entries are paired with text result markers, so rewrite them positionally.
		let pendingImageReplacements = 0;
		for (const entry of content) {
			if (entry.type === "text") {
				pendingImageReplacements += this.countOutdatedImageEntries(
					entry.text,
					outdatedKeys,
				);
			}
		}

		return content.map((entry) => {
			if (entry.type === "file") {
				if (!outdatedPaths.has(entry.path)) {
					return entry;
				}
				return { ...entry, content: OUTDATED_FILE_CONTENT };
			}
			if (entry.type === "image") {
				if (pendingImageReplacements === 0) {
					return entry;
				}
				pendingImageReplacements -= 1;
				return {
					type: "text",
					text: OUTDATED_FILE_CONTENT,
				} satisfies TextContent;
			}
			if (isStructuredToolResultEntry(entry)) {
				return this.replaceOutdatedReadEntry(
					entry,
					outdatedKeys,
				) as typeof entry;
			}
			if (entry.type !== "text") {
				return entry;
			}
			const replaced = this.replaceOutdatedInString(entry.text, outdatedKeys);
			if (replaced === null) {
				return { ...entry, text: OUTDATED_FILE_CONTENT };
			}
			return replaced === entry.text ? entry : { ...entry, text: replaced };
		});
	}

	private countOutdatedImageEntries(
		text: string,
		outdatedKeys: Set<string>,
	): number {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return 0;
		}
		const entries = Array.isArray(parsed) ? parsed : [parsed];
		let count = 0;
		for (const entry of entries) {
			if (!entry || typeof entry !== "object") {
				continue;
			}
			const record = entry as Record<string, unknown>;
			const locator = this.extractLocatorFromResultEntry(record);
			if (!locator) {
				continue;
			}
			if (!outdatedKeys.has(this.toReadLocatorKey(locator))) {
				continue;
			}
			if (
				record.result === "Successfully read image" ||
				record.content === "Successfully read image"
			) {
				count += 1;
			}
		}
		return count;
	}

	private replaceOutdatedInString(
		text: string,
		outdatedKeys: Set<string>,
	): string | null {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return null;
		}
		const replaced = Array.isArray(parsed)
			? parsed.map((entry) =>
					this.replaceOutdatedReadEntry(entry, outdatedKeys),
				)
			: this.replaceOutdatedReadEntry(parsed, outdatedKeys);
		return JSON.stringify(replaced);
	}

	private replaceOutdatedReadEntry(
		entry: unknown,
		outdatedKeys: Set<string>,
	): unknown {
		if (!entry || typeof entry !== "object") {
			return entry;
		}
		const locator = this.extractLocatorFromResultEntry(entry);
		if (!locator || !outdatedKeys.has(this.toReadLocatorKey(locator))) {
			return entry;
		}
		const record = { ...(entry as Record<string, unknown>) };
		if (typeof record.result === "string") {
			record.result = OUTDATED_FILE_CONTENT;
		} else if (typeof record.content === "string") {
			record.content = OUTDATED_FILE_CONTENT;
		} else {
			record.result = OUTDATED_FILE_CONTENT;
		}
		return record;
	}

	private isReadTool(toolName: string | undefined): boolean {
		return !!toolName && READ_TOOL_NAMES.has(toolName);
	}

	/**
	 * Tool results can outlive their paired tool_use block (compacted or
	 * imported histories), so fall back to the name carried on the result
	 * itself when the id lookup misses.
	 */
	private resolveToolName(block: ToolResultContent): string | undefined {
		const cached = this.toolNameByIdCache.get(block.tool_use_id);
		if (cached !== undefined) {
			return cached;
		}
		return typeof block.name === "string" && block.name.length > 0
			? block.name.toLowerCase()
			: undefined;
	}

	private truncateToolResultContent(
		content: ToolResultContent["content"],
	): ToolResultContent["content"] {
		if (typeof content === "string") {
			return this.truncateMiddle(content);
		}
		return content.map((entry) => {
			if (entry.type === "file") {
				const next = this.truncateMiddle(entry.content);
				return next === entry.content ? entry : { ...entry, content: next };
			}
			if (entry.type === "text") {
				const next = this.truncateMiddle(entry.text);
				return next === entry.text ? entry : { ...entry, text: next };
			}
			if (isStructuredToolResultEntry(entry)) {
				return this.truncateNestedStrings(entry) as typeof entry;
			}
			return entry;
		});
	}

	/**
	 * Deep-truncates string values inside structured tool outputs (e.g.
	 * `ToolOperationResult[]` from run_commands/read_files), which carry the
	 * payload in untyped `{query, result, ...}` fields rather than text
	 * blocks. Image blocks are left intact so base64 payloads survive.
	 */
	private truncateNestedStrings(value: unknown): unknown {
		if (typeof value === "string") {
			return this.truncateMiddle(value);
		}
		if (Array.isArray(value)) {
			let changed = false;
			const next = value.map((item) => {
				const out = this.truncateNestedStrings(item);
				if (out !== item) {
					changed = true;
				}
				return out;
			});
			return changed ? next : value;
		}
		if (value !== null && typeof value === "object") {
			if (isBinaryContentLike(value)) {
				return value;
			}
			let changed = false;
			const next: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(value)) {
				const out = this.truncateNestedStrings(item);
				if (out !== item) {
					changed = true;
				}
				next[key] = out;
			}
			return changed ? next : value;
		}
		return value;
	}

	private truncateMiddle(text: string): string {
		return truncateMiddleByChars(
			text,
			this.maxToolResultChars,
			TRUNCATE_MARKER_DEFAULT,
		);
	}

	private truncateAssistantText(text: string): string {
		if (this.hasRepeatedToolCallMarkup(text)) {
			return truncateMiddleByChars(
				text,
				this.maxAssistantToolMarkupChars,
				TRUNCATE_ASSISTANT_TOOL_MARKUP_MARKER,
			);
		}
		return truncateMiddleByChars(
			text,
			this.maxAssistantTextChars,
			TRUNCATE_ASSISTANT_TEXT_MARKER,
		);
	}

	private hasRepeatedToolCallMarkup(text: string): boolean {
		if (text.length <= this.maxAssistantToolMarkupChars) {
			return false;
		}
		let count = 0;
		for (const _match of text.matchAll(TOOL_CALL_MARKUP_PATTERN)) {
			count += 1;
			if (count >= REPEATED_TOOL_CALL_MARKUP_THRESHOLD) {
				return true;
			}
		}
		return false;
	}

	private truncateToTotalTextBudget(messages: Message[]): Message[] {
		let totalBytes = this.countMessageTextBytes(messages);
		if (totalBytes <= this.maxTotalTextBytes) {
			return messages;
		}

		const next = messages.map((message) => {
			if (!Array.isArray(message.content)) {
				return { ...message };
			}
			return {
				...message,
				content: message.content.map((block) =>
					cloneContentBlockForMutation(block),
				),
			};
		});

		const candidates = this.collectTruncationCandidates(next);
		for (const candidate of candidates) {
			if (totalBytes <= this.maxTotalTextBytes) {
				break;
			}
			const currentBytes = candidate.byteLength;
			if (currentBytes <= candidate.minBytes) {
				continue;
			}
			const overflow = totalBytes - this.maxTotalTextBytes;
			const targetBytes = Math.max(candidate.minBytes, currentBytes - overflow);
			const truncated = truncateMiddleToBytes(
				candidate.get(),
				targetBytes,
				candidate.makeMarker,
			);
			candidate.set(truncated);
			totalBytes -= currentBytes - utf8ByteLength(truncated);
		}

		return next;
	}

	private countMessageTextBytes(messages: Message[]): number {
		let total = 0;
		for (const message of messages) {
			if (typeof message.content === "string") {
				total += utf8ByteLength(message.content);
				continue;
			}
			for (const block of message.content) {
				if (block.type === "text") {
					total += utf8ByteLength(block.text);
				} else if (block.type === "thinking") {
					total += utf8ByteLength(block.thinking);
				} else if (block.type === "file") {
					total += utf8ByteLength(block.content);
				} else if (block.type === "tool_use") {
					// Model-generated tool arguments ship on the wire too. Counting
					// them keeps the budget honest; if tool results alone cannot
					// absorb the overflow, oversized argument strings are truncated
					// as a last resort (see collectTruncationCandidates).
					total += countNestedStringBytes(block.input);
				} else if (block.type === "tool_result") {
					if (typeof block.content === "string") {
						total += utf8ByteLength(block.content);
					} else {
						for (const entry of block.content) {
							if (entry.type === "text") {
								total += utf8ByteLength(entry.text);
							} else if (entry.type === "file") {
								total += utf8ByteLength(entry.content);
							} else if (isStructuredToolResultEntry(entry)) {
								total += countNestedStringBytes(entry);
							}
						}
					}
				}
			}
		}
		return total;
	}

	private collectTruncationCandidates(
		messages: Message[],
	): TruncationCandidate[] {
		const resultCandidates: TruncationCandidate[] = [];
		const inputCandidates: TruncationCandidate[] = [];
		for (const message of messages) {
			if (message.role === "assistant" && typeof message.content === "string") {
				resultCandidates.push({
					byteLength: utf8ByteLength(message.content),
					minBytes: MIN_TOTAL_BUDGET_ASSISTANT_TEXT_BYTES,
					makeMarker: TRUNCATE_ASSISTANT_TEXT_BUDGET_MARKER,
					get: () => message.content as string,
					set: (value) => {
						message.content = value;
					},
				});
				continue;
			}
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type === "tool_use") {
					collectNestedStringCandidates(block.input, inputCandidates);
					continue;
				}
				if (message.role === "assistant" && block.type === "text") {
					resultCandidates.push({
						byteLength: utf8ByteLength(block.text),
						minBytes: MIN_TOTAL_BUDGET_ASSISTANT_TEXT_BYTES,
						makeMarker: TRUNCATE_ASSISTANT_TEXT_BUDGET_MARKER,
						get: () => block.text,
						set: (value) => {
							block.text = value;
						},
					});
					continue;
				}
				if (block.type !== "tool_result") {
					continue;
				}
				if (typeof block.content === "string") {
					resultCandidates.push({
						byteLength: utf8ByteLength(block.content),
						minBytes: MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES,
						makeMarker: TRUNCATE_MARKER_BUDGET,
						get: () => block.content as string,
						set: (value) => {
							block.content = value;
						},
					});
					continue;
				}
				for (const entry of block.content) {
					if (entry.type === "text") {
						resultCandidates.push({
							byteLength: utf8ByteLength(entry.text),
							minBytes: MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES,
							makeMarker: TRUNCATE_MARKER_BUDGET,
							get: () => entry.text,
							set: (value) => {
								entry.text = value;
							},
						});
					} else if (entry.type === "file") {
						resultCandidates.push({
							byteLength: utf8ByteLength(entry.content),
							minBytes: MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES,
							makeMarker: TRUNCATE_MARKER_BUDGET,
							get: () => entry.content,
							set: (value) => {
								entry.content = value;
							},
						});
					} else if (isStructuredToolResultEntry(entry)) {
						collectNestedStringCandidates(entry, resultCandidates);
					}
				}
			}
		}
		// Tool results and assistant text truncate first; model-generated
		// tool_use arguments are a last resort because some providers
		// revalidate or replay them. All three being candidates keeps the
		// budget reclaimable no matter which side carries the overflow.
		resultCandidates.sort((l, r) => r.byteLength - l.byteLength);
		inputCandidates.sort((l, r) => r.byteLength - l.byteLength);
		return [...resultCandidates, ...inputCandidates];
	}

	private applyMediaBudget(messages: Message[]): Message[] {
		const budget = this.resolveMediaBudget();
		if (
			budget.maxImageEncodedBytes === Number.POSITIVE_INFINITY &&
			budget.maxImageDecodedBytes === Number.POSITIVE_INFINITY &&
			budget.maxTotalMediaBytes === Number.POSITIVE_INFINITY
		) {
			return messages;
		}

		const state = createMediaBudgetState();
		let changed = false;
		const next = messages.map((message) => {
			if (!Array.isArray(message.content)) {
				return message;
			}
			let contentChanged = false;
			const content = message.content.map((block) => {
				const out = this.applyMediaBudgetToBlock(block, budget, state);
				if (out !== block) {
					contentChanged = true;
				}
				return out;
			});
			if (!contentChanged) {
				return message;
			}
			changed = true;
			return { ...message, content };
		});

		return changed ? next : messages;
	}

	private resolveMediaBudget(): ResolvedMediaBudget {
		return resolveMediaBudget(this.mediaBudget);
	}

	private applyMediaBudgetToBlock(
		block: ContentBlock,
		budget: ResolvedMediaBudget,
		state: MediaBudgetState,
	): ContentBlock {
		if (isImageContentLike(block)) {
			return this.limitImageContent(block, budget, state);
		}

		if (block.type !== "tool_result" || typeof block.content === "string") {
			return block;
		}

		let changed = false;
		const content = block.content.map((entry) => {
			const out = this.applyMediaBudgetToToolResultEntry(entry, budget, state);
			if (out !== entry) {
				changed = true;
			}
			return out as (typeof block.content)[number];
		});

		return changed
			? { ...block, content: content as ToolResultContent["content"] }
			: block;
	}

	private applyMediaBudgetToToolResultEntry(
		entry: unknown,
		budget: ResolvedMediaBudget,
		state: MediaBudgetState,
	): unknown {
		if (isImageContentLike(entry)) {
			return this.limitImageContent(entry, budget, state);
		}
		if (isStructuredToolResultEntry(entry)) {
			return this.limitNestedMedia(entry, budget, state);
		}
		return entry;
	}

	private limitNestedMedia(
		value: unknown,
		budget: ResolvedMediaBudget,
		state: MediaBudgetState,
	): unknown {
		if (isImageContentLike(value)) {
			const limited = this.limitImageContent(value, budget, state);
			return limited.type === "text" ? limited.text : limited;
		}

		if (Array.isArray(value)) {
			let changed = false;
			const next = value.map((item) => {
				const out = this.limitNestedMedia(item, budget, state);
				if (out !== item) {
					changed = true;
				}
				return out;
			});
			return changed ? next : value;
		}

		if (value !== null && typeof value === "object") {
			let changed = false;
			const next: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(value)) {
				const out = this.limitNestedMedia(item, budget, state);
				if (out !== item) {
					changed = true;
				}
				next[key] = out;
			}
			return changed ? next : value;
		}

		return value;
	}

	private limitImageContent(
		image: unknown,
		budget: ResolvedMediaBudget,
		state: MediaBudgetState,
	): ImageContent | TextContent {
		if (!isImageContentWithData(image)) {
			return { type: "text", text: IMAGE_OMITTED_PLACEHOLDER };
		}

		const validation = validateAndReserveImageMedia(
			image.mediaType,
			image.data,
			{
				maxImageEncodedBytes: budget.maxImageEncodedBytes,
				maxImageDecodedBytes: budget.maxImageDecodedBytes,
				maxTotalMediaBytes: budget.maxTotalMediaBytes,
			},
			state,
		);
		if (!validation.ok) {
			return { type: "text", text: IMAGE_OMITTED_PLACEHOLDER };
		}

		return {
			...image,
			data: validation.base64,
			mediaType: validation.mediaType,
		};
	}
}

const DSML_BAR = String.raw`[\|\uFF5C]`;
// Compiled once at module load; String.prototype.matchAll clones the regex
// per call, so sharing the global-flagged instance is safe.
const TOOL_CALL_MARKUP_PATTERN = new RegExp(
	String.raw`<\s*(?:${DSML_BAR}\s*)?DSML\s*(?:${DSML_BAR}\s*)?(?:tool_calls|invoke)\b[^>]*>|<\s*/?\s*(?:tool_calls?|tool_call|function_calls?|function_call|invoke)\b[^>]*>`,
	"gi",
);

function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function parsePositiveIntegerEnv(
	value: string | undefined,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeLimitEnv(
	value: string | undefined,
): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "infinity" || normalized === "disable") {
		return Number.POSITIVE_INFINITY;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizePositiveLimit(
	value: number | undefined,
	fallback: number,
): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? Math.floor(value)
		: fallback;
}

function normalizeNonNegativeLimit(
	value: number | undefined,
	fallback: number,
): number {
	if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
		return fallback;
	}
	return Number.isFinite(value) ? Math.floor(value) : value;
}

function truncateMiddleByChars(
	text: string,
	maxChars: number,
	makeMarker: (removed: number) => string,
): string {
	if (text.length <= maxChars) {
		return text;
	}
	// Two-pass: marker length depends on the removed-char count, which depends
	// on the marker length. Compute a tentative marker, derive the final
	// removed count, then build the real marker.
	const tentativeMarker = makeMarker(text.length - maxChars);
	const tentativeKeep = Math.max(
		0,
		Math.floor((maxChars - tentativeMarker.length) / 2),
	);
	const removed = Math.max(0, text.length - tentativeKeep * 2);
	const marker = makeMarker(removed);
	const keep = Math.max(0, Math.floor((maxChars - marker.length) / 2));
	const start = text.slice(0, keep);
	const end = keep > 0 ? text.slice(-keep) : "";
	return `${start}${marker}${end}`;
}

function truncateMiddleToBytes(
	text: string,
	maxBytes: number,
	makeMarker: (removed: number) => string,
): string {
	if (utf8ByteLength(text) <= maxBytes) {
		return text;
	}
	// Binary search the largest char-length whose UTF-8 byte length fits.
	let low = 0;
	let high = text.length;
	let best = truncateMiddleByChars(text, 0, makeMarker);
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const candidate = truncateMiddleByChars(text, mid, makeMarker);
		if (utf8ByteLength(candidate) <= maxBytes) {
			best = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

function cloneContentBlockForMutation(block: ContentBlock): ContentBlock {
	if (block.type === "tool_use") {
		// Inputs are budget-truncation candidates of last resort, so they need
		// the same deep-clone treatment as structured results: a shallow copy
		// would leak truncation mutations back into conversation history.
		return {
			...block,
			input: deepCloneJsonLike(block.input) as typeof block.input,
		};
	}
	if (block.type !== "tool_result" || typeof block.content === "string") {
		return { ...block };
	}
	return {
		...block,
		// Structured entries can nest the payload strings arbitrarily deep, so
		// a shallow copy would leak budget-truncation mutations back into the
		// original conversation history.
		content: block.content.map((entry) =>
			isStructuredToolResultEntry(entry)
				? (deepCloneJsonLike(entry) as typeof entry)
				: { ...entry },
		),
	};
}

/**
 * True for tool_result content entries that are not the typed text/image/file
 * blocks — i.e. structured tool outputs such as `ToolOperationResult[]`
 * entries that the runtime stores directly in the content array.
 */
function isStructuredToolResultEntry(entry: unknown): boolean {
	if (entry === null || typeof entry !== "object") {
		return false;
	}
	const type = (entry as { type?: unknown }).type;
	return type !== "text" && type !== "image" && type !== "file";
}

function isImageContentLike(value: unknown): boolean {
	return (
		value !== null &&
		typeof value === "object" &&
		(value as { type?: unknown }).type === "image"
	);
}

function isImageContentWithData(value: unknown): value is ImageContent {
	return (
		value !== null &&
		typeof value === "object" &&
		(value as { type?: unknown }).type === "image" &&
		typeof (value as { data?: unknown }).data === "string" &&
		typeof (value as { mediaType?: unknown }).mediaType === "string"
	);
}

function isBinaryContentLike(value: unknown): boolean {
	return isImageContentWithData(value);
}

function countNestedStringBytes(value: unknown): number {
	if (typeof value === "string") {
		return utf8ByteLength(value);
	}
	if (Array.isArray(value)) {
		let total = 0;
		for (const item of value) {
			total += countNestedStringBytes(item);
		}
		return total;
	}
	if (value !== null && typeof value === "object") {
		if (isBinaryContentLike(value)) {
			return 0;
		}
		let total = 0;
		for (const item of Object.values(value)) {
			total += countNestedStringBytes(item);
		}
		return total;
	}
	return 0;
}

function collectNestedStringCandidates(
	container: unknown,
	candidates: TruncationCandidate[],
): void {
	if (Array.isArray(container)) {
		container.forEach((item, index) => {
			if (typeof item === "string") {
				candidates.push({
					byteLength: utf8ByteLength(item),
					minBytes: MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES,
					makeMarker: TRUNCATE_MARKER_BUDGET,
					get: () => container[index] as string,
					set: (value) => {
						container[index] = value;
					},
				});
			} else {
				collectNestedStringCandidates(item, candidates);
			}
		});
		return;
	}
	if (container !== null && typeof container === "object") {
		if (isBinaryContentLike(container)) {
			return;
		}
		const record = container as Record<string, unknown>;
		for (const key of Object.keys(record)) {
			const item = record[key];
			if (typeof item === "string") {
				candidates.push({
					byteLength: utf8ByteLength(item),
					minBytes: MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES,
					makeMarker: TRUNCATE_MARKER_BUDGET,
					get: () => record[key] as string,
					set: (value) => {
						record[key] = value;
					},
				});
			} else {
				collectNestedStringCandidates(item, candidates);
			}
		}
	}
}

function deepCloneJsonLike(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(deepCloneJsonLike);
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			out[key] = deepCloneJsonLike(item);
		}
		return out;
	}
	return value;
}
