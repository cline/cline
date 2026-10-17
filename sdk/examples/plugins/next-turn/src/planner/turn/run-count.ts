import type { AgentMessage } from "@cline/shared";
import { isRecord } from "../../values";

/** A message as core's run count reads it: a live `AgentMessage`, or a stored one whose content may be a string. */
export type MessageLike = {
	id?: unknown;
	role?: unknown;
	content?: unknown;
	metadata?: unknown;
	modelInfo?: unknown;
};

/** Messages the runtime injects as the user's, which the person never typed: `<hook_context>`, with or without attributes. */
const HOOK_CONTEXT = /^\s*<hook_context\b/;

/** Compaction messages: a stored span is the runs they fold, and one stands in when it is missing. */
const COMPACTION_KINDS: ReadonlySet<string> = new Set([
	"compaction",
	"compaction_summary",
]);

/** User-role messages core writes for itself, which open no run. */
const SYNTHETIC_USER_MESSAGE_KINDS: ReadonlySet<string> = new Set([
	"auto_compaction",
	"compaction_budget_emergency",
	"completion_reminder",
	"loop_detection_notice",
	"manual_compaction",
	"mistake_stop_notice",
	"recovery_notice",
]);

/** The prompts a host sends to carry a run on, which the person never typed. */
const TASK_RESUMPTION_PREFIX = "[TASK RESUMPTION]";
const ACT_MODE_APPROVAL_PROMPT =
	"The user approved switching to act mode. Continue with the approved plan now.";

/** What core reads as a message's text when it cannot see the content: not empty, so it counts. */
const UNSEEN_CONTENT_TEXT = "unknown";

/** The wrappers a host puts around the person's input, removed before the text is read. */
const USER_INPUT_PATTERNS = ["user_input", "user_command"].map((tag) => ({
	element: new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"),
	strayOpening: new RegExp(`<${tag}[^>]*>`, "g"),
}));
const MODE_NOTICE_TAG = "mode_notice";
const COMMAND_ENVELOPE = /^<user_command\b([^>]*)>([\s\S]*?)<\/user_command>$/i;
const SLASH_ATTRIBUTE = /slash="([^"]+)"/i;

/** A stored `userRunSpan` when it is a whole number of runs, zero included. */
function storedSpan(
	metadata: Record<string, unknown> | undefined,
): number | undefined {
	const span = metadata?.userRunSpan;
	return typeof span === "number" && Number.isInteger(span) && span >= 0
		? span
		: undefined;
}

/** The text a user message shows and whether it carries an attachment; media inside a tool result is the tool's, not the person's. */
function visibleContent(message: MessageLike): {
	hasAttachment: boolean;
	text: string;
} {
	if (typeof message.content === "string")
		return { hasAttachment: false, text: message.content };
	if (!Array.isArray(message.content))
		return { hasAttachment: false, text: UNSEEN_CONTENT_TEXT };
	let hasAttachment = false;
	let hasToolResult = false;
	const text: string[] = [];
	for (const item of message.content) {
		if (!isRecord(item)) continue;
		if (item.type === "text" && typeof item.text === "string")
			text.push(item.text);
		else if (item.type === "tool_result" || item.type === "tool-result")
			hasToolResult = true;
		else if (item.type === "file" || item.type === "image")
			hasAttachment = true;
	}
	return {
		hasAttachment: hasAttachment && !hasToolResult,
		text: text.join("\n"),
	};
}

/** Removes each `<tag>…</tag>` element, content included; index-based so hostile text cannot make it backtrack. */
function removeTagElements(input: string, tag: string): string {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	let result = input;
	let start = result.indexOf(open);
	while (start !== -1) {
		const end = result.indexOf(close, start + open.length);
		if (end === -1) break;
		result = result.slice(0, start) + result.slice(end + close.length);
		start = result.indexOf(open, start);
	}
	return result;
}

/** The person's input without its `<user_input>` and `<user_command>` wrappers, or a stray opening tag of either. */
function unwrapUserInput(input: string): string {
	let next = input.trim();
	for (const { element, strayOpening } of USER_INPUT_PATTERNS) {
		if (!next) return "";
		const unwrapped = next.replace(element, "$1");
		next = (
			unwrapped !== next ? unwrapped : next.replace(strayOpening, "")
		).trim();
	}
	return next;
}

/** The command a `<user_command slash="…">` envelope names, when the whole input is one. */
function commandSlash(input: string): string | undefined {
	const envelope = COMMAND_ENVELOPE.exec(input.trim());
	return (
		(envelope && SLASH_ATTRIBUTE.exec(envelope[1] ?? "")?.[1]?.trim()) ||
		undefined
	);
}

/**
 * What core shows of a user message's text (`@cline/shared`'s
 * `formatDisplayUserInput`), as far as a span reads it: the input unwrapped,
 * runtime `<mode_notice>`s removed. A slash-command envelope always shows as
 * `/` and its command, never empty and never a continuation prompt, so its
 * arguments are left out.
 */
function shownText(input: string): string {
	const slash = commandSlash(input);
	return slash
		? `/${slash}`
		: removeTagElements(unwrapUserInput(input), MODE_NOTICE_TAG).trim();
}

/**
 * How many runs a message opens, as core counts them: `@cline/core`'s
 * `getUserRunSpan` at 0.0.92, vendored so loading the plugin pulls in neither
 * `@cline/core` nor `@cline/shared`. run-count.test.ts holds it to core's own
 * answers.
 *
 * A compaction summary carries the runs it folded. A tool result, a steer, a
 * reminder, a resumption prompt and anything else the runtime writes as the
 * user's open none; so does a message that shows nothing. An attachment opens
 * one even without text.
 */
export function getUserRunSpan(message: MessageLike): number {
	if (message.role !== "user") return 0;
	const metadata = isRecord(message.metadata) ? message.metadata : undefined;
	const kind = typeof metadata?.kind === "string" ? metadata.kind : undefined;
	const stored = storedSpan(metadata);
	if (kind !== undefined && COMPACTION_KINDS.has(kind)) return stored ?? 1;
	if (stored !== undefined) return stored;
	if (kind !== undefined && SYNTHETIC_USER_MESSAGE_KINDS.has(kind)) return 0;
	const content = visibleContent(message);
	if (content.hasAttachment) return 1;
	const shown = shownText(content.text);
	if (
		!shown ||
		shown.startsWith(TASK_RESUMPTION_PREFIX) ||
		shown === ACT_MODE_APPROVAL_PROMPT
	)
		return 0;
	return 1;
}

/** The chat's runs: core's `countUserRunMessages`, the count its checkpoints and the webview number turns by. */
export function countUserRunMessages(
	messages: readonly MessageLike[] | undefined,
): number {
	let count = 0;
	for (const message of messages ?? []) count += getUserRunSpan(message);
	return count;
}

export function textOf(message: MessageLike): string {
	if (typeof message.content === "string") return message.content.trim();
	if (!Array.isArray(message.content)) return "";
	return message.content
		.flatMap((part) =>
			isRecord(part) && part.type === "text" && typeof part.text === "string"
				? [part.text]
				: [],
		)
		.join("\n")
		.trim();
}

/**
 * True for a message that opens one run of the person's: span 1, so not a
 * tool result, a steer, a reminder or a compaction summary, and not injected
 * hook context. Core marks the hook context it injects with span 0; the text
 * guard covers transcripts written before it did.
 */
export function isPersonMessage(message: MessageLike): boolean {
	return getUserRunSpan(message) === 1 && !HOOK_CONTEXT.test(textOf(message));
}

/**
 * The person's newest message as they typed it, without the wrappers and mode
 * notices the runtime adds, or undefined when there is none. Its text is empty
 * when it carried only an attachment.
 */
export function lastPersonMessage(
	messages: readonly AgentMessage[],
): { id: string; text: string } | undefined {
	const last = messages.findLast(isPersonMessage);
	return last ? { id: last.id, text: shownText(textOf(last)) } : undefined;
}
