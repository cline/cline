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
	type Message,
	normalizeUserInput,
	type TextContent,
	type ToolResultContent,
} from "@cline/shared";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
const DEFAULT_MAX_TOTAL_TEXT_BYTES = 6_000_000;
const MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES = 8_000;
const TARGET_TOOL_NAMES = new Set([
	"read",
	"read_files",
	"search",
	"search_codebase",
	"bash",
	"run_commands",
]);
const READ_TOOL_NAMES = new Set(["read", "read_files"]);
const OUTDATED_FILE_CONTENT = "[outdated - see the latest file content]";
const MISSING_TOOL_RESULT_TEXT =
	"Tool execution was interrupted before a result was produced.";
const TRUNCATE_MARKER_DEFAULT = (n: number) =>
	`\n\n...[truncated ${n} chars]...\n\n`;
const TRUNCATE_MARKER_BUDGET = (n: number) =>
	`\n\n...[truncated ${n} chars to fit provider request budget]...\n\n`;

interface ReadLocator {
	path: string;
	startLine: number | null;
	endLine: number | null;
}

interface TruncationCandidate {
	byteLength: number;
	get(): string;
	set(value: string): void;
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

	constructor(
		private readonly maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
		private readonly targetToolNames = TARGET_TOOL_NAMES,
		private readonly maxTotalTextBytes = DEFAULT_MAX_TOTAL_TEXT_BYTES,
	) {}

	buildForApi(messages: Message[]): Message[] {
		this.reindex(messages);
		const repairedMessages = this.addMissingToolResults(messages);

		const prepared = repairedMessages.map((message) => {
			if (!Array.isArray(message.content)) {
				if (message.role === "user" && typeof message.content === "string") {
					const normalized = normalizeUserInput(message.content);
					if (normalized !== message.content) {
						return { ...message, content: normalized };
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

		return this.truncateToTotalTextBudget(prepared);
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

		if (block.type === "file") {
			const truncated = this.truncateMiddle(block.content);
			return truncated === block.content
				? block
				: { ...block, content: truncated };
		}

		if (block.type !== "tool_result") {
			return block;
		}

		const toolName = this.toolNameByIdCache.get(block.tool_use_id);
		let nextContent = block.content;

		if (this.isReadTool(toolName) && block.is_error !== true) {
			const locators = this.getReadLocators(block);
			if (locators.length > 0) {
				const outdated = locators.filter((locator) =>
					this.isOutdatedReadLocator(locator, block.tool_use_id),
				);
				if (outdated.length > 0) {
					nextContent = this.replaceOutdatedReadContent(nextContent, outdated);
				}
			}
		}

		if (this.shouldTruncateTool(toolName)) {
			nextContent = this.truncateToolResultContent(nextContent);
		}

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
					const toolName = this.toolNameByIdCache.get(block.tool_use_id);
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
		for (const entry of content) {
			if (entry.type !== "text") {
				continue;
			}
			const locators = this.tryParseReadLocators(entry.text);
			if (locators.length > 0) {
				return locators;
			}
		}
		return [];
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

	private parseReadQuery(query: string): ReadLocator {
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

		// Two-pass over content array: first count outdated image entries embedded
		// in text payloads (those need to convert image siblings → text). Second
		// pass rewrites entries.
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

	private shouldTruncateTool(toolName: string | undefined): boolean {
		return !!toolName && this.targetToolNames.has(toolName);
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
			if (entry.type !== "text") {
				return entry;
			}
			const next = this.truncateMiddle(entry.text);
			return next === entry.text ? entry : { ...entry, text: next };
		});
	}

	private truncateMiddle(text: string): string {
		return truncateMiddleByChars(
			text,
			this.maxToolResultChars,
			TRUNCATE_MARKER_DEFAULT,
		);
	}

	private truncateToTotalTextBudget(messages: Message[]): Message[] {
		if (this.maxTotalTextBytes <= 0) {
			return messages;
		}

		let totalBytes = this.countMessageTextBytes(messages);
		if (totalBytes <= this.maxTotalTextBytes) {
			return messages;
		}

		const next = messages.map((message) => {
			if (!Array.isArray(message.content)) {
				return message;
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
			if (currentBytes <= MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES) {
				continue;
			}
			const overflow = totalBytes - this.maxTotalTextBytes;
			const targetBytes = Math.max(
				MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES,
				currentBytes - overflow,
			);
			const truncated = truncateMiddleToBytes(
				candidate.get(),
				targetBytes,
				TRUNCATE_MARKER_BUDGET,
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
				} else if (block.type === "tool_result") {
					if (typeof block.content === "string") {
						total += utf8ByteLength(block.content);
					} else {
						for (const entry of block.content) {
							if (entry.type === "text") {
								total += utf8ByteLength(entry.text);
							} else if (entry.type === "file") {
								total += utf8ByteLength(entry.content);
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
		const candidates: TruncationCandidate[] = [];
		for (const message of messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type !== "tool_result") {
					continue;
				}
				const toolName = this.toolNameByIdCache.get(block.tool_use_id);
				if (!this.shouldTruncateTool(toolName)) {
					continue;
				}
				if (typeof block.content === "string") {
					candidates.push({
						byteLength: utf8ByteLength(block.content),
						get: () => block.content as string,
						set: (value) => {
							block.content = value;
						},
					});
					continue;
				}
				for (const entry of block.content) {
					if (entry.type === "text") {
						candidates.push({
							byteLength: utf8ByteLength(entry.text),
							get: () => entry.text,
							set: (value) => {
								entry.text = value;
							},
						});
					} else if (entry.type === "file") {
						candidates.push({
							byteLength: utf8ByteLength(entry.content),
							get: () => entry.content,
							set: (value) => {
								entry.content = value;
							},
						});
					}
				}
			}
		}
		return candidates.sort((l, r) => r.byteLength - l.byteLength);
	}
}

function utf8ByteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
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
	if (block.type !== "tool_result" || typeof block.content === "string") {
		return { ...block };
	}
	return {
		...block,
		content: block.content.map((entry) => ({ ...entry })),
	};
}
