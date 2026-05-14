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
	type ITelemetryService,
	type Message,
	normalizeUserInput,
	type TextContent,
	type ToolResultContent,
} from "@cline/shared";
import {
	captureEmergencyTruncation,
	type TelemetryAgentIdentityProperties,
} from "../../services/telemetry/core-events";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
const DEFAULT_MAX_TOTAL_TEXT_BYTES = 6_000_000;
const MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES = 8_000;
export const MESSAGE_BUILDER_CHARS_PER_TOKEN = 3;
// CLINE-2192 Layer B: when Layer A can't bring the request under the
// budget (adversarial inputs, oversized tool_use.input bodies, etc.)
// we drop the floor to this much smaller value and aggressively
// middle-truncate every string-bearing block until we fit. Small
// enough to free real budget; large enough that the block still
// carries some signal.
const EMERGENCY_FLOOR_BYTES = 256;
const TRUNCATE_MARKER_EMERGENCY = (n: number) =>
	`\n\n...[truncated ${n} chars to fit context window]...\n\n`;
// Tools whose results are large enough to need provider-payload truncation
// (per-block at maxToolResultChars and in aggregate at maxTotalTextBytes).
// Bounded-output tools (ask_question, submit_and_exit) are intentionally
// excluded. MCP tool names are dynamic and not covered here; see
// the broader compaction hardening follow-up.
const TARGET_TOOL_NAMES = new Set([
	"read",
	"read_files",
	"search",
	"search_codebase",
	"bash",
	"run_commands",
	"editor",
	"apply_patch",
	"fetch_web_content",
	"skills",
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
 * Options for `MessageBuilder.buildForApi`. The Layer A budget knob
 * (`maxInputTokens`) plus the Layer B observability surface for the
 * brick-wall byte-budget guarantee (CLINE-2192).
 */
export interface BuildForApiOptions {
	maxInputTokens?: number;
	/**
	 * Explicit byte budget for the serialized Message[] payload. Callers that
	 * know the full provider request overhead can pass the remaining
	 * message-list budget here; it overrides the maxInputTokens-derived budget.
	 */
	maxRequestBytes?: number;
	/**
	 * Bytes reserved by the caller for non-message request payload. Used with
	 * maxInputTokens to derive the message-list budget:
	 * maxInputTokens * MESSAGE_BUILDER_CHARS_PER_TOKEN - requestOverheadBytes.
	 */
	requestOverheadBytes?: number;
	/**
	 * Per-turn status-notice channel. When Layer B's emergency
	 * truncation fires we emit `"compacted to fit context window"`
	 * so the TUI/webview surfaces a visible signal to the user.
	 */
	emitStatusNotice?: (
		message: string,
		metadata?: Record<string, unknown>,
	) => void;
	/** Per-session telemetry sink for `task.emergency_truncation`. */
	telemetry?: ITelemetryService;
	sessionId?: string;
	provider?: string;
	modelId?: string;
	agentIdentity?: Partial<TelemetryAgentIdentityProperties>;
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

	buildForApi(
		messages: Message[],
		options: BuildForApiOptions = {},
	): Message[] {
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

		const messageBudgetBytes = this.resolveMessageBudgetBytes(options);
		const afterLayerA = this.truncateToTotalTextBudget(
			prepared,
			messageBudgetBytes,
		);
		// CLINE-2192 Layer B: hard guarantee. If Layer A's largest-first
		// candidate-set heuristic couldn't bring the request under the
		// budget (adversarial inputs, oversized tool_use.input bodies,
		// many small blocks below Layer A's floor), drop to the
		// emergency floor and brick-wall the bytes. Always degrades,
		// never throws.
		if (messageBudgetBytes !== undefined && messageBudgetBytes >= 0) {
			return this.enforceHardByteBudget(
				afterLayerA,
				options,
				messageBudgetBytes,
			);
		}
		return afterLayerA;
	}

	private resolveMessageBudgetBytes(
		options: BuildForApiOptions,
	): number | undefined {
		if (
			typeof options.maxRequestBytes === "number" &&
			Number.isFinite(options.maxRequestBytes)
		) {
			return Math.max(0, options.maxRequestBytes);
		}
		if (
			typeof options.maxInputTokens !== "number" ||
			!Number.isFinite(options.maxInputTokens) ||
			options.maxInputTokens <= 0
		) {
			return undefined;
		}
		const requestOverheadBytes =
			typeof options.requestOverheadBytes === "number" &&
			Number.isFinite(options.requestOverheadBytes)
				? Math.max(0, options.requestOverheadBytes)
				: 0;
		return Math.max(
			0,
			options.maxInputTokens * MESSAGE_BUILDER_CHARS_PER_TOKEN -
				requestOverheadBytes,
		);
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

	private truncateToTotalTextBudget(
		messages: Message[],
		messageBudgetBytes?: number,
	): Message[] {
		// CLINE-2191: when the orchestrator threads the model's actual
		// maxInputTokens, derive the aggregate cap from it. Otherwise
		// fall back to the historical 6 MB default so legacy callers
		// (existing tests, direct constructors) behave identically.
		const effectiveBudget = messageBudgetBytes ?? this.maxTotalTextBytes;
		if (effectiveBudget <= 0) {
			return messages;
		}

		let totalBytes = this.countMessageTextBytes(messages);
		if (totalBytes <= effectiveBudget) {
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
			if (totalBytes <= effectiveBudget) {
				break;
			}
			const currentBytes = candidate.byteLength;
			if (currentBytes <= MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES) {
				continue;
			}
			const overflow = totalBytes - effectiveBudget;
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
				// CLINE-2191: also collect candidates for the block types
				// that previously bypassed the aggregate budget. These
				// share the existing `MIN_TOTAL_BUDGET_TOOL_RESULT_BYTES`
				// floor; truncating below that loses too much signal.
				//
				// `thinking` and `redacted_thinking` are intentionally
				// skipped: signatures/details are tied to the original
				// reasoning payload, so middle-truncating the text can make
				// providers reject the request. Layer B may remove those
				// blocks whole if the request still exceeds budget.
				// `tool_use` and its `input` body are skipped here too; a JSON-aware
				// structural truncator that can drill into values
				// without corrupting `tool_use_id`s or breaking JSON
				// shape is the responsibility of Layer B (CLINE-2192).
				if (block.type === "text") {
					candidates.push({
						byteLength: utf8ByteLength(block.text),
						get: () => block.text,
						set: (value) => {
							block.text = value;
						},
					});
					continue;
				}
				if (block.type === "file") {
					// Note: transformBlock already applied per-block
					// truncation to file content (via truncateMiddle at
					// maxToolResultChars). The candidate here allows Layer A
					// to apply a second, tighter cut when the aggregate
					// budget is still exceeded after per-block truncation.
					candidates.push({
						byteLength: utf8ByteLength(block.content),
						get: () => block.content,
						set: (value) => {
							block.content = value;
						},
					});
					continue;
				}
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
		// CLINE-2191: deterministic tiebreaker on insertion order so
		// the same input always produces the same truncation output.
		// Layer B (CLINE-2192) will rely on this same invariant.
		const indexed = candidates.map((candidate, originalIndex) => ({
			candidate,
			originalIndex,
		}));
		indexed.sort(
			(l, r) =>
				r.candidate.byteLength - l.candidate.byteLength ||
				l.originalIndex - r.originalIndex,
		);
		return indexed.map(({ candidate }) => candidate);
	}

	/**
	 * CLINE-2192 Layer B: the brick-wall byte-budget pass. Runs after
	 * Layer A. If the input is already under budget this is a no-op
	 * and the input array is returned unchanged.
	 *
	 * If still over budget, two passes:
	 *
	 *  1. Aggressive middle-truncation of EVERY string-bearing block
	 *     (including `tool_use.input` string leaves), dropping the
	 *     per-block floor to `EMERGENCY_FLOOR_BYTES`. `tool_use_id`,
	 *     `id`, `call_id`, `name` strings are excluded.
	 *  2. If pass 1 didn't fit (extremely unlikely, but possible if
	 *     the preservation set itself exceeds the budget), drop
	 *     non-essential blocks (oldest assistant text/thinking
	 *     blocks first, then oldest tool pairs atomically). The
	 *     typed prompt (turn-start user) and the last assistant are
	 *     last in the drop order.
	 *
	 * On any non-zero work performed: emits `task.emergency_truncation`
	 * telemetry and a status notice so the operator sees the degraded
	 * state in the TUI/webview.
	 */
	private enforceHardByteBudget(
		messages: Message[],
		options: BuildForApiOptions,
		budgetBytes: number,
	): Message[] {
		if (budgetBytes < 0) {
			return messages;
		}
		const bytesBefore = countProviderRequestBytes(messages);
		if (bytesBefore <= budgetBytes) {
			return messages;
		}

		// Deep-clone so we don't mutate the input.
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

		// Pass 1: aggressive middle-truncation, EMERGENCY_FLOOR_BYTES floor.
		const candidates = collectEmergencyCandidates(next);
		let totalBytes = countProviderRequestBytes(next);
		let truncatedBlocks = 0;
		for (const candidate of candidates) {
			if (totalBytes <= budgetBytes) {
				break;
			}
			const currentBytes = candidate.byteLength;
			if (currentBytes <= EMERGENCY_FLOOR_BYTES) {
				continue;
			}
			const overflow = totalBytes - budgetBytes;
			const targetBytes = Math.max(
				EMERGENCY_FLOOR_BYTES,
				currentBytes - overflow,
			);
			const truncated = truncateMiddleToBytes(
				candidate.get(),
				targetBytes,
				TRUNCATE_MARKER_EMERGENCY,
			);
			candidate.set(truncated);
			totalBytes = countProviderRequestBytes(next);
			truncatedBlocks += 1;
		}

		// Pass 2: if even floor-truncation didn't fit, drop blocks.
		const droppedBlocks = dropOldestUntilFits(next, budgetBytes);

		// Block removal can leave messages with content: []. Providers
		// reject empty content arrays, so prune those messages out.
		for (let i = next.length - 1; i >= 0; i -= 1) {
			const m = next[i];
			if (Array.isArray(m.content) && m.content.length === 0) {
				next.splice(i, 1);
			}
		}

		const bytesAfter = countProviderRequestBytes(next);

		if (truncatedBlocks > 0 || droppedBlocks > 0) {
			options.emitStatusNotice?.("compacted to fit context window", {
				kind: "emergency_truncation",
				maxInputTokens: options.maxInputTokens,
				bytesBefore,
				bytesAfter,
				truncatedBlocks,
				droppedBlocks,
			});
			captureEmergencyTruncation(options.telemetry, {
				ulid: options.sessionId ?? options.agentIdentity?.conversationId ?? "",
				bytesBefore,
				bytesAfter,
				maxInputTokens: options.maxInputTokens ?? 0,
				truncatedBlocks,
				droppedBlocks,
				provider: options.provider,
				modelId: options.modelId,
				...options.agentIdentity,
			});
		}

		return next;
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
	if (block.type === "tool_use") {
		return {
			...block,
			input: cloneJsonLike(block.input) as Record<string, unknown>,
		};
	}
	if (block.type !== "tool_result" || typeof block.content === "string") {
		return { ...block };
	}
	return {
		...block,
		content: block.content.map((entry) => ({ ...entry })),
	};
}

function cloneJsonLike(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => cloneJsonLike(entry));
	}
	if (value && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			result[key] = cloneJsonLike(entry);
		}
		return result;
	}
	return value;
}

function countProviderRequestBytes(messages: Message[]): number {
	// CLINE-2192: provider payloads include JSON framing, tool names,
	// tool ids, object keys and scalar arguments — not just string
	// leaf contents. Counting the JSON-serialized message list is a
	// conservative byte-budget proxy and is the metric Layer B must
	// force under `maxInputTokens * MESSAGE_BUILDER_CHARS_PER_TOKEN`.
	try {
		return utf8ByteLength(JSON.stringify(messages));
	} catch {
		return messages.reduce(
			(total, message) => total + utf8ByteLength(String(message)),
			0,
		);
	}
}
/**
 * CLINE-2192 Layer B: collect every string-bearing block location the
 * brick-wall byte-budget pass may middle-truncate. Strictly wider
 * than Layer A's set — it also includes the string leaves inside
 * `tool_use.input`.
 *
 * What IS excluded from string truncation:
 * - `redacted_thinking.data` — Anthropic-encrypted opaque blob; truncation
 *   produces invalid data. Handled by block removal in pass 2.
 * - `image.data` and tool-result image entries — raw base64; truncation
 *   produces invalid base64. Handled by block removal in pass 2.
 *
 * What is NOT excluded (intentional in emergency territory):
 * - String-valued input parameters named `id`, `name`, etc. within
 *   `tool_use.input`. These are parameter values, not provider-level
 *   identifiers. The actual block-level `block.id` and `block.name` are
 *   safe because `collectStringLeaves` only traverses `block.input`,
 *   never the block itself.
 *
 * Order is deterministic: walk message-by-message, block-by-block;
 * within each `tool_use.input`, walk the JSON tree depth-first with
 * lexicographic key order. The final sort is largest-first with
 * insertion-order tiebreaker (same property Layer A uses).
 */
function collectEmergencyCandidates(
	messages: Message[],
): TruncationCandidate[] {
	const candidates: TruncationCandidate[] = [];
	for (const message of messages) {
		if (typeof message.content === "string") {
			candidates.push({
				byteLength: utf8ByteLength(message.content),
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
			if (block.type === "text") {
				candidates.push({
					byteLength: utf8ByteLength(block.text),
					get: () => block.text,
					set: (value) => {
						block.text = value;
					},
				});
				continue;
			}
			if (block.type === "thinking") {
				candidates.push({
					byteLength: utf8ByteLength(block.thinking),
					get: () => block.thinking,
					set: (value) => {
						block.thinking = value;
					},
				});
				continue;
			}
			if (block.type === "redacted_thinking") {
				// `data` is an Anthropic-encrypted opaque blob. Middle-
				// truncating it produces binary garbage that the provider
				// rejects with a 400. Exclude from string truncation;
				// collectBlockRemovalCandidates handles whole-block removal.
				continue;
			}
			if (block.type === "file") {
				candidates.push({
					byteLength: utf8ByteLength(block.content),
					get: () => block.content,
					set: (value) => {
						block.content = value;
					},
				});
				continue;
			}
			if (block.type === "image") {
				// `data` is raw base64. Middle-truncating it produces
				// invalid base64 that the provider rejects with a 400.
				// Exclude from string truncation; whole-block removal
				// is handled by collectBlockRemovalCandidates.
				continue;
			}
			if (block.type === "tool_result") {
				if (typeof block.content === "string") {
					candidates.push({
						byteLength: utf8ByteLength(block.content),
						get: () => block.content as string,
						set: (value) => {
							block.content = value;
						},
					});
				} else {
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
						} else if (entry.type === "image") {
							// base64 data — same as top-level image blocks,
							// middle-truncation produces invalid base64. Skip;
							// whole-block removal is the right lever here.
						}
					}
				}
				continue;
			}
			if (block.type === "tool_use") {
				collectStringLeaves(block.input, (get, set) => {
					candidates.push({
						byteLength: utf8ByteLength(get()),
						get,
						set,
					});
				});
				continue;
			}
		}
	}
	return candidates
		.map((candidate, originalIndex) => ({ candidate, originalIndex }))
		.sort(
			(l, r) =>
				r.candidate.byteLength - l.candidate.byteLength ||
				l.originalIndex - r.originalIndex,
		)
		.map(({ candidate }) => candidate);
}

/**
 * Walks a value (typically `tool_use.input`) depth-first with
 * lexicographic key order and invokes the visitor for every string
 * leaf with a `get`/`set` pair that reads/writes the leaf in place.
 * Non-string leaves (numbers, booleans, null) are not visited.
 * Arrays-of-strings ARE visited per-index.
 *
 * This function is called with `block.input`, never with the block
 * itself, so block-level fields like `block.id` and `block.name` are
 * always outside the traversal scope.
 */
function collectStringLeaves(
	node: unknown,
	visit: (get: () => string, set: (value: string) => void) => void,
): void {
	if (Array.isArray(node)) {
		for (let i = 0; i < node.length; i += 1) {
			const value = node[i];
			if (typeof value === "string") {
				visit(
					() => node[i] as string,
					(next) => {
						node[i] = next;
					},
				);
			} else {
				collectStringLeaves(value, visit);
			}
		}
		return;
	}
	if (node && typeof node === "object") {
		const obj = node as Record<string, unknown>;
		for (const key of Object.keys(obj).sort()) {
			const value = obj[key];
			if (typeof value === "string") {
				visit(
					() => obj[key] as string,
					(next) => {
						obj[key] = next;
					},
				);
			} else {
				collectStringLeaves(value, visit);
			}
		}
	}
}

/**
 * CLINE-2192 Layer B pass 2: when even floor-truncating every
 * string leaf still leaves the request over budget, blank out
 * remaining string-bearing payloads until it fits. This is intentionally
 * brutal but structured: ids, tool names, object keys, booleans,
 * numbers, nulls, arrays and object shapes are preserved. A tool call
 * may fail because an argument string became empty, but the provider
 * request will fit and the agent can recover in the next turn.
 */
function dropOldestUntilFits(messages: Message[], budgetBytes: number): number {
	let droppedBlocks = 0;

	// Sub-pass 1: zero out string payloads (cheaper than block removal and
	// preserves JSON shape so the provider can still parse the request).
	// Candidates are snapshot at entry; set("") mutates in place so later
	// candidates with get().length === 0 are naturally skipped.
	const stringCandidates = collectEmergencyCandidates(messages);
	for (const candidate of stringCandidates) {
		if (countProviderRequestBytes(messages) <= budgetBytes) {
			break;
		}
		if (candidate.get().length === 0) {
			continue;
		}
		candidate.set("");
		droppedBlocks += 1;
	}

	if (countProviderRequestBytes(messages) <= budgetBytes) {
		return droppedBlocks;
	}

	// Sub-pass 2: remove entire blocks. Recompute collectBlockRemovalCandidates
	// after each removal to avoid stale messageIndex/blockIndex references —
	// splice shifts indices within a message and a frozen candidate list would
	// silently miss or wrong-remove subsequent blocks.
	while (countProviderRequestBytes(messages) > budgetBytes) {
		const blockCandidates = collectBlockRemovalCandidates(messages);
		if (blockCandidates.length === 0) {
			break;
		}
		if (!removeBlocks(messages, blockCandidates[0].blocks)) {
			break; // No progress; avoid an infinite loop.
		}
		droppedBlocks += blockCandidates[0].blocks.length;
	}

	return droppedBlocks;
}

interface BlockRef {
	messageIndex: number;
	blockIndex: number;
}

interface BlockRemovalCandidate {
	priority: number;
	messageIndex: number;
	blockIndex: number;
	blocks: BlockRef[];
}

function collectBlockRemovalCandidates(
	messages: Message[],
): BlockRemovalCandidate[] {
	const toolRefs = new Map<string, BlockRef[]>();
	const candidates: BlockRemovalCandidate[] = [];
	const lastAssistantIndex = findLastAssistantMessageIndex(messages);

	for (
		let messageIndex = 0;
		messageIndex < messages.length;
		messageIndex += 1
	) {
		const message = messages[messageIndex];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (
			let blockIndex = 0;
			blockIndex < message.content.length;
			blockIndex += 1
		) {
			const block = message.content[blockIndex];
			if (block.type === "tool_use") {
				const refs = toolRefs.get(block.id) ?? [];
				refs.push({ messageIndex, blockIndex });
				toolRefs.set(block.id, refs);
			} else if (block.type === "tool_result") {
				const refs = toolRefs.get(block.tool_use_id) ?? [];
				refs.push({ messageIndex, blockIndex });
				toolRefs.set(block.tool_use_id, refs);
			}
		}
	}

	for (
		let messageIndex = 0;
		messageIndex < messages.length;
		messageIndex += 1
	) {
		const message = messages[messageIndex];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (
			let blockIndex = 0;
			blockIndex < message.content.length;
			blockIndex += 1
		) {
			const block = message.content[blockIndex];
			const priority = getDropPriority(
				message,
				messageIndex,
				lastAssistantIndex,
			);
			if (block.type === "tool_use") {
				candidates.push({
					priority,
					messageIndex,
					blockIndex,
					blocks: toolRefs.get(block.id) ?? [{ messageIndex, blockIndex }],
				});
				continue;
			}
			if (block.type === "tool_result") {
				candidates.push({
					priority,
					messageIndex,
					blockIndex,
					blocks: toolRefs.get(block.tool_use_id) ?? [
						{ messageIndex, blockIndex },
					],
				});
				continue;
			}
			candidates.push({
				priority,
				messageIndex,
				blockIndex,
				blocks: [{ messageIndex, blockIndex }],
			});
		}
	}

	return candidates.sort(
		(a, b) =>
			a.priority - b.priority ||
			a.messageIndex - b.messageIndex ||
			a.blockIndex - b.blockIndex,
	);
}

function getDropPriority(
	message: Message,
	messageIndex: number,
	lastAssistantIndex: number,
): number {
	if (message.role === "assistant" && messageIndex !== lastAssistantIndex) {
		return 0;
	}
	if (message.role === "user" && messageIndex !== 0) {
		return 1;
	}
	if (message.role === "assistant") {
		return 2;
	}
	return 3;
}

function findLastAssistantMessageIndex(messages: Message[]): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "assistant") {
			return index;
		}
	}
	return -1;
}

function removeBlocks(messages: Message[], refs: BlockRef[]): boolean {
	let didRemove = false;
	const refsByMessage = new Map<number, number[]>();
	for (const ref of refs) {
		const indexes = refsByMessage.get(ref.messageIndex) ?? [];
		indexes.push(ref.blockIndex);
		refsByMessage.set(ref.messageIndex, indexes);
	}
	for (const [messageIndex, blockIndexes] of refsByMessage) {
		const message = messages[messageIndex];
		if (!message || !Array.isArray(message.content)) {
			continue;
		}
		for (const blockIndex of [...new Set(blockIndexes)].sort((a, b) => b - a)) {
			if (blockIndex >= 0 && blockIndex < message.content.length) {
				message.content.splice(blockIndex, 1);
				didRemove = true;
			}
		}
	}
	return didRemove;
}
