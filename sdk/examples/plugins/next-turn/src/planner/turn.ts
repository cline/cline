import type { AgentMessage, AgentRunResult } from "@cline/shared";
import {
	TURN_ERROR_LIMIT,
	TURN_PATH_LIMIT,
	TURN_TEXT_LIMIT,
	TURN_TOOL_LIMIT,
} from "../config";
import { redactSecrets } from "../context/redact";
import { isRecord } from "../values";
import { fnv1a32, type TurnFacts, type TurnStatus } from "./candidates";

/**
 * The turn that just ended, from the run result `afterRun` hands the plugin,
 * or from the hub's transcript when no run is in memory.
 *
 * The turn's identity is core's run count: hosts and
 * checkpoints all number runs with `@cline/core`'s `getUserRunSpan`, so the
 * plugin counts the same way and its turn key names the same turn theirs
 * does. Only the messages after the person's last message count toward the
 * facts. Nothing here judges prose: the request and reply are carried,
 * redacted and then bounded, for the model to read; the facts are tool names,
 * errors and edited paths.
 */

type ToolFact = { name: string; failed: boolean; error?: string };

/** What the planner reads of the turn, bounded here because a transcript is a trust boundary. */
export type TurnContext = {
	request: string;
	reply: string;
	tools: readonly ToolFact[];
	editedPaths: readonly string[];
};

export type Turn = {
	runId?: string;
	/** The person's message this turn answers; a later run on the same message is not a new turn. */
	userMessageId: string;
	/** The chat's runs, counted the way core counts them: the turn key's ordinal. */
	runCount: number;
	/** `<sessionId>:<runCount>`, the turn a set follows. */
	turnKey: string;
	/**
	 * The turn key, hashed: names this chat position, so a set computed for it
	 * can tell when the chat moved on. Never a core message id, which the
	 * webview cannot see.
	 */
	revision: string;
	facts: TurnFacts;
	context: TurnContext;
	/** A command this turn ran pushed the branch. */
	pushed: boolean;
	/** The chat's provider and model, from the last reply. */
	chat?: { providerId: string; modelId: string };
};

/** A message as core's run count reads it: a live `AgentMessage`, or a stored one whose content may be a string. */
export type MessageLike = {
	id?: unknown;
	role?: unknown;
	content?: unknown;
	metadata?: unknown;
	modelInfo?: unknown;
};

/** The tool names that write files: `editor` today, the legacy names on old transcripts, and patches. */
const WRITE_FILE_TOOL_NAMES: ReadonlySet<string> = new Set([
	"editor",
	"write_to_file",
	"replace_in_file",
	"apply_patch",
]);

const PUSH = /\bgit\s+push\b|\bgh\s+pr\s+(?:create|merge|ready)\b/;
const PATCH_FILE_LINE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

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
 * `@cline/core` nor `@cline/shared`. turn.test.ts holds it to core's own
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

export function editedPaths(input: unknown): string[] {
	if (typeof input === "string")
		return [...input.matchAll(PATCH_FILE_LINE)].flatMap((match) =>
			match[1] ? [match[1].trim()] : [],
		);
	if (!isRecord(input)) return [];
	for (const key of ["path", "file_path", "filePath"]) {
		const value = input[key];
		if (typeof value === "string" && value.trim()) return [value.trim()];
	}
	for (const key of ["input", "patch"]) {
		if (typeof input[key] === "string") return editedPaths(input[key]);
	}
	return [];
}

/** True when a tool call pushed or opened a PR, from its input; nothing of the input is kept. */
function isPushCommand(input: unknown): boolean {
	try {
		return PUSH.test(
			typeof input === "string" ? input : JSON.stringify(input ?? ""),
		);
	} catch {
		return false;
	}
}

function textOf(message: MessageLike): string {
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

function errorText(output: unknown): string {
	if (typeof output === "string") return output;
	if (isRecord(output) && typeof output.error === "string") return output.error;
	try {
		return JSON.stringify(output) ?? "";
	} catch {
		return "";
	}
}

/** Redacted before it is cut, so a secret across the limit cannot leave a prefix the patterns no longer match. */
function clampRedacted(text: string, limit: number): string {
	return redactSecrets(text).trim().slice(0, limit);
}

/**
 * True for a message that opens one run of the person's: span 1, so not a
 * tool result, a steer, a reminder or a compaction summary, and not injected
 * hook context. Core marks the hook context it injects with span 0; the text
 * guard covers transcripts written before it did.
 */
function isPersonMessage(message: MessageLike): boolean {
	return getUserRunSpan(message) === 1 && !HOOK_CONTEXT.test(textOf(message));
}

/** The person's newest message, or undefined when there is none. Its text is empty when it carried only an attachment. */
export function lastPersonMessage(
	messages: readonly AgentMessage[],
): { id: string; text: string } | undefined {
	const last = messages.findLast(isPersonMessage);
	return last ? { id: last.id, text: textOf(last) } : undefined;
}

function chatOf(message: MessageLike): Turn["chat"] {
	const { modelInfo } = message;
	return isRecord(modelInfo) &&
		typeof modelInfo.provider === "string" &&
		typeof modelInfo.id === "string"
		? { providerId: modelInfo.provider, modelId: modelInfo.id }
		: undefined;
}

function turnStatus(status: string): TurnStatus {
	if (status === "failed") return "failed";
	if (status === "aborted" || status === "cancelled") return "cancelled";
	return "completed";
}

/** The turn, or null when the transcript holds no message from the person. */
function turnFrom(
	sessionId: string,
	messages: readonly MessageLike[],
	run: { status: string; runId?: string; reply?: string },
): Turn | null {
	const lastUser = messages.findLastIndex(isPersonMessage);
	const user = messages[lastUser];
	if (!user) return null;
	const runCount = countUserRunMessages(messages);
	const turnKey = `${sessionId}:${runCount}`;
	const paths = new Set<string>();
	const tools = new Map<string, ToolFact>();
	let pushed = false;
	let chat: Turn["chat"];
	let lastAssistantText = "";
	for (const message of messages.slice(lastUser + 1)) {
		chat = chatOf(message) ?? chat;
		if (message.role === "assistant")
			lastAssistantText = textOf(message) || lastAssistantText;
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isRecord(part)) continue;
			if (part.type === "tool-call" && typeof part.toolName === "string") {
				if (WRITE_FILE_TOOL_NAMES.has(part.toolName))
					for (const path of editedPaths(part.input)) paths.add(path);
				else if (isPushCommand(part.input)) pushed = true;
			} else if (
				part.type === "tool-result" &&
				typeof part.toolCallId === "string" &&
				typeof part.toolName === "string"
			) {
				const failed = part.isError === true;
				const error = failed
					? clampRedacted(errorText(part.output), TURN_ERROR_LIMIT)
					: "";
				tools.set(part.toolCallId, {
					name: part.toolName,
					failed,
					...(error ? { error } : {}),
				});
			}
		}
	}
	const toolFacts = [...tools.values()];
	const userMessageId =
		typeof user.id === "string" && user.id.trim().length > 0
			? user.id.trim()
			: `msg_${runCount}`;
	const runId =
		run.runId ??
		(isRecord(user.metadata) && typeof user.metadata.runId === "string"
			? user.metadata.runId
			: undefined);
	return {
		...(runId ? { runId } : {}),
		userMessageId,
		runCount,
		turnKey,
		revision: fnv1a32(turnKey),
		facts: {
			status: turnStatus(run.status),
			filesEdited: paths.size,
			toolErrored: toolFacts.some((tool) => tool.failed),
		},
		context: {
			request: clampRedacted(textOf(user), TURN_TEXT_LIMIT),
			reply: clampRedacted(run.reply ?? lastAssistantText, TURN_TEXT_LIMIT),
			tools: toolFacts.slice(-TURN_TOOL_LIMIT),
			editedPaths: [...paths].slice(0, TURN_PATH_LIMIT),
		},
		pushed,
		...(chat ? { chat } : {}),
	};
}

export function deriveTurn(
	sessionId: string,
	result: AgentRunResult,
): Turn | null {
	return turnFrom(sessionId, result.messages, {
		status: result.status,
		runId: result.runId,
		reply: result.outputText,
	});
}

/**
 * Derives a turn from persisted or hub-returned transcript messages (`session.messages`)
 * and session status (`session.get`), when `current` is invoked on a chat with no
 * set in memory (for example, a forked chat after Undo or a reopened session).
 */
export function deriveTurnFromTranscript(
	sessionId: string,
	messages: readonly MessageLike[],
	sessionStatus = "completed",
): Turn | null {
	return turnFrom(sessionId, messages, { status: sessionStatus });
}
