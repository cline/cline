import type { AgentRunResult } from "@cline/shared";
import {
	TURN_ERROR_LIMIT,
	TURN_PATH_LIMIT,
	TURN_TEXT_LIMIT,
	TURN_TOOL_LIMIT,
} from "../../config";
import { redactSecrets } from "../../context/redact";
import { isRecord } from "../../values";
import { fnv1a32, type TurnFacts, type TurnStatus } from "../candidates";
import {
	countUserRunMessages,
	isPersonMessage,
	type MessageLike,
	textOf,
} from "./run-count";
import {
	editedPaths,
	errorText,
	failedInBand,
	isPushCommand,
	mayHaveWritten,
	PUSH,
	toolCallOf,
	toolResultOf,
	WRITE_FILE_TOOL_NAMES,
} from "./tool-calls";

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
	/** The mode the chat's newest input was sent in; absent on transcripts the runtime did not wrap. */
	mode?: "act" | "plan";
};

/** The mode core's `<user_input>` wrapper names: `@cline/shared`'s `parseUserInputMode`, vendored like the run count. */
const USER_INPUT_MODE = /<user_input\b[^>]*\bmode="(act|plan|yolo)"/;

/** Redacted before it is cut, so a secret across the limit cannot leave a prefix the patterns no longer match. */
function clampRedacted(text: string, limit: number): string {
	return redactSecrets(text).trim().slice(0, limit);
}

function chatOf(message: MessageLike): Turn["chat"] {
	const { modelInfo } = message;
	return isRecord(modelInfo) &&
		typeof modelInfo.provider === "string" &&
		typeof modelInfo.id === "string"
		? { providerId: modelInfo.provider, modelId: modelInfo.id }
		: undefined;
}

/**
 * The mode of the newest input the runtime wrapped. That can follow the
 * person's message: approving a plan sends a continuation in act mode.
 */
function chatMode(messages: readonly MessageLike[]): Turn["mode"] {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		const mode = USER_INPUT_MODE.exec(textOf(message))?.[1];
		if (mode) return mode === "plan" ? "plan" : "act";
	}
	return undefined;
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
	const writes: { callId: unknown; paths: string[] }[] = [];
	const pushCallIds: unknown[] = [];
	const callNames = new Map<unknown, string>();
	const tools = new Map<string, ToolFact>();
	const unsuccessful = new Set<string>();
	let chat: Turn["chat"];
	let lastAssistantText = "";
	for (const message of messages.slice(lastUser + 1)) {
		chat = chatOf(message) ?? chat;
		if (message.role === "assistant")
			lastAssistantText = textOf(message) || lastAssistantText;
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (!isRecord(part)) continue;
			const call = toolCallOf(part);
			if (call) {
				callNames.set(call.callId, call.name);
				if (WRITE_FILE_TOOL_NAMES.has(call.name))
					writes.push({ callId: call.callId, paths: editedPaths(call.input) });
				else if (isPushCommand(call.input)) pushCallIds.push(call.callId);
				continue;
			}
			const result = toolResultOf(part);
			if (!result) continue;
			const { callId, output } = result;
			const name = result.name ?? callNames.get(callId);
			// Only an errored call is a failure the turn owes a fix for: a command
			// exiting non-zero is routine, a search with no match or a test the
			// agent went on to fix.
			const failed = result.isError;
			const error = failed
				? clampRedacted(errorText(output), TURN_ERROR_LIMIT)
				: "";
			if (name !== undefined)
				tools.set(callId, { name, failed, ...(error ? { error } : {}) });
			const pushCall = pushCallIds.includes(callId);
			const writePaths = writes.find((write) => write.callId === callId)?.paths;
			if (
				failed ||
				(failedInBand(output, pushCall ? PUSH : undefined) &&
					!(writePaths && mayHaveWritten(output, writePaths)))
			)
				unsuccessful.add(callId);
		}
	}
	/**
	 * A call that errored, such as an edit the person denied, or that reported
	 * a failure, such as an edit whose text was not found or a rejected push,
	 * changed nothing. A write that ran out of time or a patch that stopped
	 * partway is the exception: it may have written files, so its paths count.
	 */
	const succeeded = (callId: unknown) =>
		typeof callId !== "string" || !unsuccessful.has(callId);
	const paths = new Set(
		writes
			.filter((write) => succeeded(write.callId))
			.flatMap((write) => write.paths),
	);
	const mode = chatMode(messages);
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
		pushed: pushCallIds.some(succeeded),
		...(chat ? { chat } : {}),
		...(mode ? { mode } : {}),
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
 * and session status (`session.get`), when a viewer attaches to a chat with no
 * set in memory (for example, a forked chat after Undo or a reopened session).
 */
export function deriveTurnFromTranscript(
	sessionId: string,
	messages: readonly MessageLike[],
	sessionStatus = "completed",
): Turn | null {
	return turnFrom(sessionId, messages, { status: sessionStatus });
}
