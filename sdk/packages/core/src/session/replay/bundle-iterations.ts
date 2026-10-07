import {
	type ContentBlock,
	formatDisplayUserInput,
	type MessageWithMetadata,
} from "@cline/shared";
import { projectSessionMessagesForDisplay } from "../display-messages";
import { isUserRunMessage } from "../user-run-messages";
import type {
	SessionReplayEvent,
	SessionReplayTranscriptFile,
} from "./bundle-schema";
import type { SessionRecordedModelCall } from "./recording-schema";

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
	/** Recording order; present for recorded events and hook lines. */
	seq?: number;
	refs?: Record<string, string | number>;
	/** One-line description of a decision or runtime event, when known. */
	detail?: string;
}

/** A recorded model request/response, summarized for playback. */
export interface SessionReplayModelCall {
	callIndex: number;
	seq: number;
	runId: string | null;
	/** The agent's iteration number within its run. */
	iteration: number;
	attempt: number;
	outcome: SessionRecordedModelCall["response"]["outcome"];
	finishReason: string | null;
	durationMs: number;
	matchKey: string;
	messageCount: number;
	messageId?: string;
	error?: string;
	usage?: { inputTokens?: number; outputTokens?: number };
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
	/**
	 * Recorded model calls behind this iteration: the one that produced its
	 * assistant message, preceded by any failed or discarded attempts.
	 * Absent when no recorded call belongs to it.
	 */
	modelCalls?: SessionReplayModelCall[];
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

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function quote(text: string, max = 60): string {
	const line = text.replace(/\s+/g, " ").trim();
	return `"${line.length > max ? `${line.slice(0, max - 1)}…` : line}"`;
}

function describeDecider(value: unknown): string {
	if (!value || typeof value !== "object") {
		return "unknown";
	}
	const decider = value as Record<string, unknown>;
	const kind = str(decider.kind) ?? "unknown";
	const detail = str(decider.detail);
	return detail ? `${kind} (${detail})` : kind;
}

/**
 * One-line description of a recorded decision or runtime event, e.g.
 * `approved run_commands by client (cli) after 1200ms`. Undefined for events
 * without a known shape (hook events, unknown names).
 */
export function describeSessionReplayEvent(
	event: Pick<SessionReplayEvent, "kind" | "name" | "payload" | "refs">,
): string | undefined {
	const p = event.payload;
	if (event.kind === "decision") {
		switch (event.name) {
			case "approval_requested":
				return `approval requested for ${str(p.toolName) ?? "tool"}`;
			case "approval_resolved": {
				const wait = num(p.waitMs);
				const reason = str(p.reason);
				return [
					`${p.approved === true ? "approved" : "denied"} ${str(p.toolName) ?? "tool"}`,
					`by ${describeDecider(p.decidedBy)}`,
					...(wait !== undefined ? [`after ${Math.round(wait)}ms`] : []),
				]
					.join(" ")
					.concat(reason ? `: ${reason}` : "");
			}
			case "prompt_enqueued": {
				const delivery = str(p.delivery) ?? "queue";
				const flags = [
					p.merged === true ? "merged" : undefined,
					p.aborting === true ? "while aborting" : undefined,
				].filter(Boolean);
				const prompt = str(p.prompt);
				return `${delivery} prompt queued${flags.length > 0 ? ` (${flags.join(", ")})` : ""}${prompt ? `: ${quote(prompt)}` : ""}`;
			}
			case "prompt_delivered": {
				const delivery = str(p.delivery) ?? "immediate";
				const notes = [
					str(p.source),
					str(p.requestedDelivery)
						? `requested ${str(p.requestedDelivery)}`
						: undefined,
					str(p.mode),
				].filter(Boolean);
				return `${delivery} prompt delivered${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
			}
			case "prompt_updated":
				return `queued prompt updated${str(p.delivery) ? ` (${str(p.delivery)})` : ""}`;
			case "prompt_deleted":
				return "queued prompt deleted";
			case "prompt_queue_discarded": {
				const count = Array.isArray(p.promptIds) ? p.promptIds.length : 0;
				return `${count} queued prompt${count === 1 ? "" : "s"} discarded`;
			}
			case "mode_switched":
				return `mode ${str(p.from) ?? "?"} → ${str(p.to) ?? "?"}${str(p.source) ? ` (${str(p.source)})` : ""}`;
			case "abort_requested":
				return `abort requested${str(p.source) ? ` by ${str(p.source)}` : ""}${str(p.reason) ? `: ${str(p.reason)}` : ""}`;
			case "mistake_limit_resolved":
				return `mistake limit ${num(p.consecutiveMistakes) ?? "?"}/${num(p.maxConsecutiveMistakes) ?? "?"}: ${str(p.action) ?? "unknown"}`;
			default:
				return undefined;
		}
	}
	if (event.kind === "runtime") {
		switch (event.name) {
			case "model_finished": {
				const duration = num(p.durationMs);
				return `model call ${event.refs?.modelCallIndex ?? "?"} ${str(p.outcome) ?? "finished"}${str(p.finishReason) ? ` (${str(p.finishReason)})` : ""}${duration !== undefined ? ` in ${Math.round(duration)}ms` : ""}`;
			}
			case "tool_started":
				return `${str(p.toolName) ?? "tool"} started`;
			case "tool_finished":
				return `${str(p.toolName) ?? "tool"} ${p.isError === true ? "failed" : "finished"}`;
			case "run_finished":
				return `run ${str(p.status) ?? "finished"}`;
			case "run_failed":
				return `run failed${str(p.error) ? `: ${str(p.error)}` : ""}`;
			default:
				return undefined;
		}
	}
	return undefined;
}

function summarizeEvent(
	event: SessionReplayEvent,
): SessionReplayIterationEvent {
	const detail = describeSessionReplayEvent(event);
	return {
		index: event.index,
		ts: event.ts,
		kind: event.kind,
		name: event.name,
		...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
		...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
		...(event.seq !== undefined ? { seq: event.seq } : {}),
		...(event.refs ? { refs: event.refs } : {}),
		...(detail ? { detail } : {}),
	};
}

function summarizeModelCall(
	record: SessionRecordedModelCall,
): SessionReplayModelCall {
	const usage = record.response.usage ?? {};
	const inputTokens = num(usage.inputTokens);
	const outputTokens = num(usage.outputTokens);
	return {
		callIndex: record.callIndex,
		seq: record.seq,
		runId: record.runId,
		iteration: record.iteration,
		attempt: record.attempt,
		outcome: record.response.outcome,
		finishReason: record.response.finishReason,
		durationMs: record.durationMs,
		matchKey: record.request.matchKey,
		messageCount: record.request.messageSha256s.length,
		...(record.response.messageId
			? { messageId: record.response.messageId }
			: {}),
		...(record.response.error ? { error: record.response.error } : {}),
		...(inputTokens !== undefined || outputTokens !== undefined
			? {
					usage: {
						...(inputTokens !== undefined ? { inputTokens } : {}),
						...(outputTokens !== undefined ? { outputTokens } : {}),
					},
				}
			: {}),
	};
}

/**
 * Hands each recorded model call to an iteration: the call that produced an
 * iteration's assistant message, plus the unlinked calls (errors, retried
 * attempts) recorded before it. Calls after the last linked one go to the
 * last iteration. Returns the record seq that closes each iteration.
 */
function attachModelCalls(
	iterations: readonly SessionReplayIteration[],
	requests: readonly SessionRecordedModelCall[],
): Map<SessionReplayIteration, number> {
	const closingSeq = new Map<SessionReplayIteration, number>();
	const byMessageId = new Map<string, SessionReplayIteration>();
	for (const iteration of iterations) {
		if (iteration.assistant?.messageId) {
			byMessageId.set(iteration.assistant.messageId, iteration);
		}
	}
	const sorted = [...requests].sort((a, b) => a.callIndex - b.callIndex);
	let pending: SessionRecordedModelCall[] = [];
	for (const record of sorted) {
		const target = record.response.messageId
			? byMessageId.get(record.response.messageId)
			: undefined;
		if (!target) {
			pending.push(record);
			continue;
		}
		target.modelCalls = [
			...(target.modelCalls ?? []),
			...[...pending, record].map(summarizeModelCall),
		];
		closingSeq.set(target, record.seq);
		pending = [];
	}
	const last = iterations.at(-1);
	if (last && pending.length > 0) {
		last.modelCalls = [
			...(last.modelCalls ?? []),
			...pending.map(summarizeModelCall),
		];
	}
	return closingSeq;
}

/**
 * Projects a session's transcript into iterations. Events are attached by
 * tool call id when they carry one; otherwise by `seq` against the recorded
 * model calls when the session was recorded, and by timestamp as a last
 * resort. Timing uses message timestamps and event timestamps, whichever are
 * present.
 */
export function buildSessionReplayIterations(input: {
	sessionId?: string;
	transcript: SessionReplayTranscriptFile;
	events?: readonly SessionReplayEvent[];
	requests?: readonly SessionRecordedModelCall[];
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
	// An event recorded before an iteration's model call finished belongs to
	// that iteration (start prompt, steer delivery, turn start).
	const seqBoundaries = [
		...attachModelCalls(iterations, input.requests ?? []).entries(),
	].sort((a, b) => a[1] - b[1]);
	const eventTimes = new Map<SessionReplayIteration, number[]>();
	for (const event of events) {
		const eventMs = msFromIso(event.ts);
		let target = event.toolCallId
			? iterationByToolCall.get(event.toolCallId)
			: undefined;
		if (!target && event.seq !== undefined && seqBoundaries.length > 0) {
			const seq = event.seq;
			target =
				seqBoundaries.find(([, closing]) => closing >= seq)?.[0] ??
				iterations.at(-1);
		}
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
