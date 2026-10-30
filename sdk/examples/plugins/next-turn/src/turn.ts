import type { AgentMessage, AgentRunResult } from "@cline/shared";
import { redactSecrets } from "./planner/redact";
import type {
	NextTurnStatus,
	ProviderChoice,
	ToolFact,
	TurnContext,
	TurnFacts,
} from "./types";

const WRITE_TOOLS = new Set([
	"editor",
	"write_to_file",
	"replace_in_file",
	"apply_patch",
]);
const PATCH_TARGET = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
const USER_INPUT_MODE = /<user_input\b[^>]*\bmode="(act|plan|yolo)"/;
const USER_ENVELOPE = /<\/?(?:user_input|mode_notice)\b[^>]*>/g;

export const TURN_TEXT_LIMIT = 1_500;
export const TURN_TOOL_LIMIT = 8;
export const TURN_ERROR_LIMIT = 300;
export const TURN_PATH_LIMIT = 8;
const ELISION = "\n[…]\n";

function editedPaths(input: unknown): string[] {
	const fields: { path?: unknown; input?: unknown } =
		input && typeof input === "object" ? input : {};
	const patch = typeof input === "string" ? input : fields.input;
	if (typeof patch === "string")
		return [...patch.matchAll(PATCH_TARGET)].flatMap(
			(match) => match[1]?.trim() || [],
		);
	return typeof fields.path === "string" && fields.path.length > 0
		? [fields.path]
		: [];
}

/** The newest real user prompt, and only the messages after it: those belong to this turn. */
function finishedTurn(messages: readonly AgentMessage[]): {
	prompt: AgentMessage | undefined;
	turn: readonly AgentMessage[];
} {
	const at = messages.findLastIndex(
		(message) => message.role === "user" && message.metadata?.userRunSpan !== 0,
	);
	return { prompt: messages[at], turn: messages.slice(at + 1) };
}

function statusOf(result: AgentRunResult): NextTurnStatus {
	return result.status === "aborted"
		? "cancelled"
		: result.status === "failed"
			? "failed"
			: "completed";
}

function outputFailed(output: unknown): boolean {
	if (Array.isArray(output)) return output.some(outputFailed);
	return (
		typeof output === "object" &&
		output !== null &&
		"success" in output &&
		output.success === false
	);
}

function outputErrorText(output: unknown): string {
	if (typeof output === "string") return output;
	if (Array.isArray(output))
		return output
			.filter(outputFailed)
			.map(outputErrorText)
			.filter((text) => text.length > 0)
			.join("\n");
	if (typeof output === "object" && output !== null && "error" in output)
		return typeof output.error === "string" ? output.error : "";
	return "";
}

function toolResultFailed(part: {
	isError?: boolean;
	output: unknown;
}): boolean {
	return part.isError === true || outputFailed(part.output);
}

/** Write calls that changed nothing (an errored call) are forgotten; the rest keep their paths. */
function scanTurn(turn: readonly AgentMessage[]): {
	edits: Map<string, string[]>;
	toolErrored: boolean;
} {
	const edits = new Map<string, string[]>();
	let toolErrored = false;
	for (const message of turn) {
		for (const part of message.content) {
			if (part.type === "tool-call" && WRITE_TOOLS.has(part.toolName))
				edits.set(part.toolCallId, editedPaths(part.input));
			else if (part.type === "tool-result" && toolResultFailed(part)) {
				toolErrored = true;
				edits.delete(part.toolCallId);
			}
		}
	}
	return { edits, toolErrored };
}

export function factsOf(
	messages: readonly AgentMessage[],
	result: AgentRunResult,
): TurnFacts {
	const { edits, toolErrored } = scanTurn(finishedTurn(messages).turn);
	const named = [...edits.values()];
	const pathless = named.filter((paths) => paths.length === 0).length;
	return {
		status: statusOf(result),
		filesEdited: new Set(named.flat()).size + pathless,
		toolErrored,
	};
}

function textOf(message: AgentMessage): string {
	return message.content
		.flatMap((part) => (part.type === "text" ? part.text : []))
		.join("\n");
}

function errorText(output: unknown): string {
	if (typeof output === "string") return output;
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

/** A long reply's start and end: the agent's summary and closing question sit at the end, which a plain cut drops. */
function clampEnds(text: string, limit: number): string {
	const clean = redactSecrets(text).trim();
	if (clean.length <= limit) return clean;
	const tail = Math.floor(((limit - ELISION.length) * 2) / 3);
	const head = limit - ELISION.length - tail;
	return `${clean.slice(0, head).trimEnd()}${ELISION}${clean.slice(-tail).trimStart()}`;
}

export type TurnSummary = {
	facts: TurnFacts;
	context: TurnContext;
	/** The mode the chat's newest input was sent in; absent on input the runtime did not wrap. */
	mode?: "act" | "plan";
	/** The provider and model of the chat's last reply: the planner's provider. */
	chat?: ProviderChoice;
};

function chatOf(messages: readonly AgentMessage[]): ProviderChoice | undefined {
	const info = messages.findLast(
		(message) => message.role === "assistant" && message.modelInfo,
	)?.modelInfo;
	return info?.provider && info.id
		? { providerId: info.provider, modelId: info.id }
		: undefined;
}

function modeOf(messages: readonly AgentMessage[]): TurnSummary["mode"] {
	const wrapped = messages.findLast(
		(message) =>
			message.role === "user" && USER_INPUT_MODE.test(textOf(message)),
	);
	const mode = wrapped && USER_INPUT_MODE.exec(textOf(wrapped))?.[1];
	return mode ? (mode === "plan" ? "plan" : "act") : undefined;
}

/** The finished turn as the planner reads it: the request, the reply's ends, the tools it ran, and the files it edited. */
export function summarizeTurn(
	messages: readonly AgentMessage[],
	result: AgentRunResult,
): TurnSummary {
	const { prompt, turn } = finishedTurn(messages);
	const { edits } = scanTurn(turn);
	const callNames = new Map<string, string>();
	const tools = new Map<string, ToolFact>();
	let lastAssistantText = "";
	for (const message of turn) {
		if (message.role === "assistant")
			lastAssistantText = textOf(message) || lastAssistantText;
		for (const part of message.content) {
			if (part.type === "tool-call") {
				callNames.set(part.toolCallId, part.toolName);
			} else if (part.type === "tool-result") {
				const failed = toolResultFailed(part);
				const error = failed
					? clampRedacted(
							part.isError
								? errorText(part.output)
								: outputErrorText(part.output),
							TURN_ERROR_LIMIT,
						)
					: "";
				tools.set(part.toolCallId, {
					name: part.toolName || callNames.get(part.toolCallId) || "tool",
					failed,
					...(error ? { error } : {}),
				});
			}
		}
	}
	const mode = modeOf(messages);
	const chat = chatOf(messages);
	return {
		facts: factsOf(messages, result),
		context: {
			request: clampRedacted(
				prompt ? textOf(prompt).replace(USER_ENVELOPE, "") : "",
				TURN_TEXT_LIMIT,
			),
			reply: clampEnds(result.outputText || lastAssistantText, TURN_TEXT_LIMIT),
			tools: [...tools.values()].slice(-TURN_TOOL_LIMIT),
			editedPaths: [...new Set([...edits.values()].flat())].slice(
				0,
				TURN_PATH_LIMIT,
			),
		},
		...(mode ? { mode } : {}),
		...(chat ? { chat } : {}),
	};
}
