import {
	buildSessionReplayIterations,
	type LoadedSessionReplayBundle,
	type LoadedSessionReplaySession,
	readSessionReplayBundle,
	type SessionReplayIteration,
	type SessionReplayIterationEvent,
	type SessionReplayModelCall,
	type SessionReplayToolCall,
	selectSessionReplayIterations,
} from "@cline/session";
import { c, formatUsd } from "../utils/output";

export interface LoadedSessionReplay {
	bundle: LoadedSessionReplayBundle;
	session: LoadedSessionReplaySession;
	/** Number of iterations in the session, before range selection. */
	total: number;
	iterations: SessionReplayIteration[];
}

export async function loadSessionReplay(input: {
	bundleDir: string;
	sessionId?: string;
	from?: number;
	to?: number;
}): Promise<LoadedSessionReplay> {
	const bundle = await readSessionReplayBundle(input.bundleDir);
	const sessionId = input.sessionId?.trim() || bundle.manifest.rootSessionId;
	const session = bundle.sessions.find(
		(candidate) => candidate.entry.sessionId === sessionId,
	);
	if (!session) {
		const available = bundle.sessions
			.map((candidate) => candidate.entry.sessionId)
			.join(", ");
		throw new Error(
			`Session ${sessionId} is not in this bundle (available: ${available}).`,
		);
	}
	const all = buildSessionReplayIterations({
		sessionId,
		transcript: session.transcript,
		events: session.events,
		requests: session.requests,
	});
	return {
		bundle,
		session,
		total: all.length,
		iterations: selectSessionReplayIterations(all, {
			from: input.from,
			to: input.to,
		}),
	};
}

/** Recorded gaps longer than this are shortened during timed playback. */
export const REPLAY_MAX_GAP_MS = 3_000;

/**
 * How long to wait before showing `iteration` when replaying at `speed`
 * (1 = recorded pace). Zero or negative speeds play back instantly.
 */
export function replayDelayMs(
	iteration: SessionReplayIteration,
	speed: number,
	maxGapMs = REPLAY_MAX_GAP_MS,
): number {
	const gap = iteration.timing.sincePreviousMs;
	if (!(speed > 0) || gap === undefined || gap <= 0) {
		return 0;
	}
	return Math.min(maxGapMs, Math.round(gap / speed));
}

export function formatReplayDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) {
		return "-";
	}
	if (ms < 1_000) {
		return `${Math.round(ms)}ms`;
	}
	if (ms < 60_000) {
		return `${(ms / 1_000).toFixed(1)}s`;
	}
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1_000);
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function iterationDurationMs(
	iteration: SessionReplayIteration,
): number | undefined {
	const { startedAt, endedAt } = iteration.timing;
	if (!startedAt || !endedAt) {
		return undefined;
	}
	return Date.parse(endedAt) - Date.parse(startedAt);
}

export function formatReplayUsage(
	iteration: SessionReplayIteration,
): string | undefined {
	const parts: string[] = [];
	const { usage, model } = iteration;
	if (usage) {
		parts.push(`${usage.inputTokens} in`, `${usage.outputTokens} out`);
		if (usage.cacheReadTokens > 0) {
			parts.push(`${usage.cacheReadTokens} cache read`);
		}
		if (usage.cacheWriteTokens > 0) {
			parts.push(`${usage.cacheWriteTokens} cache write`);
		}
		if (usage.cost !== undefined) {
			parts.push(formatUsd(usage.cost));
		}
	}
	if (model) {
		parts.push(`${model.id} (${model.provider})`);
	}
	return parts.length > 0 ? parts.join(" · ") : undefined;
}

function eventOffsetLabel(iteration: SessionReplayIteration, ts: string) {
	const start = iteration.timing.startedAt
		? Date.parse(iteration.timing.startedAt)
		: undefined;
	const offset = start !== undefined ? Date.parse(ts) - start : Number.NaN;
	return Number.isFinite(offset) ? `+${formatReplayDuration(offset)}` : ts;
}

/** Hook events with their offset from the iteration start, e.g. `+1.1s tool_call`. */
export function formatReplayEventTimeline(
	iteration: SessionReplayIteration,
): string[] {
	return iteration.events
		.filter((event) => event.kind === "hook")
		.map(
			(event) =>
				`${eventOffsetLabel(iteration, event.ts)} ${event.name}${event.toolCallId ? ` ${event.toolCallId}` : ""}`,
		);
}

export function replayDecisionEvents(
	iteration: SessionReplayIteration,
): SessionReplayIterationEvent[] {
	return iteration.events.filter((event) => event.kind === "decision");
}

/** A recorded decision, e.g. `+1.2s approved run_commands by client (cli) after 900ms`. */
export function formatReplayDecision(
	iteration: SessionReplayIteration,
	event: SessionReplayIterationEvent,
): string {
	return `${eventOffsetLabel(iteration, event.ts)} ${event.detail ?? event.name}`;
}

export function formatReplayDecisions(
	iteration: SessionReplayIteration,
): string[] {
	return replayDecisionEvents(iteration).map((event) =>
		formatReplayDecision(iteration, event),
	);
}

/** A recorded model call, e.g. `call 3 · completed (tool-calls) · 1.2s · 812 in / 40 out`. */
export function formatReplayModelCall(call: SessionReplayModelCall): string {
	const parts = [
		`call ${call.callIndex}${call.attempt > 0 ? ` (attempt ${call.attempt + 1})` : ""}`,
		`${call.outcome}${call.finishReason ? ` (${call.finishReason})` : ""}`,
		formatReplayDuration(call.durationMs),
		`${call.messageCount} message${call.messageCount === 1 ? "" : "s"}`,
	];
	if (call.usage) {
		parts.push(
			`${call.usage.inputTokens ?? 0} in / ${call.usage.outputTokens ?? 0} out`,
		);
	}
	parts.push(`match ${call.matchKey.slice(0, 12)}`);
	if (call.error) {
		parts.push(call.error);
	}
	return parts.join(" · ");
}

export function formatReplayModelCalls(
	iteration: SessionReplayIteration,
): string[] {
	return (iteration.modelCalls ?? []).map(formatReplayModelCall);
}

export function formatReplayIterationTitle(
	iteration: SessionReplayIteration,
	total: number,
): string {
	const parts = [
		`Iteration ${iteration.index}/${total}`,
		`turn ${iteration.turn}`,
	];
	const duration = iterationDurationMs(iteration);
	if (duration !== undefined) {
		parts.push(formatReplayDuration(duration));
	}
	if (iteration.timing.sincePreviousMs !== undefined) {
		parts.push(
			`+${formatReplayDuration(iteration.timing.sincePreviousMs)} after previous`,
		);
	}
	return parts.join(" · ");
}

export function stringifyToolInput(input: unknown): string {
	if (typeof input === "string") {
		return input;
	}
	try {
		return JSON.stringify(input) ?? String(input);
	} catch {
		return String(input);
	}
}

export function truncateLines(
	text: string,
	maxLines: number,
): { text: string; hiddenLines: number } {
	const lines = text.split("\n");
	if (maxLines <= 0 || lines.length <= maxLines) {
		return { text, hiddenLines: 0 };
	}
	return {
		text: lines.slice(0, maxLines).join("\n"),
		hiddenLines: lines.length - maxLines,
	};
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

export interface ReplayTextOptions {
	color: boolean;
	/** Tool result lines shown before truncating; 0 shows everything. */
	maxResultLines: number;
}

function paint(
	options: Pick<ReplayTextOptions, "color">,
	code: string,
	text: string,
): string {
	return options.color ? `${code}${text}${c.reset}` : text;
}

function formatToolCallText(
	call: SessionReplayToolCall,
	options: ReplayTextOptions,
): string[] {
	const status = call.result
		? call.result.isError
			? paint(options, c.red, "error")
			: paint(options, c.green, "ok")
		: paint(options, c.yellow, "no result");
	const duration =
		call.durationMs !== undefined
			? ` · ${formatReplayDuration(call.durationMs)}`
			: "";
	const execution = call.execution === "provider" ? " · provider" : "";
	const lines = [
		`  ${paint(options, c.cyan, "tool")} ${call.name} ${paint(options, c.gray, call.id)} · ${status}${duration}${execution}`,
		labeledBlock("input", stringifyToolInput(call.input)),
	];
	if (call.result) {
		const { text, hiddenLines } = truncateLines(
			call.result.text,
			options.maxResultLines,
		);
		lines.push(labeledBlock("result", text));
		if (hiddenLines > 0) {
			lines.push(
				paint(
					options,
					c.gray,
					`${" ".repeat(LABEL_WIDTH)}… ${hiddenLines} more line${hiddenLines === 1 ? "" : "s"}`,
				),
			);
		}
	}
	return lines;
}

const LABEL_WIDTH = 14;

/** `      label: first line`, with continuation lines aligned under it. */
function labeledBlock(label: string, text: string): string {
	const head = `      ${label}: `.padEnd(LABEL_WIDTH);
	const [first = "", ...rest] = text.split("\n");
	return [
		head + first,
		...rest.map((line) => " ".repeat(LABEL_WIDTH) + line),
	].join("\n");
}

export function formatReplayIterationText(
	iteration: SessionReplayIteration,
	total: number,
	options: ReplayTextOptions,
): string {
	const lines = [
		paint(
			options,
			c.bold,
			`── ${formatReplayIterationTitle(iteration, total)} ──`,
		),
	];
	if (iteration.prompt) {
		lines.push(
			indent(iteration.prompt.text, `${paint(options, c.cyan, "❯")} `),
		);
	}
	for (const note of iteration.injected ?? []) {
		lines.push(paint(options, c.dim, indent(note.text, "  system: ")));
	}
	if (iteration.assistant?.reasoning) {
		lines.push(
			paint(
				options,
				c.dim,
				indent(iteration.assistant.reasoning, "  thinking: "),
			),
		);
	}
	if (iteration.assistant?.text) {
		lines.push(indent(iteration.assistant.text, "  "));
	}
	if (!iteration.assistant) {
		lines.push(paint(options, c.gray, "  (no model response recorded)"));
	}
	for (const call of iteration.toolCalls) {
		lines.push(...formatToolCallText(call, options));
	}
	for (const decision of formatReplayDecisions(iteration)) {
		lines.push(`  ${paint(options, c.yellow, "decision")} ${decision}`);
	}
	const usage = formatReplayUsage(iteration);
	if (usage) {
		lines.push(paint(options, c.gray, `  usage: ${usage}`));
	}
	for (const call of formatReplayModelCalls(iteration)) {
		lines.push(paint(options, c.gray, `  model call: ${call}`));
	}
	const timeline = formatReplayEventTimeline(iteration);
	if (timeline.length > 0) {
		lines.push(paint(options, c.gray, `  events: ${timeline.join(", ")}`));
	}
	return lines.join("\n");
}

export function formatReplayHeaderText(
	replay: LoadedSessionReplay,
	options: Pick<ReplayTextOptions, "color">,
): string {
	const { manifest } = replay.bundle;
	const { entry } = replay.session;
	const exit = entry.exitCode !== null ? ` (exit ${entry.exitCode})` : "";
	const redaction = manifest.redaction.enabled
		? `on, ${manifest.redaction.removedCount} removed`
		: "off";
	const range =
		replay.iterations.length === replay.total
			? `${replay.total}`
			: `${replay.iterations.length} of ${replay.total}`;
	return [
		paint(
			options,
			c.bold,
			`Session replay ${entry.sessionId}${entry.title ? ` · ${entry.title}` : ""}`,
		),
		`  model: ${entry.model} (${entry.provider}) · status: ${entry.status}${exit} · source: ${entry.source}`,
		`  started: ${entry.startedAt}${entry.endedAt ? ` · ended: ${entry.endedAt}` : ""}`,
		`  cwd: ${entry.cwd}`,
		`  iterations: ${range} · messages: ${entry.counts.messages} · events: ${entry.counts.events} · redaction: ${redaction}`,
		...(entry.recording
			? [
					`  recording: ${entry.recording.counts.modelCalls} model calls · ${entry.recording.counts.decisions} decisions · ${entry.recording.segments.length} segment${entry.recording.segments.length === 1 ? "" : "s"}`,
				]
			: []),
		`  bundle: schemaVersion ${manifest.schemaVersion} · ${manifest.producer.name} ${manifest.producer.version}`,
	].join("\n");
}

export function summarizeReplayIterations(
	iterations: readonly SessionReplayIteration[],
): {
	inputTokens: number;
	outputTokens: number;
	cost: number;
	toolCalls: number;
	wallMs?: number;
} {
	const starts = iterations
		.map((iteration) => iteration.timing.startedAt)
		.filter((value): value is string => !!value)
		.map(Date.parse);
	const ends = iterations
		.map((iteration) => iteration.timing.endedAt)
		.filter((value): value is string => !!value)
		.map(Date.parse);
	return {
		inputTokens: iterations.reduce(
			(sum, iteration) => sum + (iteration.usage?.inputTokens ?? 0),
			0,
		),
		outputTokens: iterations.reduce(
			(sum, iteration) => sum + (iteration.usage?.outputTokens ?? 0),
			0,
		),
		cost: iterations.reduce(
			(sum, iteration) => sum + (iteration.usage?.cost ?? 0),
			0,
		),
		toolCalls: iterations.reduce(
			(sum, iteration) => sum + iteration.toolCalls.length,
			0,
		),
		...(starts.length > 0 && ends.length > 0
			? { wallMs: Math.max(...ends) - Math.min(...starts) }
			: {}),
	};
}

export function formatReplaySummaryText(
	iterations: readonly SessionReplayIteration[],
	options: Pick<ReplayTextOptions, "color">,
): string {
	const summary = summarizeReplayIterations(iterations);
	const parts = [
		`${iterations.length} iteration${iterations.length === 1 ? "" : "s"}`,
		`${summary.toolCalls} tool call${summary.toolCalls === 1 ? "" : "s"}`,
		`${summary.inputTokens} in / ${summary.outputTokens} out`,
		formatUsd(summary.cost),
	];
	if (summary.wallMs !== undefined) {
		parts.push(`${formatReplayDuration(summary.wallMs)} wall time`);
	}
	return paint(options, c.bold, `── End of replay · ${parts.join(" · ")} ──`);
}
