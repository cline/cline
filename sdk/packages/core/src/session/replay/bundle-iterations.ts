import {
	type ContentBlock,
	formatDisplayUserInput,
	type MessageWithMetadata,
} from "@cline/shared";
import { projectSessionMessagesForDisplay } from "../display-messages";
import { countUserRunMessages, isUserRunMessage } from "../user-run-messages";
import type {
	SessionReplayEvent,
	SessionReplayTranscriptFile,
} from "./bundle-schema";

export interface SessionReplayToolCall {
	id: string;
	name: string;
	input: unknown;
	/** `provider` for model-side tools recorded as observational activity. */
	execution: "client" | "provider";
	result?: {
		text: string;
		isError: boolean;
		content: unknown;
	};
	startedAt?: string;
	endedAt?: string;
	durationMs?: number;
}

export interface SessionReplayIterationEvent {
	index: number;
	ts: string;
	kind: SessionReplayEvent["kind"];
	name: string;
	toolCallId?: string;
	iteration?: number;
}

/**
 * One model call plus the tool results it asked for, projected from the
 * persisted transcript and the session's events.
 */
export interface SessionReplayIteration {
	/** 1-based position among the session's iterations. */
	index: number;
	/** 1-based user turn; increments on each user prompt. */
	turn: number;
	sessionId: string;
	/** User prompt submitted right before this iteration, if any. */
	prompt?: { text: string; ts?: string };
	/**
	 * User-role messages the runtime injected before this iteration
	 * (completion reminders, recovery notices). They are not user turns.
	 */
	injected?: Array<{ text: string; ts?: string }>;
	/** Absent when the transcript ends with a prompt the model never answered. */
	assistant?: {
		text: string;
		reasoning: string;
		messageId?: string;
		ts?: string;
	};
	toolCalls: SessionReplayToolCall[];
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		cost?: number;
	};
	model?: { id: string; provider: string };
	timing: {
		startedAt?: string;
		endedAt?: string;
		/** Wall time between the previous iteration's end and this start. */
		sincePreviousMs?: number;
		/** Sum of recorded tool durations. */
		toolMs?: number;
	};
	events: SessionReplayIterationEvent[];
	/** Transcript message indices covered by this iteration: [start, end). */
	messageRange: { start: number; end: number };
}

interface MessageGroup {
	start: number;
	end: number;
	assistantIndex?: number;
}

const NON_CONVERSATIONAL_DISPLAY_ROLES = new Set(["system", "status", "error"]);

function displayRole(message: MessageWithMetadata): string | undefined {
	const role = message.metadata?.displayRole;
	return typeof role === "string" ? role.trim().toLowerCase() : undefined;
}

function isModelCall(message: MessageWithMetadata): boolean {
	if (message.role !== "assistant") {
		return false;
	}
	if (message.metadata?.displayOnly === true) {
		return false;
	}
	const role = displayRole(message);
	return !role || !NON_CONVERSATIONAL_DISPLAY_ROLES.has(role);
}

function hasToolResult(message: MessageWithMetadata): boolean {
	return (
		Array.isArray(message.content) &&
		message.content.some((block) => block.type === "tool_result")
	);
}

function groupMessages(
	messages: readonly MessageWithMetadata[],
): MessageGroup[] {
	const groups: MessageGroup[] = [];
	let current: MessageGroup | undefined;
	for (const [index, message] of messages.entries()) {
		if (isModelCall(message)) {
			if (!current || current.assistantIndex !== undefined) {
				if (current) {
					groups.push(current);
				}
				current = { start: index, end: index + 1 };
			}
			current.assistantIndex = index;
			current.end = index + 1;
			continue;
		}
		const followsModelCall = current?.assistantIndex !== undefined;
		const attachesToCurrent =
			followsModelCall &&
			(hasToolResult(message) || message.role === "assistant");
		if (current && (attachesToCurrent || !followsModelCall)) {
			current.end = index + 1;
			continue;
		}
		if (current) {
			groups.push(current);
		}
		current = { start: index, end: index + 1 };
	}
	if (current) {
		groups.push(current);
	}
	return groups;
}

/**
 * The user run each iteration's model call belongs to, counted the way
 * checkpoint hooks number runs (span-aware, so compacted turns still count).
 * Position `i` holds the run count of iteration `i + 1`.
 */
export function sessionReplayIterationRunCounts(
	messages: readonly MessageWithMetadata[],
): number[] {
	let counted = 0;
	let runCount = 0;
	return groupMessages(messages).map((group) => {
		const upTo = group.assistantIndex ?? group.end;
		runCount += countUserRunMessages(messages.slice(counted, upTo));
		counted = upTo;
		return runCount;
	});
}

function textOf(content: MessageWithMetadata["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((block): block is Extract<ContentBlock, { type: "text" }> => {
			return block.type === "text";
		})
		.map((block) => block.text)
		.join("\n");
}

function reasoningOf(content: MessageWithMetadata["content"]): string {
	if (typeof content === "string") {
		return "";
	}
	return content
		.filter(
			(block): block is Extract<ContentBlock, { type: "thinking" }> =>
				block.type === "thinking",
		)
		.map((block) => block.thinking)
		.join("\n");
}

function stringifyToolResultContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((block) => {
				if (!block || typeof block !== "object") {
					return String(block);
				}
				const record = block as Record<string, unknown>;
				if (record.type === "text" && typeof record.text === "string") {
					return record.text;
				}
				if (record.type === "file" && typeof record.path === "string") {
					return `Attached file: ${record.path}`;
				}
				if (record.type === "image") {
					return "[image]";
				}
				return JSON.stringify(block);
			})
			.join("\n");
	}
	try {
		return JSON.stringify(content) ?? String(content);
	} catch {
		return String(content);
	}
}

function isoFromMs(ms: number | undefined): string | undefined {
	return typeof ms === "number" && Number.isFinite(ms)
		? new Date(ms).toISOString()
		: undefined;
}

function msFromIso(value: unknown): number | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function readToolTiming(event: SessionReplayEvent):
	| {
			startedAt?: string;
			endedAt?: string;
			durationMs?: number;
	  }
	| undefined {
	const record = event.payload.tool_result;
	if (!record || typeof record !== "object" || Array.isArray(record)) {
		return undefined;
	}
	const toolResult = record as Record<string, unknown>;
	const startedAt = msFromIso(toolResult.startedAt);
	const endedAt = msFromIso(toolResult.endedAt);
	const durationMs =
		typeof toolResult.durationMs === "number" &&
		Number.isFinite(toolResult.durationMs)
			? toolResult.durationMs
			: startedAt !== undefined && endedAt !== undefined
				? endedAt - startedAt
				: undefined;
	return {
		...(startedAt !== undefined ? { startedAt: isoFromMs(startedAt) } : {}),
		...(endedAt !== undefined ? { endedAt: isoFromMs(endedAt) } : {}),
		...(durationMs !== undefined ? { durationMs } : {}),
	};
}

function collectToolCalls(
	messages: readonly MessageWithMetadata[],
): SessionReplayToolCall[] {
	const calls: SessionReplayToolCall[] = [];
	const byId = new Map<string, SessionReplayToolCall>();
	for (const display of projectSessionMessagesForDisplay(messages)) {
		const { message } = display;
		if (typeof message.content === "string") {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use" && message.role === "assistant") {
				const call: SessionReplayToolCall = {
					id: block.id,
					name: block.name,
					input: block.input,
					execution: display.execution ?? "client",
				};
				calls.push(call);
				byId.set(block.id, call);
			} else if (block.type === "tool_result") {
				const call = byId.get(block.tool_use_id);
				if (call) {
					call.result = {
						text: stringifyToolResultContent(block.content),
						isError: block.is_error === true,
						content: block.content,
					};
				}
			}
		}
	}
	return calls;
}

function summarizeEvent(
	event: SessionReplayEvent,
): SessionReplayIterationEvent {
	return {
		index: event.index,
		ts: event.ts,
		kind: event.kind,
		name: event.name,
		...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
		...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
	};
}

/**
 * Projects a session's transcript into iterations. Hook events are attached
 * by tool call id when they carry one and by timestamp otherwise; timing uses
 * message timestamps and event timestamps, whichever are present.
 */
export function buildSessionReplayIterations(input: {
	sessionId?: string;
	transcript: SessionReplayTranscriptFile;
	events?: readonly SessionReplayEvent[];
}): SessionReplayIteration[] {
	const messages = input.transcript.messages;
	const sessionId = input.sessionId ?? input.transcript.sessionId;
	const groups = groupMessages(messages);
	const events = input.events ?? [];

	const iterations: SessionReplayIteration[] = [];
	let turn = 0;
	for (const [groupIndex, group] of groups.entries()) {
		const slice = messages.slice(group.start, group.end);
		const assistantMessage =
			group.assistantIndex !== undefined
				? messages[group.assistantIndex]
				: undefined;
		const userMessages = messages
			.slice(group.start, group.assistantIndex ?? group.end)
			.filter(
				(message) =>
					message.role === "user" &&
					!hasToolResult(message) &&
					message.metadata?.displayOnly !== true &&
					!NON_CONVERSATIONAL_DISPLAY_ROLES.has(displayRole(message) ?? ""),
			);
		const promptMessages = userMessages.filter(isUserRunMessage);
		const promptText = promptMessages
			.map((message) => formatDisplayUserInput(textOf(message.content)))
			.filter((text) => text.trim().length > 0)
			.join("\n");
		const injected = userMessages
			.filter((message) => !isUserRunMessage(message))
			.flatMap((message) => {
				const text = formatDisplayUserInput(textOf(message.content));
				const ts = isoFromMs(message.ts);
				return text.trim() ? [{ text, ...(ts ? { ts } : {}) }] : [];
			});
		if (promptText || groupIndex === 0) {
			turn += 1;
		}
		const metrics = assistantMessage?.metrics;
		const modelInfo = assistantMessage?.modelInfo;
		iterations.push({
			index: groupIndex + 1,
			turn,
			sessionId,
			...(promptText
				? {
						prompt: {
							text: promptText,
							...(isoFromMs(promptMessages.at(-1)?.ts)
								? { ts: isoFromMs(promptMessages.at(-1)?.ts) }
								: {}),
						},
					}
				: {}),
			...(injected.length > 0 ? { injected } : {}),
			...(assistantMessage
				? {
						assistant: {
							text: textOf(assistantMessage.content),
							reasoning: reasoningOf(assistantMessage.content),
							...(assistantMessage.id
								? { messageId: assistantMessage.id }
								: {}),
							...(isoFromMs(assistantMessage.ts)
								? { ts: isoFromMs(assistantMessage.ts) }
								: {}),
						},
					}
				: {}),
			toolCalls: collectToolCalls(slice),
			...(metrics
				? {
						usage: {
							inputTokens: metrics.inputTokens ?? 0,
							outputTokens: metrics.outputTokens ?? 0,
							cacheReadTokens: metrics.cacheReadTokens ?? 0,
							cacheWriteTokens: metrics.cacheWriteTokens ?? 0,
							...(metrics.cost !== undefined ? { cost: metrics.cost } : {}),
						},
					}
				: {}),
			...(modelInfo
				? { model: { id: modelInfo.id, provider: modelInfo.provider } }
				: {}),
			timing: {},
			events: [],
			messageRange: { start: group.start, end: group.end },
		});
	}
	if (iterations.length === 0) {
		return iterations;
	}

	const messageTimes = groups.map((group) => {
		const times = messages
			.slice(group.start, group.end)
			.map((message) => message.ts)
			.filter((ts): ts is number => typeof ts === "number");
		return times.length > 0
			? { min: Math.min(...times), max: Math.max(...times) }
			: undefined;
	});
	const iterationByToolCall = new Map<string, SessionReplayIteration>();
	for (const iteration of iterations) {
		for (const call of iteration.toolCalls) {
			iterationByToolCall.set(call.id, iteration);
		}
	}
	const eventTimes = new Map<SessionReplayIteration, number[]>();
	for (const event of events) {
		const eventMs = msFromIso(event.ts);
		let target = event.toolCallId
			? iterationByToolCall.get(event.toolCallId)
			: undefined;
		if (!target && eventMs !== undefined) {
			const position = messageTimes.findIndex(
				(times) => times !== undefined && times.max >= eventMs,
			);
			target = position >= 0 ? iterations[position] : undefined;
		}
		target ??= iterations.at(-1);
		if (!target) {
			continue;
		}
		target.events.push(summarizeEvent(event));
		if (eventMs !== undefined) {
			const times = eventTimes.get(target) ?? [];
			times.push(eventMs);
			eventTimes.set(target, times);
		}
		if (event.name === "tool_result" && event.toolCallId) {
			const call = target.toolCalls.find(
				(candidate) => candidate.id === event.toolCallId,
			);
			const timing = readToolTiming(event);
			if (call && timing) {
				Object.assign(call, timing);
			}
		}
	}

	let previousEnd: number | undefined;
	for (const [position, iteration] of iterations.entries()) {
		const times = [
			...(messageTimes[position]
				? [messageTimes[position].min, messageTimes[position].max]
				: []),
			...(eventTimes.get(iteration) ?? []),
		];
		const start = times.length > 0 ? Math.min(...times) : undefined;
		const end = times.length > 0 ? Math.max(...times) : undefined;
		const toolDurations = iteration.toolCalls
			.map((call) => call.durationMs)
			.filter((value): value is number => typeof value === "number");
		iteration.timing = {
			...(start !== undefined ? { startedAt: isoFromMs(start) } : {}),
			...(end !== undefined ? { endedAt: isoFromMs(end) } : {}),
			...(start !== undefined && previousEnd !== undefined
				? { sincePreviousMs: Math.max(0, start - previousEnd) }
				: {}),
			...(toolDurations.length > 0
				? { toolMs: toolDurations.reduce((sum, value) => sum + value, 0) }
				: {}),
		};
		if (end !== undefined) {
			previousEnd = end;
		}
	}
	return iterations;
}

export interface SessionReplayIterationRange {
	from?: number;
	to?: number;
}

/** Applies an inclusive 1-based `from`/`to` range, validating its bounds. */
export function selectSessionReplayIterations(
	iterations: readonly SessionReplayIteration[],
	range: SessionReplayIterationRange,
): SessionReplayIteration[] {
	const total = iterations.length;
	const from = range.from ?? 1;
	const to = range.to ?? total;
	for (const [label, value] of [
		["--from", range.from],
		["--to", range.to],
	] as const) {
		if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
			throw new RangeError(`${label} must be an integer >= 1`);
		}
	}
	if (total > 0 && from > total) {
		throw new RangeError(
			`--from (${from}) is past the last iteration; the session has ${total} iteration${total === 1 ? "" : "s"}`,
		);
	}
	if (from > to) {
		throw new RangeError(
			`--from (${from}) must not be greater than --to (${to})`,
		);
	}
	return iterations.filter(
		(iteration) => iteration.index >= from && iteration.index <= to,
	);
}
