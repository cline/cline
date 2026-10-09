import {
	groupSessionMessageIterations,
	type SessionRecordedModelCall,
	type SessionReplayEvent,
	TOOL_ENVIRONMENT_METADATA_KEY,
	type ToolEnvironmentFacts,
} from "@cline/shared";
import { readSessionReplayBundle } from "./bundle-io";
import { buildSessionReplayIterations } from "./bundle-iterations";
import { SessionReplayBundleError } from "./bundle-migrations";
import { resolveRecordedRequestMessages } from "./recording-messages";
import type { SessionReplaySessionData } from "./replay-compare";
import { formatSessionReplayDivergence } from "./replay-compare";
import type {
	SessionReplayDivergence,
	SessionReplayStrictness,
} from "./replay-diff";
import {
	describeRecordedModelRequest,
	diffSessionReplayRequests,
	type SessionReplayRequestSnapshot,
} from "./replay-request";

/**
 * Where a live model request sits in its session. Every field is optional;
 * the source uses them only to pick a fallback record when no unconsumed
 * record has the request's match key.
 */
export interface SessionReplaySourcePosition {
	/** 0-based position among the session's model calls. */
	callIndex?: number;
	/** Live run id. Matched only if some record has it (recorded ids differ between runs). */
	runId?: string | null;
	/** The agent's iteration within its run. */
	iteration?: number;
	/** Model call within the run and iteration (retries). Default 0. */
	attempt?: number;
}

export interface SessionReplayModelResponseQuery {
	request: SessionReplayRequestSnapshot;
	position?: SessionReplaySourcePosition;
}

/**
 * How a recorded response was chosen:
 * - `exact`: an unconsumed record with the request's match key.
 * - `equivalent`: a fallback record whose request differs only in ways the
 *   structural comparison ignores (JSON field order).
 * - `call-index`: fallback to the record at the given (or next) call index,
 *   or any record of a source in `call-index` mode.
 * - `position`: fallback to the record with the same run, iteration and attempt.
 */
export type SessionReplayModelResponseMatch =
	| "exact"
	| "equivalent"
	| "call-index"
	| "position";

export interface SessionReplayServedModelResponse {
	status: "served";
	match: SessionReplayModelResponseMatch;
	/** 1-based session iteration the record belongs to (playback numbering). */
	iteration: number;
	record: SessionRecordedModelCall;
	/** The model stream as recorded, with ms offsets from the call start. */
	events: SessionRecordedModelCall["response"]["events"];
	/** Request differences; empty for `exact` and `equivalent`. */
	divergences: SessionReplayDivergence[];
}

export interface SessionReplayMissingModelResponse {
	status: "missing";
	reason: string;
}

export type SessionReplayModelResponse =
	| SessionReplayServedModelResponse
	| SessionReplayMissingModelResponse;

export interface SessionReplayToolResult {
	toolCallId: string;
	toolName: string;
	/** Result content as persisted in the transcript. */
	content: unknown;
	isError: boolean;
	/** 1-based session iteration of the tool call. */
	iteration: number | null;
	/** `seq` of the recorded `tool_finished` event, when recorded. */
	seq?: number;
	/** What the tool observed (file hashes, command cwd/exit), when recorded. */
	environment?: ToolEnvironmentFacts;
}

/**
 * What replay needs from a recording, in the order the loop asks for it.
 * A source is stateful: model responses, tool results and decisions are
 * consumed as they are served, so repeated keys (a retried request, a reused
 * tool call id) resolve to successive records.
 *
 * In `strict` mode a request that cannot be served exactly (or equivalently)
 * throws {@link SessionReplayMismatchError} naming the iteration and the
 * first difference, as does a tool call with no recorded result. In
 * `lenient` mode the fallback record is served with its divergences, and
 * misses are returned (`status: "missing"`, `undefined`) instead of thrown.
 */
export interface SessionReplaySource {
	readonly sessionId: string;
	readonly strictness: SessionReplayStrictness;
	readonly mode: SessionReplaySourceMode;
	/**
	 * The recorded response for a live request: the lowest-`callIndex`
	 * unconsumed record with the same match key, else a fallback by
	 * `callIndex` or by run/iteration/attempt (see {@link SessionReplayModelResponseMatch}).
	 */
	nextModelResponse(
		query: SessionReplayModelResponseQuery,
	): SessionReplayModelResponse;
	/** The next unconsumed recorded result for this tool call id. */
	toolResult(toolCallId: string): SessionReplayToolResult | undefined;
	/**
	 * Recorded decisions with `seq` before the given point, not yet returned.
	 * `{ callIndex }` means "before that model call finished".
	 */
	decisionsDue(
		point: { seq: number } | { callIndex: number },
	): SessionReplayEvent[];
	/**
	 * Recorded environment facts for a tool call, without consuming it: the
	 * next unconsumed result's facts, else the last served one's.
	 */
	toolEnvironment(toolCallId: string): ToolEnvironmentFacts | undefined;
	/** What has not been served yet, for end-of-run checks. */
	remaining(): {
		modelCalls: number[];
		toolResults: string[];
		decisions: number;
	};
}

export class SessionReplayMismatchError extends Error {
	readonly iteration: number | null;
	readonly callIndex?: number;
	readonly toolCallId?: string;
	readonly divergences: SessionReplayDivergence[];

	constructor(input: {
		message: string;
		iteration: number | null;
		callIndex?: number;
		toolCallId?: string;
		divergences?: SessionReplayDivergence[];
	}) {
		super(input.message);
		this.name = "SessionReplayMismatchError";
		this.iteration = input.iteration;
		if (input.callIndex !== undefined) this.callIndex = input.callIndex;
		if (input.toolCallId !== undefined) this.toolCallId = input.toolCallId;
		this.divergences = input.divergences ?? [];
	}
}

/**
 * How a source picks recorded model responses:
 * - `match-key`: by the live request's match key, with fallbacks (a recording).
 * - `call-index`: in call order, from the transcript's assistant messages,
 *   with no request comparison. For sessions without request records, such as
 *   imported ATIF trajectories.
 */
export type SessionReplaySourceMode = "match-key" | "call-index";

export interface CreateSessionReplaySourceOptions {
	/** Default `strict`. */
	strictness?: SessionReplayStrictness;
	/** Default: `call-index` when the session has no request records, else `match-key`. */
	mode?: SessionReplaySourceMode;
}

/**
 * In-memory request records for a transcript without a recording: one per
 * assistant message that is a model call, in order. They carry the response
 * (message id, tool call ids, usage and a model stream rebuilt from the
 * message) but no request, so they cannot be matched by key.
 */
export function sessionReplayModelCallsFromTranscript(
	session: Pick<SessionReplaySessionData, "transcript">,
	agentId = "agent",
): SessionRecordedModelCall[] {
	const { messages, sessionId } = session.transcript;
	const groups = groupSessionMessageIterations(messages);
	return groups.flatMap((group, position) => {
		const index = group.assistantIndex;
		const message = index === undefined ? undefined : messages[index];
		if (!message || index === undefined) return [];
		const blocks = typeof message.content === "string" ? [] : message.content;
		const text =
			typeof message.content === "string"
				? message.content
				: blocks
						.flatMap((block) => (block.type === "text" ? [block.text] : []))
						.join("");
		const toolUses = blocks.filter(
			(block): block is Extract<typeof block, { type: "tool_use" }> =>
				block.type === "tool_use",
		);
		const metrics = message.metrics;
		const usage = metrics
			? {
					...(metrics.inputTokens !== undefined
						? { inputTokens: metrics.inputTokens }
						: {}),
					...(metrics.outputTokens !== undefined
						? { outputTokens: metrics.outputTokens }
						: {}),
					...(metrics.cacheReadTokens !== undefined
						? { cacheReadTokens: metrics.cacheReadTokens }
						: {}),
					...(metrics.cacheWriteTokens !== undefined
						? { cacheWriteTokens: metrics.cacheWriteTokens }
						: {}),
					...(metrics.cost !== undefined ? { totalCost: metrics.cost } : {}),
				}
			: null;
		const at = new Date(
			typeof message.ts === "number" && Number.isFinite(message.ts)
				? message.ts
				: 0,
		).toISOString();
		const events: SessionRecordedModelCall["response"]["events"] = [
			...blocks.flatMap((block) =>
				block.type === "thinking"
					? [{ t: 0, event: { type: "reasoning-delta", text: block.thinking } }]
					: [],
			),
			...(text ? [{ t: 0, event: { type: "text-delta", text } }] : []),
			...toolUses.map((block) => ({
				t: 0,
				event: {
					type: "tool-call-delta",
					toolCallId: block.id,
					toolName: block.name,
					input: block.input,
				},
			})),
			...(usage ? [{ t: 0, event: { type: "usage", usage } }] : []),
			{
				t: 0,
				event: {
					type: "finish",
					reason: toolUses.length > 0 ? "tool-calls" : "stop",
				},
			},
		];
		return [
			{
				callIndex: position,
				seq: index,
				sessionId,
				agentId,
				runId: null,
				iteration: position + 1,
				attempt: 0,
				startedAt: at,
				finishedAt: at,
				durationMs: 0,
				compaction: null,
				request: {
					matchKey: "",
					systemPromptSha256: null,
					toolsSha256: "",
					modelToolsSha256: null,
					messageCount: index,
					messagePrefix: null,
					messageSha256s: [],
					options: null,
					provider: {},
				},
				response: {
					outcome: "completed",
					finishReason: toolUses.length > 0 ? "tool-calls" : "stop",
					requestId: null,
					error: null,
					messageId: message.id ?? null,
					toolCallIds: toolUses.map((block) => block.id),
					usage,
					events,
				},
			},
		];
	});
}

interface ToolResultEntry extends SessionReplayToolResult {
	consumed: boolean;
}

function toolEnvironmentOf(
	metadata: Record<string, unknown> | undefined,
): ToolEnvironmentFacts | undefined {
	const facts = metadata?.[TOOL_ENVIRONMENT_METADATA_KEY];
	return facts && typeof facts === "object"
		? (facts as ToolEnvironmentFacts)
		: undefined;
}

class BundleSessionReplaySource implements SessionReplaySource {
	readonly sessionId: string;
	readonly strictness: SessionReplayStrictness;
	readonly mode: SessionReplaySourceMode;
	private readonly session: SessionReplaySessionData;
	private readonly records: SessionRecordedModelCall[];
	private readonly consumedCalls = new Set<number>();
	private readonly resolvedMessages: Map<number, string[]>;
	private readonly iterationByCall = new Map<number, number>();
	private readonly toolResults = new Map<string, ToolResultEntry[]>();
	private readonly lastServedTool = new Map<string, ToolResultEntry>();
	private readonly decisions: SessionReplayEvent[];
	private decisionCursor = 0;

	constructor(
		session: SessionReplaySessionData,
		options: CreateSessionReplaySourceOptions,
	) {
		this.session = session;
		this.sessionId = session.transcript.sessionId;
		this.strictness = options.strictness ?? "strict";
		this.mode =
			options.mode ??
			(session.requests.length === 0 ? "call-index" : "match-key");
		this.records =
			session.requests.length > 0
				? [...session.requests].sort((a, b) => a.callIndex - b.callIndex)
				: this.mode === "call-index"
					? sessionReplayModelCallsFromTranscript(session)
					: [];
		this.resolvedMessages =
			session.requests.length > 0
				? resolveRecordedRequestMessages(this.records).messages
				: new Map();
		this.decisions = session.events
			.filter((event) => event.kind === "decision" && event.seq !== undefined)
			.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));

		const iterations = buildSessionReplayIterations({
			transcript: session.transcript,
			events: session.events,
			requests: session.requests,
		});
		for (const iteration of iterations) {
			for (const call of iteration.modelCalls ?? []) {
				this.iterationByCall.set(call.callIndex, iteration.index);
			}
		}
		const iterationOfMessage = (messageIndex: number): number | null =>
			iterations.find(
				(iteration) =>
					messageIndex >= iteration.messageRange.start &&
					messageIndex < iteration.messageRange.end,
			)?.index ?? null;

		const finishedSeqs = new Map<string, number[]>();
		for (const event of [...session.events].sort(
			(a, b) => (a.seq ?? 0) - (b.seq ?? 0),
		)) {
			if (
				event.kind === "runtime" &&
				event.name === "tool_finished" &&
				event.toolCallId &&
				event.seq !== undefined
			) {
				const list = finishedSeqs.get(event.toolCallId) ?? [];
				list.push(event.seq);
				finishedSeqs.set(event.toolCallId, list);
			}
		}
		for (const [
			messageIndex,
			message,
		] of session.transcript.messages.entries()) {
			if (typeof message.content === "string") continue;
			const environment = toolEnvironmentOf(message.metadata);
			for (const block of message.content) {
				if (block.type !== "tool_result") continue;
				const list = this.toolResults.get(block.tool_use_id) ?? [];
				const seq = finishedSeqs.get(block.tool_use_id)?.[list.length];
				list.push({
					toolCallId: block.tool_use_id,
					toolName: block.name,
					content: block.content,
					isError: block.is_error === true,
					iteration: iterationOfMessage(messageIndex),
					...(seq !== undefined ? { seq } : {}),
					...(environment ? { environment } : {}),
					consumed: false,
				});
				this.toolResults.set(block.tool_use_id, list);
			}
		}
	}

	private iterationOf(record: SessionRecordedModelCall): number {
		return this.iterationByCall.get(record.callIndex) ?? record.iteration;
	}

	private recordedSnapshot(
		record: SessionRecordedModelCall,
	): SessionReplayRequestSnapshot {
		return describeRecordedModelRequest(
			record,
			this.session.blobs,
			this.resolvedMessages.get(record.callIndex),
		);
	}

	private unconsumed(): SessionRecordedModelCall[] {
		return this.records.filter(
			(record) => !this.consumedCalls.has(record.callIndex),
		);
	}

	private fallbackCandidate(
		position: SessionReplaySourcePosition | undefined,
	):
		| { record: SessionRecordedModelCall; match: "call-index" | "position" }
		| undefined {
		const open = this.unconsumed();
		if (position?.callIndex !== undefined) {
			const record = open.find(
				(candidate) => candidate.callIndex === position.callIndex,
			);
			return record ? { record, match: "call-index" } : undefined;
		}
		if (position?.iteration !== undefined) {
			const attempt = position.attempt ?? 0;
			const sameRun =
				position.runId &&
				this.records.some((record) => record.runId === position.runId);
			const record = open.find(
				(candidate) =>
					candidate.iteration === position.iteration &&
					candidate.attempt === attempt &&
					(!sameRun || candidate.runId === position.runId),
			);
			if (record) return { record, match: "position" };
		}
		const next = open[0];
		return next ? { record: next, match: "call-index" } : undefined;
	}

	private serve(
		record: SessionRecordedModelCall,
		match: SessionReplayModelResponseMatch,
		divergences: SessionReplayDivergence[],
	): SessionReplayServedModelResponse {
		this.consumedCalls.add(record.callIndex);
		return {
			status: "served",
			match,
			iteration: this.iterationOf(record),
			record,
			events: record.response.events,
			divergences,
		};
	}

	nextModelResponse(
		query: SessionReplayModelResponseQuery,
	): SessionReplayModelResponse {
		if (this.mode === "call-index") {
			return this.nextByCallIndex(query);
		}
		const live = query.request;
		const exact = this.unconsumed().find(
			(record) => record.request.matchKey === live.matchKey,
		);
		const candidate = exact
			? { record: exact, match: "exact" as const }
			: this.fallbackCandidate(query.position);
		if (!candidate) return this.missing(query);
		const { record } = candidate;
		const iteration = this.iterationOf(record);
		const divergences = diffSessionReplayRequests(
			this.recordedSnapshot(record),
			live,
			{ iteration },
		);
		if (divergences.length === 0) {
			return this.serve(record, exact ? "exact" : "equivalent", []);
		}
		if (this.strictness === "strict") {
			const [first] = divergences;
			throw new SessionReplayMismatchError({
				message: [
					`Replay request does not match the recording at iteration ${iteration} (model call ${record.callIndex}, run iteration ${record.iteration}, attempt ${record.attempt}):`,
					...(first ? formatSessionReplayDivergence(first) : []),
					...(divergences.length > 1
						? [
								`  and ${divergences.length - 1} more: ${divergences
									.slice(1)
									.map((divergence) => divergence.kind)
									.join(", ")}`,
							]
						: []),
				].join("\n"),
				iteration,
				callIndex: record.callIndex,
				divergences,
			});
		}
		return this.serve(record, candidate.match, divergences);
	}

	private missing(
		query: SessionReplayModelResponseQuery,
	): SessionReplayMissingModelResponse {
		const reason =
			this.records.length === 0
				? `session ${this.sessionId} has no recorded model calls`
				: `all ${this.records.length} recorded model calls of session ${this.sessionId} were already served`;
		if (this.strictness === "strict") {
			throw new SessionReplayMismatchError({
				message: `No recorded model response for the request${query.position?.iteration !== undefined ? ` at run iteration ${query.position.iteration}` : ""}: ${reason}.`,
				iteration: null,
			});
		}
		return { status: "missing", reason };
	}

	/** Serves the record at the given call index, else the next one; requests are not compared. */
	private nextByCallIndex(
		query: SessionReplayModelResponseQuery,
	): SessionReplayModelResponse {
		const open = this.unconsumed();
		const wanted = query.position?.callIndex;
		const record =
			wanted !== undefined
				? open.find((candidate) => candidate.callIndex === wanted)
				: open[0];
		return record ? this.serve(record, "call-index", []) : this.missing(query);
	}

	toolResult(toolCallId: string): SessionReplayToolResult | undefined {
		const entry = this.toolResults
			.get(toolCallId)
			?.find((candidate) => !candidate.consumed);
		if (!entry) {
			if (this.strictness === "strict") {
				const served = this.lastServedTool.get(toolCallId);
				throw new SessionReplayMismatchError({
					message: served
						? `Tool call ${toolCallId} has no further recorded result (its recorded result at iteration ${served.iteration ?? "?"} was already served).`
						: `No recorded result for tool call ${toolCallId} in session ${this.sessionId}.`,
					iteration: served?.iteration ?? null,
					toolCallId,
				});
			}
			return undefined;
		}
		entry.consumed = true;
		this.lastServedTool.set(toolCallId, entry);
		const { consumed: _consumed, ...result } = entry;
		return result;
	}

	decisionsDue(
		point: { seq: number } | { callIndex: number },
	): SessionReplayEvent[] {
		const boundary =
			"seq" in point
				? point.seq
				: (this.records.find((record) => record.callIndex === point.callIndex)
						?.seq ?? Number.POSITIVE_INFINITY);
		const due: SessionReplayEvent[] = [];
		while (this.decisionCursor < this.decisions.length) {
			const event = this.decisions[this.decisionCursor];
			if (!event || (event.seq ?? 0) >= boundary) break;
			due.push(event);
			this.decisionCursor += 1;
		}
		return due;
	}

	toolEnvironment(toolCallId: string): ToolEnvironmentFacts | undefined {
		const next = this.toolResults
			.get(toolCallId)
			?.find((candidate) => !candidate.consumed);
		return (next ?? this.lastServedTool.get(toolCallId))?.environment;
	}

	remaining(): {
		modelCalls: number[];
		toolResults: string[];
		decisions: number;
	} {
		return {
			modelCalls: this.unconsumed().map((record) => record.callIndex),
			toolResults: [...this.toolResults.values()]
				.flat()
				.filter((entry) => !entry.consumed)
				.map((entry) => entry.toolCallId),
			decisions: this.decisions.length - this.decisionCursor,
		};
	}
}

/** A replay source over one loaded bundle session. */
export function createSessionReplaySource(
	session: SessionReplaySessionData,
	options: CreateSessionReplaySourceOptions = {},
): SessionReplaySource {
	return new BundleSessionReplaySource(session, options);
}

/** Reads a bundle and opens a replay source over one of its sessions (default: the root). */
export async function openSessionReplaySource(
	bundleDir: string,
	options: CreateSessionReplaySourceOptions & { sessionId?: string } = {},
): Promise<SessionReplaySource> {
	const bundle = await readSessionReplayBundle(bundleDir);
	const sessionId = options.sessionId ?? bundle.manifest.rootSessionId;
	const session = bundle.sessions.find(
		(candidate) => candidate.entry.sessionId === sessionId,
	);
	if (!session) {
		throw new SessionReplayBundleError(
			`Session ${sessionId} is not in the bundle at ${bundle.dir}.`,
		);
	}
	return createSessionReplaySource(session, options);
}
