import type { SessionReplayEvent } from "@cline/shared";
import { ATIF_IMPORT_SOURCE } from "./atif/atif-types";
import type { LoadedSessionReplaySession } from "./bundle-io";
import {
	buildSessionReplayIterations,
	describeSessionReplayEvent,
} from "./bundle-iterations";
import { resolveRecordedRequestMessages } from "./recording-messages";
import {
	canonicalJson,
	canonicalSha256,
	excerptAround,
	excerptText,
	excerptValue,
	firstStructuralDifference,
	firstTextDifference,
	SESSION_REPLAY_DIVERGENCE_KINDS,
	SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS,
	type SessionReplayDiffEntry,
	type SessionReplayDivergence,
	type SessionReplayDivergenceKind,
	type SessionReplayStrictness,
	structurallyEqual,
	textDiffEntry,
} from "./replay-diff";
import {
	describeRecordedModelRequest,
	diffSessionReplayRequests,
	type SessionReplayRequestSnapshot,
} from "./replay-request";

/** The parts of a loaded bundle session that replay reads. */
export type SessionReplaySessionData = Pick<
	LoadedSessionReplaySession,
	"transcript" | "events" | "requests" | "blobs"
>;

export interface SessionReplayComparableToolCall {
	id: string;
	name: string;
	input: unknown;
}

export interface SessionReplayComparableToolResult {
	toolCallId: string;
	toolName: string;
	content: unknown;
	/** Readable rendering of `content`, used for excerpts. */
	text: string;
	isError: boolean;
}

export interface SessionReplayComparableDecision {
	seq?: number;
	name: string;
	/** Payload without timing and id fields, which differ between runs. */
	fields: unknown;
	detail?: string;
}

/**
 * One iteration (one model call plus the tool results it asked for) in the
 * form the comparison reads. Recorded and live iterations are built the same
 * way, from a transcript plus, when the session was recorded, its request
 * records and decision events.
 */
export interface SessionReplayComparableIteration {
	/** 1-based session iteration (the playback numbering). */
	index: number;
	/** The request behind the iteration's assistant message; absent if not recorded. */
	request?: SessionReplayRequestSnapshot;
	modelCall?: {
		callIndex: number;
		seq: number;
		runId: string | null;
		iteration: number;
		attempt: number;
	};
	assistantText: string;
	toolCalls: SessionReplayComparableToolCall[];
	toolResults: SessionReplayComparableToolResult[];
	decisions: {
		beforeModelCall: SessionReplayComparableDecision[];
		afterModelCall: SessionReplayComparableDecision[];
	};
	/**
	 * `false` when the session carries no decisions at all (it was not
	 * recorded); decisions are then not compared, like a missing request.
	 */
	decisionsRecorded?: boolean;
	/**
	 * `text` when only the text of tool results is known (a session imported
	 * from a trajectory format that keeps text); results are then compared by
	 * their text instead of their structure.
	 */
	toolResultsAs?: "content" | "text";
}

/** What {@link buildSessionReplayComparableIterations} reads from a session. */
export type SessionReplayComparableSession = SessionReplaySessionData & {
	entry?: { source?: string } | null;
};

const VOLATILE_DECISION_KEY = /^(id|ts)$|(Ms|At|Id|Ids)$/;

function stableDecisionFields(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stableDecisionFields);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			if (!VOLATILE_DECISION_KEY.test(key)) {
				out[key] = stableDecisionFields(item);
			}
		}
		return out;
	}
	return value;
}

function toComparableDecision(
	event: SessionReplayEvent,
): SessionReplayComparableDecision {
	const detail = describeSessionReplayEvent(event);
	return {
		...(event.seq !== undefined ? { seq: event.seq } : {}),
		name: event.name,
		fields: stableDecisionFields(event.payload),
		...(detail ? { detail } : {}),
	};
}

/**
 * Projects a session into comparable iterations, using the same iteration
 * grouping as playback. Decisions are split around the iteration's model
 * call by `seq`: prompt deliveries and mode switches land before it,
 * approvals of the calls it made land after it.
 */
export function buildSessionReplayComparableIterations(
	session: SessionReplayComparableSession,
): SessionReplayComparableIteration[] {
	const decisionsRecorded =
		session.requests.length > 0 ||
		session.events.some((event) => event.kind === "decision");
	const textResults = session.entry?.source === ATIF_IMPORT_SOURCE;
	const iterations = buildSessionReplayIterations({
		transcript: session.transcript,
		events: session.events,
		requests: session.requests,
	});
	const resolved = resolveRecordedRequestMessages(session.requests).messages;
	const records = new Map(
		session.requests.map((record) => [record.callIndex, record]),
	);
	const eventsByIndex = new Map(
		session.events.map((event) => [event.index, event]),
	);
	return iterations.map((iteration) => {
		const messageId = iteration.assistant?.messageId;
		const call = messageId
			? iteration.modelCalls?.filter((c) => c.messageId === messageId).at(-1)
			: iteration.modelCalls?.at(-1);
		const record = call ? records.get(call.callIndex) : undefined;
		const before: SessionReplayComparableDecision[] = [];
		const after: SessionReplayComparableDecision[] = [];
		for (const summary of iteration.events) {
			if (summary.kind !== "decision") continue;
			const event = eventsByIndex.get(summary.index);
			if (!event) continue;
			const isAfter =
				record && event.seq !== undefined
					? event.seq > record.seq
					: event.toolCallId !== undefined;
			(isAfter ? after : before).push(toComparableDecision(event));
		}
		return {
			index: iteration.index,
			...(record
				? {
						request: describeRecordedModelRequest(
							record,
							session.blobs,
							resolved.get(record.callIndex),
						),
						modelCall: {
							callIndex: record.callIndex,
							seq: record.seq,
							runId: record.runId,
							iteration: record.iteration,
							attempt: record.attempt,
						},
					}
				: {}),
			assistantText: iteration.assistant?.text ?? "",
			toolCalls: iteration.toolCalls.map((toolCall) => ({
				id: toolCall.id,
				name: toolCall.name,
				input: toolCall.input,
			})),
			toolResults: iteration.toolCalls.flatMap((toolCall) =>
				toolCall.result
					? [
							{
								toolCallId: toolCall.id,
								toolName: toolCall.name,
								content: toolCall.result.content,
								text: toolCall.result.text,
								isError: toolCall.result.isError,
							},
						]
					: [],
			),
			decisions: { beforeModelCall: before, afterModelCall: after },
			...(decisionsRecorded ? {} : { decisionsRecorded: false }),
			...(textResults ? { toolResultsAs: "text" as const } : {}),
		};
	});
}

export interface SessionReplayCompareOptions {
	/**
	 * Kinds that count as divergence. Default: every kind. Divergences of
	 * other kinds are still reported, with `counted: false`.
	 */
	kinds?: readonly SessionReplayDivergenceKind[];
	/** Default `strict`. See {@link SessionReplayStrictness}. */
	strictness?: SessionReplayStrictness;
	/**
	 * Report request-message differences that come from an earlier
	 * iteration's output (assistant and tool-result messages). Off by
	 * default: those outputs are compared as assistant-text, tool-calls and
	 * tool-results in their own iteration, so tolerating assistant text there
	 * does not resurface as a message difference in every later request.
	 */
	includeInheritedMessages?: boolean;
}

/** Kinds without assistant text: the default a live rerun should count. */
export const SESSION_REPLAY_RERUN_DIVERGENCE_KINDS: readonly SessionReplayDivergenceKind[] =
	SESSION_REPLAY_DIVERGENCE_KINDS.filter((kind) => kind !== "assistant-text");

function toolCallExcerpt(call: SessionReplayComparableToolCall): string {
	return excerptText(`${call.name}(${canonicalJson(call.input)})`);
}

function diffToolCalls(
	recorded: readonly SessionReplayComparableToolCall[],
	live: readonly SessionReplayComparableToolCall[],
): SessionReplayDiffEntry[] {
	const entries: SessionReplayDiffEntry[] = [];
	for (
		let index = 0;
		index < Math.max(recorded.length, live.length);
		index += 1
	) {
		const r = recorded[index];
		const l = live[index];
		const label = `tool call ${index + 1} (${(r ?? l)?.name ?? "?"})`;
		const value = (call: SessionReplayComparableToolCall) => ({
			sha256: canonicalSha256({ name: call.name, input: call.input }),
			excerpt: toolCallExcerpt(call),
		});
		if (r && l) {
			if (r.name !== l.name) {
				entries.push({
					label,
					change: "changed",
					index,
					path: "name",
					recorded: value(r),
					live: value(l),
				});
				continue;
			}
			const difference = firstStructuralDifference(r.input, l.input, "input");
			if (!difference) continue;
			entries.push({
				label,
				change: "changed",
				index,
				path: difference.path,
				recorded: {
					...value(r),
					excerpt: excerptValue(difference.recorded),
				},
				live: { ...value(l), excerpt: excerptValue(difference.live) },
			});
		} else if (r) {
			entries.push({ label, change: "removed", index, recorded: value(r) });
		} else if (l) {
			entries.push({ label, change: "added", index, live: value(l) });
		}
	}
	return entries;
}

function diffToolResults(
	recorded: readonly SessionReplayComparableToolResult[],
	live: readonly SessionReplayComparableToolResult[],
	byText = false,
): SessionReplayDiffEntry[] {
	const entries: SessionReplayDiffEntry[] = [];
	const value = (result: SessionReplayComparableToolResult) => ({
		sha256: canonicalSha256(byText ? result.text : result.content),
		excerpt: `${result.isError ? "error: " : ""}${excerptText(result.text)}`,
	});
	for (
		let index = 0;
		index < Math.max(recorded.length, live.length);
		index += 1
	) {
		const r = recorded[index];
		const l = live[index];
		const label = `tool result ${index + 1} (${(r ?? l)?.toolName ?? "?"})`;
		if (r && l) {
			if (r.isError !== l.isError) {
				entries.push({
					label,
					change: "changed",
					index,
					path: "isError",
					recorded: value(r),
					live: value(l),
				});
				continue;
			}
			const difference = byText
				? r.text === l.text
					? undefined
					: { path: "text", recorded: r.text, live: l.text }
				: firstStructuralDifference(r.content, l.content, "content");
			if (!difference) continue;
			const strings =
				typeof difference.recorded === "string" &&
				typeof difference.live === "string";
			const offset = strings
				? (firstTextDifference(
						difference.recorded as string,
						difference.live as string,
					)?.offset ?? 0)
				: 0;
			entries.push({
				label,
				change: "changed",
				index,
				path: difference.path,
				recorded: {
					...value(r),
					excerpt: strings
						? excerptAround(difference.recorded as string, offset)
						: excerptValue(difference.recorded),
				},
				live: {
					...value(l),
					excerpt: strings
						? excerptAround(difference.live as string, offset)
						: excerptValue(difference.live),
				},
			});
		} else if (r) {
			entries.push({ label, change: "removed", index, recorded: value(r) });
		} else if (l) {
			entries.push({ label, change: "added", index, live: value(l) });
		}
	}
	return entries;
}

function diffDecisions(
	recorded: readonly SessionReplayComparableDecision[],
	live: readonly SessionReplayComparableDecision[],
): SessionReplayDiffEntry[] {
	const entries: SessionReplayDiffEntry[] = [];
	const value = (decision: SessionReplayComparableDecision) => ({
		sha256: canonicalSha256({ name: decision.name, fields: decision.fields }),
		excerpt: excerptText(
			decision.detail ?? `${decision.name} ${canonicalJson(decision.fields)}`,
		),
	});
	for (
		let index = 0;
		index < Math.max(recorded.length, live.length);
		index += 1
	) {
		const r = recorded[index];
		const l = live[index];
		const label = `decision ${index + 1} (${(r ?? l)?.name ?? "?"})`;
		if (r && l) {
			if (r.name === l.name && structurallyEqual(r.fields, l.fields)) continue;
			const path =
				r.name !== l.name
					? "name"
					: firstStructuralDifference(r.fields, l.fields, "payload")?.path;
			entries.push({
				label,
				change: "changed",
				index,
				...(path ? { path } : {}),
				recorded: value(r),
				live: value(l),
			});
		} else if (r) {
			entries.push({ label, change: "removed", index, recorded: value(r) });
		} else if (l) {
			entries.push({ label, change: "added", index, live: value(l) });
		}
	}
	return entries;
}

function listSummary(
	noun: string,
	entries: readonly SessionReplayDiffEntry[],
): string {
	const [first] = entries;
	if (!first) return `${noun} differ`;
	const rest = entries.length > 1 ? ` (+${entries.length - 1} more)` : "";
	return `${noun} differ: ${first.label} ${first.change}${first.path ? ` at ${first.path}` : ""}${rest}`;
}

/**
 * Every divergence between a recorded and a live iteration, in causal
 * order: decisions before the model call, the request (model, system
 * prompt, tools, messages), assistant text, tool calls, decisions after the
 * model call, tool results. Request kinds are compared only when both
 * sides carry a request, decisions only when both sides recorded them, and
 * tool results by text when one side only has their text.
 */
export function compareSessionReplayIteration(
	recorded: SessionReplayComparableIteration,
	live: SessionReplayComparableIteration,
	options: SessionReplayCompareOptions = {},
): SessionReplayDivergence[] {
	const counted = new Set(options.kinds ?? SESSION_REPLAY_DIVERGENCE_KINDS);
	const iteration = recorded.index;
	const divergences: SessionReplayDivergence[] = [];
	const push = (
		divergence: Omit<SessionReplayDivergence, "counted" | "iteration">,
	) => {
		divergences.push({
			...divergence,
			iteration,
			counted: counted.has(divergence.kind),
		});
	};
	const compareDecisions =
		recorded.decisionsRecorded !== false && live.decisionsRecorded !== false;
	const decisions = (phase: "before-model-call" | "after-model-call") => {
		if (!compareDecisions) return;
		const key =
			phase === "before-model-call" ? "beforeModelCall" : "afterModelCall";
		const entries = diffDecisions(recorded.decisions[key], live.decisions[key]);
		if (entries.length > 0) {
			push({
				kind: "decisions",
				phase,
				summary: listSummary(
					`decisions ${phase === "before-model-call" ? "before" : "after"} the model call`,
					entries,
				),
				entries,
			});
		}
	};

	decisions("before-model-call");
	if (recorded.request && live.request) {
		for (const divergence of diffSessionReplayRequests(
			recorded.request,
			live.request,
			{
				iteration,
				includeInheritedMessages: options.includeInheritedMessages === true,
			},
		)) {
			push(divergence);
		}
	}
	if (recorded.assistantText !== live.assistantText) {
		const { entry, position } = textDiffEntry(
			"assistant text",
			recorded.assistantText,
			live.assistantText,
		);
		push({
			kind: "assistant-text",
			summary: `assistant text differs${position ? ` at ${position}` : ""}`,
			entries: [entry],
		});
	}
	const toolCalls = diffToolCalls(recorded.toolCalls, live.toolCalls);
	if (toolCalls.length > 0) {
		push({
			kind: "tool-calls",
			summary: listSummary("tool calls", toolCalls),
			entries: toolCalls,
		});
	}
	decisions("after-model-call");
	const toolResults = diffToolResults(
		recorded.toolResults,
		live.toolResults,
		recorded.toolResultsAs === "text" || live.toolResultsAs === "text",
	);
	if (toolResults.length > 0) {
		push({
			kind: "tool-results",
			summary: listSummary("tool results", toolResults),
			entries: toolResults,
		});
	}
	return divergences;
}

export interface SessionReplayDivergenceReport {
	strictness: SessionReplayStrictness;
	/** Kinds that counted. */
	kinds: SessionReplayDivergenceKind[];
	iterations: { recorded: number; live: number };
	/** One row per compared iteration, plus one for an iteration-count difference. */
	perIteration: Array<{
		iteration: number;
		kinds: SessionReplayDivergenceKind[];
		counted: boolean;
	}>;
	/** Every divergence found, counted or not, in iteration and causal order. */
	divergences: SessionReplayDivergence[];
	/** First counted divergence. */
	first: SessionReplayDivergence | null;
	/** Whether any counted divergence was found. */
	diverged: boolean;
	/** `strict` and diverged. Lenient comparisons never fail. */
	failed: boolean;
	warnings: string[];
}

/** Compares two sessions iteration by iteration. */
export function compareSessionReplayIterations(
	recorded: readonly SessionReplayComparableIteration[],
	live: readonly SessionReplayComparableIteration[],
	options: SessionReplayCompareOptions = {},
): SessionReplayDivergenceReport {
	const kinds = [...(options.kinds ?? SESSION_REPLAY_DIVERGENCE_KINDS)];
	const strictness = options.strictness ?? "strict";
	const divergences: SessionReplayDivergence[] = [];
	const perIteration: SessionReplayDivergenceReport["perIteration"] = [];
	const compared = Math.min(recorded.length, live.length);
	let withoutRequest = 0;
	let withoutDecisions = 0;
	let byText = 0;
	for (let index = 0; index < compared; index += 1) {
		const r = recorded[index];
		const l = live[index];
		if (!r || !l) continue;
		if (!r.request || !l.request) withoutRequest += 1;
		if (r.decisionsRecorded === false || l.decisionsRecorded === false) {
			withoutDecisions += 1;
		}
		if (r.toolResultsAs === "text" || l.toolResultsAs === "text") byText += 1;
		const found = compareSessionReplayIteration(r, l, options);
		divergences.push(...found);
		perIteration.push({
			iteration: r.index,
			kinds: [...new Set(found.map((divergence) => divergence.kind))],
			counted: found.some((divergence) => divergence.counted),
		});
	}
	if (recorded.length !== live.length) {
		const iteration = compared + 1;
		const isCounted = kinds.includes("iteration-count");
		divergences.push({
			kind: "iteration-count",
			iteration,
			counted: isCounted,
			summary: `recorded has ${recorded.length} iteration${recorded.length === 1 ? "" : "s"}, live has ${live.length}`,
			entries: [
				{
					label: `iteration ${iteration}`,
					change: recorded.length > live.length ? "removed" : "added",
					recorded: { excerpt: `${recorded.length} iterations` },
					live: { excerpt: `${live.length} iterations` },
				},
			],
		});
		perIteration.push({
			iteration,
			kinds: ["iteration-count"],
			counted: isCounted,
		});
	}
	const warnings: string[] = [];
	if (
		withoutRequest > 0 &&
		SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS.some((kind) => kinds.includes(kind))
	) {
		warnings.push(
			`request comparison skipped for ${withoutRequest} of ${compared} iteration${compared === 1 ? "" : "s"}: no recorded request on one side (record sessions with --record-session)`,
		);
	}
	if (withoutDecisions > 0 && kinds.includes("decisions")) {
		warnings.push(
			`decision comparison skipped for ${withoutDecisions} of ${compared} iteration${compared === 1 ? "" : "s"}: no recorded decisions on one side (record sessions with --record-session)`,
		);
	}
	if (byText > 0) {
		warnings.push(
			"tool results compared by text: one side was imported from a trajectory that keeps only their text",
		);
	}
	const first = divergences.find((divergence) => divergence.counted) ?? null;
	return {
		strictness,
		kinds,
		iterations: { recorded: recorded.length, live: live.length },
		perIteration,
		divergences,
		first,
		diverged: first !== null,
		failed: strictness === "strict" && first !== null,
		warnings,
	};
}

/** Compares two bundle sessions (a recording and a later run of the same task). */
export function compareSessionReplaySessions(
	recorded: SessionReplayComparableSession,
	live: SessionReplayComparableSession,
	options: SessionReplayCompareOptions = {},
): SessionReplayDivergenceReport {
	return compareSessionReplayIterations(
		buildSessionReplayComparableIterations(recorded),
		buildSessionReplayComparableIterations(live),
		options,
	);
}

function shortSha(sha256: string | undefined): string {
	return (sha256 ?? "").slice(0, 12).padEnd(12);
}

/**
 * Readable lines for one divergence: a header naming iteration, kind and
 * summary, then each entry with its location and the recorded and live
 * content hash and excerpt.
 */
export function formatSessionReplayDivergence(
	divergence: SessionReplayDivergence,
	options: { maxEntries?: number } = {},
): string[] {
	const maxEntries = options.maxEntries ?? 6;
	const lines = [
		`iteration ${divergence.iteration} · ${divergence.kind} · ${divergence.summary}${divergence.counted ? "" : " (not counted)"}`,
	];
	for (const entry of divergence.entries.slice(0, maxEntries)) {
		lines.push(
			`  ${entry.label} ${entry.change}${entry.path ? ` at ${entry.path}` : ""}${entry.inherited ? " (from an earlier iteration's output)" : ""}`,
		);
		if (entry.recorded) {
			lines.push(
				`    - recorded ${shortSha(entry.recorded.sha256)} ${entry.recorded.excerpt}`,
			);
		}
		if (entry.live) {
			lines.push(
				`    + live     ${shortSha(entry.live.sha256)} ${entry.live.excerpt}`,
			);
		}
	}
	if (divergence.entries.length > maxEntries) {
		lines.push(`  … ${divergence.entries.length - maxEntries} more`);
	}
	return lines;
}

export class SessionReplayDivergenceError extends Error {
	readonly report: SessionReplayDivergenceReport;
	readonly divergence: SessionReplayDivergence;

	constructor(
		report: SessionReplayDivergenceReport,
		divergence: SessionReplayDivergence,
	) {
		super(
			[
				`Replay diverged from the recording at iteration ${divergence.iteration} (${divergence.kind}):`,
				...formatSessionReplayDivergence(divergence),
			].join("\n"),
		);
		this.name = "SessionReplayDivergenceError";
		this.report = report;
		this.divergence = divergence;
	}
}

/** Throws {@link SessionReplayDivergenceError} when a strict report failed. */
export function assertNoSessionReplayDivergence(
	report: SessionReplayDivergenceReport,
): void {
	if (report.failed && report.first) {
		throw new SessionReplayDivergenceError(report, report.first);
	}
}
