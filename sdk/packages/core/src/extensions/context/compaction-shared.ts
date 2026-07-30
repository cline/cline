import type { ModelInfo, ToolResultContent } from "@cline/llms";
import {
	CHARS_PER_TOKEN,
	estimateTokens,
	type MessageWithMetadata,
} from "@cline/shared";

export { CHARS_PER_TOKEN, estimateTokens };

import type { CoreCompactionSummarizerConfig } from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";

export const DEFAULT_MAX_INPUT_TOKENS = 128_000;
/** Estimate the usable input share when only a context window is reported. */
export const CONTEXT_WINDOW_INPUT_RATIO = 0.9;
/** Compact once the transcript consumes this share of the usable input budget. */
export const COMPACTION_TRIGGER_RATIO = 0.9;
export const DEFAULT_TARGET_RATIO = 0.7;
export const DEFAULT_PRESERVE_RECENT_TOKENS = 20_000;
export const DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 1_024;
export const TOOL_RESULT_CHAR_LIMIT = 2_000;
export const FILE_CONTENT_CHAR_LIMIT = 2_000;
export const MIN_TRUNCATED_MESSAGE_TOKENS = 8;
export const DETERMINISTIC_RESULT_PER_ENTRY_CHAR_LIMIT = 800;
export const DETERMINISTIC_RESULT_AGGREGATE_CHAR_LIMIT = 3_200;
/** Commands longer than this are truncated in compacted summaries. */
export const COMMAND_SUMMARY_CHAR_LIMIT = 100;
const DETERMINISTIC_RESULT_MAX_ENTRIES = 12;
const DETERMINISTIC_RESULT_MIN_BODY_CHARS = 80;
const DETERMINISTIC_RESULT_HEADING = "## Deterministic completed tool facts";

export interface FileOperationSummary {
	readFiles: string[];
	modifiedFiles: string[];
}

export interface CompactionSummaryMetadata {
	kind: "compaction_summary";
	summary: string;
	details: FileOperationSummary;
	tokensBefore: number;
	generatedAt: number;
}

interface CompletedToolFact {
	toolName: string;
	label: string;
	body: string;
	success: boolean;
}

export type EstimateMessageTokens = (message: MessageWithMetadata) => number;

function isPositiveFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Resolve the model's usable prompt budget. A reported input limit is
 * authoritative but cannot exceed the context window. When the model only
 * reports a context window, retain a conservative margin for request overhead.
 */
export function resolveEffectiveMaxInputTokens(
	input: Pick<ModelInfo, "maxInputTokens" | "contextWindow">,
): number | undefined {
	const contextWindow = isPositiveFiniteNumber(input.contextWindow)
		? input.contextWindow
		: undefined;
	const maxInputTokens = isPositiveFiniteNumber(input.maxInputTokens)
		? input.maxInputTokens
		: undefined;

	if (maxInputTokens !== undefined) {
		return contextWindow === undefined
			? maxInputTokens
			: Math.min(maxInputTokens, contextWindow);
	}

	return contextWindow === undefined
		? undefined
		: contextWindow * CONTEXT_WINDOW_INPUT_RATIO;
}

export function truncateText(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

function truncateRepresentativeText(text: string, limit: number): string {
	if (text.length <= limit) {
		return text;
	}
	const marker = `\n...[truncated ${text.length - limit} chars]...\n`;
	const available = Math.max(2, limit - marker.length);
	const headLength = Math.ceil(available / 2);
	const tailLength = Math.floor(available / 2);
	return `${text.slice(0, headLength)}${marker}${text.slice(-tailLength)}`;
}

function serializeStructuredToolResultBlock(block: unknown): string {
	if (typeof block === "string") {
		return block;
	}
	if (!block || typeof block !== "object" || Array.isArray(block)) {
		return String(block ?? "");
	}
	const record = block as Record<string, unknown>;
	if (typeof record.result === "string") {
		const query =
			typeof record.query === "string" && record.query.trim()
				? `[${record.query.trim()}]\n`
				: "";
		return `${query}${record.result}`;
	}
	try {
		return JSON.stringify(block);
	} catch {
		return String(block);
	}
}

function boundedToolFactLabel(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= COMMAND_SUMMARY_CHAR_LIMIT
		? normalized
		: `${normalized.slice(0, COMMAND_SUMMARY_CHAR_LIMIT)}...`;
}

function toolUseLabel(name: string, input: Record<string, unknown>): string {
	if (name === "run_commands") {
		const commands = Array.isArray(input.commands)
			? input.commands.filter(
					(command): command is string =>
						typeof command === "string" && command.trim().length > 0,
				)
			: typeof input.command === "string"
				? [input.command]
				: [];
		if (commands.length > 0) {
			return commands.map(boundedToolFactLabel).join(" | ");
		}
	}
	const paths = collectPaths(input);
	if (paths.length > 0) {
		return paths.map(boundedToolFactLabel).join(", ");
	}
	return boundedToolFactLabel(formatToolInput(input));
}

function contentFacts(
	content: ToolResultContent["content"],
	fallbackLabel: string,
): Array<{ label: string; body: string; success?: boolean }> {
	if (typeof content === "string") {
		return [{ label: fallbackLabel, body: content }];
	}
	const facts: Array<{ label: string; body: string; success?: boolean }> = [];
	const fallbackParts: string[] = [];
	for (const block of content as unknown[]) {
		if (block && typeof block === "object" && !Array.isArray(block)) {
			const record = block as Record<string, unknown>;
			if (typeof record.result === "string") {
				facts.push({
					label:
						typeof record.query === "string" && record.query.trim()
							? record.query.trim()
							: fallbackLabel,
					body: record.result,
					success:
						typeof record.success === "boolean" ? record.success : undefined,
				});
				continue;
			}
			if (record.type === "text" && typeof record.text === "string") {
				fallbackParts.push(record.text);
				continue;
			}
			if (record.type === "file" && typeof record.content === "string") {
				const path =
					typeof record.path === "string" ? record.path : fallbackLabel;
				facts.push({ label: path, body: record.content });
				continue;
			}
			if (record.type === "image") {
				fallbackParts.push("[image result]");
				continue;
			}
		}
		fallbackParts.push(serializeStructuredToolResultBlock(block));
	}
	if (fallbackParts.length > 0 || facts.length === 0) {
		facts.push({
			label: fallbackLabel,
			body: fallbackParts.join("\n") || "(completed with no textual output)",
		});
	}
	return facts;
}

/**
 * Extract completed, paired tool outputs as plain text for deterministic
 * preservation in an agentic summary. Newest results come first so aggregate
 * truncation favors the active completed tool block.
 */
function collectCompletedToolFacts(
	messages: MessageWithMetadata[],
): CompletedToolFact[] {
	const uses = new Map<
		string,
		{ name: string; input: Record<string, unknown> }
	>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				uses.set(block.id, {
					name: block.name,
					input: block.input ?? {},
				});
			}
		}
	}

	const facts: CompletedToolFact[] = [];
	for (
		let messageIndex = messages.length - 1;
		messageIndex >= 0;
		messageIndex -= 1
	) {
		const message = messages[messageIndex];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (
			let blockIndex = message.content.length - 1;
			blockIndex >= 0;
			blockIndex -= 1
		) {
			const block = message.content[blockIndex];
			if (block.type !== "tool_result") {
				continue;
			}
			const use = uses.get(block.tool_use_id);
			if (!use) {
				continue;
			}
			const fallbackLabel = toolUseLabel(use.name, use.input);
			for (const fact of contentFacts(block.content, fallbackLabel)) {
				facts.push({
					toolName: use.name,
					label: fact.label,
					body: fact.body,
					success: fact.success !== false && block.is_error !== true,
				});
			}
		}
	}
	return facts;
}

function toolFactPrefix(fact: CompletedToolFact): string {
	const label = fact.label ? ` — ${boundedToolFactLabel(fact.label)}` : "";
	return `- ${fact.toolName}${label} (${fact.success ? "completed" : "failed"}):\n`;
}

export function buildDeterministicToolContext(
	messages: MessageWithMetadata[],
	aggregateCharLimit = DETERMINISTIC_RESULT_AGGREGATE_CHAR_LIMIT,
): string {
	const instruction =
		"Use these completed results to finish the user's task now. Do not ask for this content or repeat these tool calls unless a result is marked failed.";
	const heading = `${DETERMINISTIC_RESULT_HEADING}\n${instruction}`;
	const facts = collectCompletedToolFacts(messages).slice(
		0,
		DETERMINISTIC_RESULT_MAX_ENTRIES,
	);
	if (facts.length === 0 || aggregateCharLimit <= heading.length + 2) {
		return "";
	}

	let selected = facts;
	while (selected.length > 0) {
		const fixedChars =
			heading.length +
			2 +
			selected.reduce(
				(total, fact) => total + toolFactPrefix(fact).length,
				0,
			) +
			Math.max(0, selected.length - 1) * 2;
		const bodyBudget = Math.min(
			DETERMINISTIC_RESULT_PER_ENTRY_CHAR_LIMIT,
			Math.floor((aggregateCharLimit - fixedChars) / selected.length),
		);
		if (bodyBudget >= DETERMINISTIC_RESULT_MIN_BODY_CHARS) {
			const entries = selected.map(
				(fact) =>
					`${toolFactPrefix(fact)}${truncateRepresentativeText(fact.body, bodyBudget)}`,
			);
			return `${heading}\n\n${entries.join("\n\n")}`;
		}
		// The aggregate cap is authoritative. Drop the oldest result first;
		// current completed tool-block facts were collected newest-first.
		selected = selected.slice(0, -1);
	}
	return "";
}

export function mergeDeterministicToolContext(options: {
	current: string;
	previous?: string;
	aggregateCharLimit?: number;
}): string {
	const limit =
		options.aggregateCharLimit ?? DETERMINISTIC_RESULT_AGGREGATE_CHAR_LIMIT;
	const current = options.current.trim();
	const previous = options.previous?.trim() ?? "";
	if (!current) {
		return truncateRepresentativeText(previous, limit);
	}
	if (!previous) {
		return truncateRepresentativeText(current, limit);
	}
	return truncateRepresentativeText(
		`${current}\n\nEarlier preserved tool facts:\n${previous}`,
		limit,
	);
}

export function appendDeterministicToolContext(
	summary: string,
	deterministicContext: string,
): string {
	const withoutCopiedContext = summary
		.split(new RegExp(`^${DETERMINISTIC_RESULT_HEADING}$`, "m"))[0]
		.trim();
	return deterministicContext.trim()
		? `${withoutCopiedContext}\n\n${deterministicContext.trim()}`.trim()
		: withoutCopiedContext;
}

export function extractDeterministicToolContext(summary: string): string {
	const markerIndex = summary.indexOf(DETERMINISTIC_RESULT_HEADING);
	return markerIndex >= 0 ? summary.slice(markerIndex).trim() : "";
}

export function flattenToolResultContent(
	content: ToolResultContent["content"],
): string {
	const truncated = truncateToolResultContentForCompaction(content);
	if (typeof truncated === "string") {
		return truncated;
	}
	return truncated
		.map((block) => {
			switch (block.type) {
				case "text":
					return block.text;
				case "file":
					return `<file path="${block.path}">\n${block.content}\n</file>`;
				case "image":
					return `[image:${block.mediaType}]`;
				default:
					return serializeStructuredToolResultBlock(block);
			}
		})
		.join("\n");
}

export function truncateToolResultContentForCompaction(
	content: ToolResultContent["content"],
): ToolResultContent["content"] {
	if (typeof content === "string") {
		return truncateRepresentativeText(content, TOOL_RESULT_CHAR_LIMIT);
	}
	return content.map((block) => {
		switch (block.type) {
			case "text":
				return {
					...block,
					text: truncateRepresentativeText(block.text, TOOL_RESULT_CHAR_LIMIT),
				};
			case "file":
				return {
					...block,
					content: truncateRepresentativeText(
						block.content,
						FILE_CONTENT_CHAR_LIMIT,
					),
				};
			case "image":
				return block;
			default:
				// Runtime tool adapters may return structured payloads rather than
				// provider-native text/file blocks (read_files uses
				// { query, result, success }). Convert those payloads into bounded
				// text so the summary sees representative content instead of
				// retaining an untruncatable object that the budgeter later drops.
				return {
					type: "text",
					text: truncateRepresentativeText(
						serializeStructuredToolResultBlock(block),
						TOOL_RESULT_CHAR_LIMIT,
					),
				};
		}
	});
}

export function truncateToolResultsForCompaction(
	messages: MessageWithMetadata[],
): MessageWithMetadata[] {
	return messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		let changed = false;
		const content = message.content.map((block) => {
			if (block.type !== "tool_result") {
				return block;
			}
			changed = true;
			return {
				...block,
				content: truncateToolResultContentForCompaction(block.content),
			};
		});
		return changed ? { ...message, content } : message;
	});
}

export function formatToolInput(input: Record<string, unknown>): string {
	return Object.entries(input)
		.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
		.join(", ");
}

export function serializeMessage(message: MessageWithMetadata): string {
	if (typeof message.content === "string") {
		return `[${message.role === "user" ? "User" : "Bot"}]: ${message.content}`;
	}
	const lines: string[] = [];
	for (const block of message.content) {
		switch (block.type) {
			case "text":
				lines.push(
					`[${message.role === "user" ? "User" : "Bot"}]: ${block.text}`,
				);
				break;
			case "thinking":
				lines.push(`[Bot thinking]: ${truncateText(block.thinking, 2_000)}`);
				break;
			case "redacted_thinking":
				lines.push("[Bot thinking]: [redacted]");
				break;
			case "tool_use":
				lines.push(
					`[Bot tool calls]: ${block.name}(${formatToolInput(block.input)})`,
				);
				break;
			case "tool_result":
				lines.push(`[Tool result]: ${flattenToolResultContent(block.content)}`);
				break;
			case "file":
				lines.push(
					`[${message.role === "user" ? "User" : "Bot"} file ${block.path}]: ${truncateText(block.content, FILE_CONTENT_CHAR_LIMIT)}`,
				);
				break;
			case "image":
				lines.push(
					`[${message.role === "user" ? "User" : "Bot"} image]: ${block.mediaType}`,
				);
				break;
		}
	}
	return lines.join("\n");
}

export function serializeConversation(messages: MessageWithMetadata[]): string {
	return messages.map(serializeMessage).join("\n\n").trim();
}

export function createTokenEstimator(): EstimateMessageTokens {
	const cache = new WeakMap<object, number>();
	return (message) => {
		const ref = message as unknown as object;
		const cached = cache.get(ref);
		if (typeof cached === "number") {
			return cached;
		}
		let serialized: string;
		try {
			serialized = JSON.stringify(message);
		} catch {
			serialized = serializeMessage(message);
		}
		const value = estimateTokens(serialized.length);
		cache.set(ref, value);
		return value;
	};
}

export function isCompactionSummaryMessage(
	message: MessageWithMetadata,
): boolean {
	return (
		(message.metadata as { kind?: string } | undefined)?.kind ===
		"compaction_summary"
	);
}

export function getCompactionSummaryMetadata(
	message: MessageWithMetadata,
): CompactionSummaryMetadata | undefined {
	if (!isCompactionSummaryMessage(message)) {
		return undefined;
	}
	const metadata = message.metadata as Record<string, unknown> | undefined;
	if (!metadata) {
		return undefined;
	}
	const details = metadata.details as Record<string, unknown> | undefined;
	return {
		kind: "compaction_summary",
		summary: String(metadata.summary ?? ""),
		details: {
			readFiles: Array.isArray(details?.readFiles)
				? details.readFiles
						.filter((value): value is string => typeof value === "string")
						.map((value) => value.trim())
						.filter((value) => value.length > 0)
				: [],
			modifiedFiles: Array.isArray(details?.modifiedFiles)
				? details.modifiedFiles
						.filter((value): value is string => typeof value === "string")
						.map((value) => value.trim())
						.filter((value) => value.length > 0)
				: [],
		},
		tokensBefore: Number(metadata.tokensBefore ?? 0),
		generatedAt: Number(metadata.generatedAt ?? 0),
	};
}

export function isToolResultOnlyUserMessage(
	message: MessageWithMetadata,
): boolean {
	if (message.role !== "user" || !Array.isArray(message.content)) {
		return false;
	}
	return (
		message.content.length > 0 &&
		message.content.every((block) => block.type === "tool_result")
	);
}

export function isTurnStartMessage(message: MessageWithMetadata): boolean {
	return (
		message.role === "user" &&
		!isToolResultOnlyUserMessage(message) &&
		!isCompactionSummaryMessage(message)
	);
}

export function findFirstUserMessageIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = 0; index < messages.length; index += 1) {
		if (isTurnStartMessage(messages[index])) {
			return index;
		}
	}
	return -1;
}

export function findLastTurnStartIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isTurnStartMessage(messages[index])) {
			return index;
		}
	}
	return 0;
}

export function findLastAssistantIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "assistant") {
			return index;
		}
	}
	return -1;
}

export function findLatestSummaryIndex(
	messages: MessageWithMetadata[],
): number {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isCompactionSummaryMessage(messages[index])) {
			return index;
		}
	}
	return -1;
}

/**
 * A cut boundary is safe when starting the preserved tail there cannot
 * orphan half of a tool_use/tool_result pair. Typed user turns qualify,
 * and so do assistant messages: an assistant's tool_use keeps its results
 * in the user message that follows it, so both halves stay on the same
 * side of the cut. A tool_result-only user message is never safe — its
 * matching tool_use sits in the preceding assistant message and would be
 * folded into the summary, leaving an orphaned tool_result the provider
 * rejects.
 */
function isSafeCutBoundary(message: MessageWithMetadata): boolean {
	return message.role === "assistant" || isTurnStartMessage(message);
}

export function findCutIndex(
	messages: MessageWithMetadata[],
	preserveRecentTokens: number,
	estimateMessageTokens: EstimateMessageTokens,
): number {
	let total = 0;
	let candidate = messages.length;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		total += estimateMessageTokens(messages[index]);
		candidate = index;
		if (total >= preserveRecentTokens) {
			break;
		}
	}

	if (candidate <= 0) {
		return 0;
	}

	// Never summarize away the latest typed user prompt: when one exists
	// past index 0, the cut stays at or before it so that whole turn
	// survives verbatim. Transcripts without a later typed turn (a single
	// task followed by one long tool loop, or a projection that starts
	// with a compaction summary) still cut at the token-budget candidate.
	const lastTurnStartIndex = findLastTurnStartIndex(messages);
	const cut =
		lastTurnStartIndex > 0
			? Math.min(candidate, lastTurnStartIndex)
			: candidate;
	// Snap to a safe boundary by walking FORWARD (toward the tail) first:
	// preserving less than the budget asked for always compacts harder,
	// while walking backward can degenerate into preserving nearly the
	// whole transcript — e.g. a run of tool_result-only messages from
	// parallel tool calls right after the first assistant turn walks the
	// cut all the way back to index 1. The forward walk never passes the
	// latest typed user turn because that turn is itself a safe boundary.
	let forwardCut = cut;
	while (
		forwardCut < messages.length &&
		!isSafeCutBoundary(messages[forwardCut])
	) {
		forwardCut += 1;
	}
	if (forwardCut < messages.length) {
		return forwardCut;
	}
	// The end of the transcript is also a safe boundary. This occurs when a
	// single-task turn ends with tool results and no later assistant/typed-user
	// message. Folding the whole completed tool block is preferable to walking
	// backward to its assistant tool_use and preserving every heavy result.
	if (forwardCut === messages.length) {
		let trailingToolBlockStart = messages.length;
		while (
			trailingToolBlockStart > 0 &&
			isToolResultOnlyUserMessage(messages[trailingToolBlockStart - 1])
		) {
			trailingToolBlockStart -= 1;
		}
		if (
			trailingToolBlockStart > 0 &&
			messages[trailingToolBlockStart - 1].role === "assistant"
		) {
			return forwardCut;
		}
	}
	// A malformed/dangling result block has no assistant tool_use to fold with.
	// Preserve it by falling back to the nearest earlier safe boundary.
	let backwardCut = cut;
	while (backwardCut > 0 && !isSafeCutBoundary(messages[backwardCut])) {
		backwardCut -= 1;
	}
	return backwardCut;
}

export function collectPaths(value: unknown): string[] {
	if (typeof value === "string" && value.trim().length > 0) {
		return [value];
	}
	if (Array.isArray(value)) {
		return value.flatMap((item) => collectPaths(item));
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const paths: string[] = [];
		for (const key of [
			"path",
			"file_path",
			"target_file",
			"new_file_path",
			"old_file_path",
		]) {
			paths.push(...collectPaths(record[key]));
		}
		if (Array.isArray(record.files)) {
			for (const item of record.files) {
				if (item && typeof item === "object") {
					paths.push(...collectPaths((item as Record<string, unknown>).path));
				}
			}
		}
		if (Array.isArray(record.file_paths)) {
			paths.push(...collectPaths(record.file_paths));
		}
		return paths;
	}
	return [];
}

export function mergeUnique(base: string[], next: Iterable<string>): string[] {
	const seen = new Set(base);
	for (const value of next) {
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}
		seen.add(trimmed);
	}
	return [...seen].sort((a, b) => a.localeCompare(b));
}

export function extractFileOps(
	messages: MessageWithMetadata[],
): FileOperationSummary {
	let readFiles: string[] = [];
	let modifiedFiles: string[] = [];
	for (const message of messages) {
		const summaryMetadata = getCompactionSummaryMetadata(message);
		if (summaryMetadata) {
			readFiles = mergeUnique(readFiles, summaryMetadata.details.readFiles);
			modifiedFiles = mergeUnique(
				modifiedFiles,
				summaryMetadata.details.modifiedFiles,
			);
			continue;
		}
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "file") {
				readFiles = mergeUnique(readFiles, [block.path]);
				continue;
			}
			if (block.type !== "tool_use") {
				continue;
			}
			const paths = collectPaths(block.input);
			if (block.name === "read_files") {
				readFiles = mergeUnique(readFiles, paths);
				continue;
			}
			if (block.name === "editor" || block.name === "apply_patch") {
				modifiedFiles = mergeUnique(modifiedFiles, paths);
			}
		}
	}
	return { readFiles, modifiedFiles };
}

/**
 * Compact record of the tool work performed inside a span of dropped
 * messages: which files were read and edited (with line ranges when
 * known) and which commands ran.
 */
export interface ToolActivitySummary {
	readFiles: string[];
	editedFiles: string[];
	commands: string[];
}

export function hasToolActivity(summary: ToolActivitySummary): boolean {
	return (
		summary.readFiles.length > 0 ||
		summary.editedFiles.length > 0 ||
		summary.commands.length > 0
	);
}

function pushUniqueEntry(list: string[], value: string): void {
	const trimmed = value.trim();
	if (trimmed && !list.includes(trimmed)) {
		list.push(trimmed);
	}
}

function truncateCommandForSummary(command: string): string {
	if (command.length <= COMMAND_SUMMARY_CHAR_LIMIT) {
		return command;
	}
	return `${command.slice(0, COMMAND_SUMMARY_CHAR_LIMIT)}...`;
}

function formatReadFileEntry(
	record: Record<string, unknown>,
): string | undefined {
	const path = typeof record.path === "string" ? record.path.trim() : "";
	if (!path) {
		return undefined;
	}
	const start = record.start_line;
	const end = record.end_line;
	if (typeof start === "number" && typeof end === "number") {
		return `${path}:${start}-${end}`;
	}
	return path;
}

/**
 * Pull the edited line range out of an editor tool result. Editor results
 * embed a numbered diff (`-467: ...` / `+467: ...`), usually inside a
 * JSON-encoded payload's `result` field; the range is the min/max line
 * number seen. Returns undefined when no diff line numbers are found.
 */
function extractDiffLineRange(
	content: ToolResultContent["content"],
): { start: number; end: number } | undefined {
	let text =
		typeof content === "string"
			? content
			: content
					.map((block) =>
						block.type === "text"
							? block.text
							: block.type === "file"
								? block.content
								: "",
					)
					.join("\n");
	try {
		const parsed = JSON.parse(text) as { result?: unknown };
		if (parsed && typeof parsed.result === "string") {
			text = parsed.result;
		}
	} catch {
		// Not JSON-encoded; scan the raw text.
	}
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const match of text.matchAll(/(?:^|\n|\\n)[-+](\d+): /g)) {
		const line = Number(match[1]);
		if (!Number.isFinite(line)) {
			continue;
		}
		start = Math.min(start, line);
		end = Math.max(end, line);
	}
	return start <= end ? { start, end } : undefined;
}

/**
 * Summarize the tool work inside a span of messages that compaction is
 * dropping. Read ranges come from read_files inputs; edited ranges come
 * from the numbered diff in the matching editor result when present.
 */
export function summarizeToolActivity(
	messages: MessageWithMetadata[],
): ToolActivitySummary {
	const readFiles: string[] = [];
	const editedFiles: string[] = [];
	const commands: string[] = [];
	const editorPathsByToolUseId = new Map<string, string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				const input = (block.input ?? {}) as Record<string, unknown>;
				if (block.name === "read_files") {
					if (Array.isArray(input.files)) {
						for (const file of input.files) {
							if (file && typeof file === "object") {
								const entry = formatReadFileEntry(
									file as Record<string, unknown>,
								);
								if (entry) {
									pushUniqueEntry(readFiles, entry);
								}
							}
						}
					} else {
						for (const path of collectPaths(input)) {
							pushUniqueEntry(readFiles, path);
						}
					}
					continue;
				}
				if (block.name === "editor" || block.name === "apply_patch") {
					const path = collectPaths(input)[0];
					if (path) {
						editorPathsByToolUseId.set(block.id, path);
					}
					continue;
				}
				if (block.name === "run_commands") {
					const commandList = Array.isArray(input.commands)
						? input.commands
						: [];
					for (const command of commandList) {
						if (typeof command === "string" && command.trim()) {
							pushUniqueEntry(
								commands,
								truncateCommandForSummary(command.trim()),
							);
						}
					}
				}
				continue;
			}
			if (block.type === "tool_result") {
				const path = editorPathsByToolUseId.get(block.tool_use_id);
				if (!path) {
					continue;
				}
				const range = extractDiffLineRange(block.content);
				pushUniqueEntry(
					editedFiles,
					range ? `${path}:${range.start}-${range.end}` : path,
				);
				editorPathsByToolUseId.delete(block.tool_use_id);
			}
		}
	}
	// Editor calls whose results fell outside the span still count as edits.
	for (const path of editorPathsByToolUseId.values()) {
		pushUniqueEntry(editedFiles, path);
	}
	return { readFiles, editedFiles, commands };
}

export function formatToolActivitySummary(
	summary: ToolActivitySummary,
): string {
	return [
		`Files read:\n${summary.readFiles.join("\n")}`,
		`Files edited:\n${summary.editedFiles.join("\n")}`,
		`Commands ran:\n${summary.commands.join("\n")}`,
	].join("\n\n");
}

export function renderFilesSection(fileOps: FileOperationSummary): string {
	const readLines =
		fileOps.readFiles.length > 0
			? fileOps.readFiles.map((path) => `- ${path}`).join("\n")
			: "- none";
	const modifiedLines =
		fileOps.modifiedFiles.length > 0
			? fileOps.modifiedFiles.map((path) => `- ${path}`).join("\n")
			: "- none";
	return `## Files\nRead:\n${readLines}\nModified:\n${modifiedLines}`;
}

export function ensureFilesSection(
	summary: string,
	fileOps: FileOperationSummary,
): string {
	if (/^## Files$/im.test(summary)) {
		return summary.trim();
	}
	return `${summary.trim()}\n\n${renderFilesSection(fileOps)}`.trim();
}

export function buildSummaryRequest(options: {
	previousSummary?: string;
	conversationText: string;
	fileOps: FileOperationSummary;
}): string {
	const parts: string[] = [
		`Summarize this session for continuation. Be concise and factual.
Treat successful tool results as completed work. Preserve the task goal and
the key facts from tool outputs needed to finish it. If the requested
information is already present, say that it was obtained and make the next
step answer or synthesize it directly; never ask the user to provide content
that a tool result already supplied. Record concrete findings, not a plan to
record or synthesize them later.

## Goal
One sentence: what is being built or fixed.

## State
- Done: completed steps
- In Progress: current work
- Blocked: blockers or open questions

## Highlights
Key technical choices or notable findings (omit if none).

## Next
Immediate next steps.

## Files
Read: ${options.fileOps.readFiles.join(", ") || "none"}
Edited: ${options.fileOps.modifiedFiles.join(", ") || "none"}`,
	];

	if (options.previousSummary?.trim()) {
		parts.push(`Previous summary:\n${options.previousSummary.trim()}`);
	}

	parts.push(`Conversation:\n${options.conversationText || "(empty)"}`);

	return parts.join("\n\n");
}

export function resolveSummarizerConfig(options: {
	activeProviderConfig: ProviderConfig;
	summarizer?: CoreCompactionSummarizerConfig;
}): ProviderConfig {
	const summarizer = options.summarizer;
	const withSummarizerDefaults = (config: ProviderConfig): ProviderConfig => {
		if (config.providerId === "openai-codex") {
			const { maxOutputTokens: _maxOutputTokens, ...rest } = config;
			return {
				...rest,
				thinking: false,
			};
		}
		return {
			...config,
			maxOutputTokens:
				config.maxOutputTokens ?? DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS,
			thinking: false,
		};
	};
	if (!summarizer) {
		return withSummarizerDefaults(options.activeProviderConfig);
	}
	const baseProviderConfig =
		summarizer.providerConfig?.providerId === summarizer.providerId
			? summarizer.providerConfig
			: undefined;
	return withSummarizerDefaults({
		...(baseProviderConfig ?? {}),
		providerId: summarizer.providerId,
		modelId: summarizer.modelId,
		apiKey: summarizer.apiKey ?? baseProviderConfig?.apiKey,
		baseUrl: summarizer.baseUrl ?? baseProviderConfig?.baseUrl,
		headers: summarizer.headers ?? baseProviderConfig?.headers,
		modelInfo: summarizer.modelInfo ?? baseProviderConfig?.modelInfo,
		knownModels: summarizer.knownModels ?? baseProviderConfig?.knownModels,
		maxOutputTokens:
			summarizer.maxOutputTokens ?? DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS,
	});
}

export function buildSummaryMessage(options: {
	summary: string;
	fileOps: FileOperationSummary;
	tokensBefore: number;
}): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "text",
				text: `Context summary:\n\n${options.summary}`,
			},
		],
		metadata: {
			kind: "compaction_summary",
			summary: options.summary,
			details: options.fileOps,
			tokensBefore: options.tokensBefore,
			generatedAt: Date.now(),
		} satisfies CompactionSummaryMetadata,
	};
}
