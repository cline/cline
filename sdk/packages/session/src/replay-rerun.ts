import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	AgentResult,
	ClineCoreStartInput,
	CoreSessionEvent,
	SendSessionInput,
	StartSessionResult,
} from "@cline/core";
import { isUserRunMessage } from "@cline/core";
import {
	createSessionId,
	type MessageWithMetadata,
	parseUserInputMode,
	type SessionReplayEvent,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";
import { buildSessionReplayIterations } from "./bundle-iterations";
import {
	mergeSessionReplayEvents,
	readSessionRecording,
	toSessionReplayRecordedEvents,
} from "./bundle-recording";
import {
	buildSessionReplayComparableIterations,
	compareSessionReplayIteration,
	compareSessionReplayIterations,
	SESSION_REPLAY_RERUN_DIVERGENCE_KINDS,
	type SessionReplayComparableIteration,
	type SessionReplayComparableToolCall,
	type SessionReplayDivergenceReport,
	type SessionReplaySessionData,
} from "./replay-compare";
import {
	SESSION_REPLAY_DIVERGENCE_KINDS,
	SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS,
	type SessionReplayDivergence,
	type SessionReplayDivergenceKind,
} from "./replay-diff";
import {
	mapSessionReplaySessionData,
	type SessionReplayPathMap,
} from "./replay-environment";
import {
	createSessionReplaySource,
	type SessionReplayModelResponseMatch,
	type SessionReplaySource,
} from "./replay-source";

// ── Divergence kinds and request matching ─────────────────────────────────

/**
 * How strictly a rerun's requests must match the recording:
 * - `strict`: model, system prompt, tool definitions and messages all count.
 * - `relaxed`: only messages and tool definitions count, because `--model`
 *   or `--provider` changed what the model id and system prompt can be.
 * - `lenient`: request differences are reported but none count.
 */
export const SESSION_REPLAY_REQUEST_MATCHING = [
	"strict",
	"relaxed",
	"lenient",
] as const;
export type SessionReplayRequestMatching =
	(typeof SESSION_REPLAY_REQUEST_MATCHING)[number];

/** A bad rerun option: an unknown kind name, or a kind both ignored and counted. */
export class SessionReplayRerunOptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionReplayRerunOptionError";
	}
}

/**
 * Parses a comma-separated divergence kind list (`--ignore`, `--count`).
 * `request` names every request kind.
 */
export function parseSessionReplayDivergenceKinds(
	value: string | undefined,
	flag: string,
): SessionReplayDivergenceKind[] {
	const kinds = new Set<SessionReplayDivergenceKind>();
	for (const raw of (value ?? "").split(",")) {
		const name = raw.trim();
		if (!name) continue;
		if (name === "request") {
			for (const kind of SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS) {
				kinds.add(kind);
			}
		} else if (
			(SESSION_REPLAY_DIVERGENCE_KINDS as readonly string[]).includes(name)
		) {
			kinds.add(name as SessionReplayDivergenceKind);
		} else {
			throw new SessionReplayRerunOptionError(
				`Unknown divergence kind "${name}" in ${flag}. Kinds: ${SESSION_REPLAY_DIVERGENCE_KINDS.join(", ")}, or "request" for all request kinds.`,
			);
		}
	}
	return SESSION_REPLAY_DIVERGENCE_KINDS.filter((kind) => kinds.has(kind));
}

export interface ResolveSessionReplayRerunKindsOptions {
	/** Comma-separated kinds that do not count. */
	ignore?: string;
	/** Comma-separated kinds that count in addition to the defaults. */
	count?: string;
	/** Request differences are reported but do not count. */
	lenient?: boolean;
	/** `--model` or `--provider` was given. */
	modelOverride?: boolean;
}

/**
 * The kinds a rerun counts. Starts from {@link SESSION_REPLAY_RERUN_DIVERGENCE_KINDS}
 * (everything but assistant text, which a live model rarely repeats word for
 * word), relaxes request matching for a model override or `lenient`, then
 * applies `ignore` and `count`. `count` wins over the relaxations, so
 * `--model x --count request-system-prompt` still checks the system prompt.
 */
export function resolveSessionReplayRerunKinds(
	options: ResolveSessionReplayRerunKindsOptions = {},
): {
	kinds: SessionReplayDivergenceKind[];
	requestMatching: SessionReplayRequestMatching;
} {
	const ignored = parseSessionReplayDivergenceKinds(options.ignore, "--ignore");
	const counted = parseSessionReplayDivergenceKinds(options.count, "--count");
	const both = ignored.filter((kind) => counted.includes(kind));
	if (both.length > 0) {
		throw new SessionReplayRerunOptionError(
			`${both.join(", ")} cannot be both ignored (--ignore) and counted (--count).`,
		);
	}
	const requestMatching: SessionReplayRequestMatching = options.lenient
		? "lenient"
		: options.modelOverride
			? "relaxed"
			: "strict";
	const relaxed = new Set<SessionReplayDivergenceKind>(
		requestMatching === "lenient"
			? SESSION_REPLAY_REQUEST_DIVERGENCE_KINDS
			: requestMatching === "relaxed"
				? ["request-model", "request-system-prompt"]
				: [],
	);
	const kinds = new Set(
		SESSION_REPLAY_RERUN_DIVERGENCE_KINDS.filter(
			(kind) => !relaxed.has(kind) && !ignored.includes(kind),
		),
	);
	for (const kind of counted) kinds.add(kind);
	return {
		kinds: SESSION_REPLAY_DIVERGENCE_KINDS.filter((kind) => kinds.has(kind)),
		requestMatching,
	};
}

// ── Recorded turns ────────────────────────────────────────────────────────

/** A user prompt the recorded session ran, in the order it ran them. */
export interface SessionReplayRerunTurn {
	/** 1-based recorded iteration the prompt started. */
	iteration: number;
	/** The prompt as persisted (the host normalizes and re-wraps it on send). */
	prompt: string;
	/**
	 * How it was delivered: with `start` (non-interactive one-shot), with
	 * `send`, or drained from the queue after the previous turn.
	 */
	source: "start" | "send" | "queue";
	mode?: "act" | "plan" | "yolo";
	/** Image and file blocks on the prompt; not replayed. */
	attachments: number;
}

function promptText(message: MessageWithMetadata): {
	text: string;
	attachments: number;
	toolResult: boolean;
} {
	if (typeof message.content === "string") {
		return { text: message.content, attachments: 0, toolResult: false };
	}
	const text: string[] = [];
	let attachments = 0;
	let toolResult = false;
	for (const block of message.content) {
		if (block.type === "text") text.push(block.text);
		else if (block.type === "tool_result") toolResult = true;
		else if (block.type === "image" || block.type === "file") attachments += 1;
	}
	return { text: text.join("\n"), attachments, toolResult };
}

/**
 * The prompts a rerun sends: the session's user turns, each paired with
 * the recorded delivery that ran it. Steered prompts and compaction
 * summaries are not turns; they are listed in `warnings`.
 */
export function collectSessionReplayRerunTurns(
	session: SessionReplaySessionData,
	options: { interactive?: boolean } = {},
): { turns: SessionReplayRerunTurn[]; warnings: string[] } {
	const warnings: string[] = [];
	const iterations = buildSessionReplayIterations({
		transcript: session.transcript,
		events: session.events,
		requests: session.requests,
	});
	const iterationOf = (messageIndex: number) =>
		iterations.find(
			(iteration) =>
				messageIndex >= iteration.messageRange.start &&
				messageIndex < iteration.messageRange.end,
		)?.index ?? iterations.length + 1;
	const deliveries = session.events
		.filter(
			(event) => event.kind === "decision" && event.name === "prompt_delivered",
		)
		.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
	const turnDeliveries = deliveries.filter((event) => {
		const delivery = (event.payload as { delivery?: unknown } | undefined)
			?.delivery;
		return delivery === "immediate" || delivery === "queue";
	});
	const steers = deliveries.length - turnDeliveries.length;
	if (steers > 0) {
		warnings.push(
			`${steers} steered prompt${steers === 1 ? " was" : "s were"} not replayed; the rerun is expected to diverge where ${steers === 1 ? "it was" : "they were"} injected.`,
		);
	}
	const turns: SessionReplayRerunTurn[] = [];
	for (const [index, message] of session.transcript.messages.entries()) {
		if (message.role !== "user" || !isUserRunMessage(message)) continue;
		const kind = message.metadata?.kind;
		if (kind === "compaction" || kind === "compaction_summary") {
			warnings.push(
				`The transcript starts from a compaction summary (message ${index + 1}); turns before it cannot be replayed.`,
			);
			continue;
		}
		const { text, attachments, toolResult } = promptText(message);
		if (toolResult) continue;
		const delivery = turnDeliveries[turns.length];
		const payload = (delivery?.payload ?? {}) as {
			delivery?: string;
			source?: string;
		};
		const source: SessionReplayRerunTurn["source"] = delivery
			? payload.delivery === "queue"
				? "queue"
				: payload.source === "start"
					? "start"
					: "send"
			: turns.length === 0 && options.interactive === false
				? "start"
				: "send";
		const mode = parseUserInputMode(text);
		if (attachments > 0) {
			warnings.push(
				`The prompt at iteration ${iterationOf(index)} had ${attachments} attachment${attachments === 1 ? "" : "s"}, which are not replayed.`,
			);
		}
		turns.push({
			iteration: iterationOf(index),
			prompt: text,
			source,
			...(mode ? { mode } : {}),
			attachments,
		});
	}
	return { turns, warnings };
}

// ── Recorded approvals ────────────────────────────────────────────────────

interface RecordedApproval {
	seq: number;
	iteration: number | null;
	toolCallId?: string;
	toolName?: string;
	approved: boolean;
	reason?: string;
	decidedBy?: ToolApprovalResult["decidedBy"];
}

/** What `--interactive` asks: the live request and what the recording answered. */
export interface SessionReplayRerunApprovalPrompt {
	request: ToolApprovalRequest;
	/** The recorded answer this request lines up with, if any. */
	recorded?: Pick<RecordedApproval, "approved" | "reason" | "iteration">;
}

export interface SessionReplayRerunApproval {
	/** 1-based live session iteration. */
	iteration: number;
	toolName: string;
	toolCallId: string;
	approved: boolean;
	reason?: string;
	/**
	 * `recording`: answered as recorded (matched by tool call id, else tool
	 * name). `interactive`: asked. `no-recording`: denied, nothing recorded.
	 */
	source: "recording" | "interactive" | "no-recording";
	recordedSeq?: number;
}

// ── Rerun ─────────────────────────────────────────────────────────────────

/** What a rerun needs from a ClineCore. */
export interface SessionReplayRerunCore {
	start(input: ClineCoreStartInput): Promise<StartSessionResult>;
	send(input: SendSessionInput): Promise<AgentResult | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	subscribe(
		listener: (event: CoreSessionEvent) => void,
		options?: { sessionId?: string },
	): () => void;
	readMessages(sessionId: string): Promise<MessageWithMetadata[]>;
}

export type SessionReplayRerunProgress =
	| { type: "turn"; turn: number; of: number; iteration: number }
	| { type: "iteration-started"; iteration: number }
	| {
			type: "iteration";
			iteration: number;
			/** Every difference in the iteration, counted or not. */
			divergences: SessionReplayDivergence[];
			counted: boolean;
	  }
	| { type: "approval"; approval: SessionReplayRerunApproval }
	| {
			type: "stopped";
			iteration: number;
			divergence: SessionReplayDivergence;
	  };

export interface CreateSessionReplayRerunOptions {
	/** The recorded session (a loaded bundle session). */
	recorded: SessionReplaySessionData & {
		entry?: { interactive?: boolean };
	};
	/** Kinds that count. Default {@link SESSION_REPLAY_RERUN_DIVERGENCE_KINDS}. */
	kinds?: readonly SessionReplayDivergenceKind[];
	/** Stop at the first counted divergence. Default false (run to the end). */
	untilDivergence?: boolean;
	/** Recorded workspace path → rebuilt workspace path. */
	pathMap?: SessionReplayPathMap;
	/** Asks instead of answering approvals from the recording (`--interactive`). */
	decideApproval?: (
		prompt: SessionReplayRerunApprovalPrompt,
	) => Promise<ToolApprovalResult>;
	/** Overrides `entry.interactive` for how the session is started. */
	interactive?: boolean;
}

export interface RunSessionReplayRerunOptions {
	core: SessionReplayRerunCore;
	/**
	 * Start input without prompt and interactivity (taken from the recording).
	 * The rerun sets `config.sessionId` (when absent) and turns recording on.
	 */
	start: Omit<ClineCoreStartInput, "prompt" | "interactive">;
	/** Where the hub writes session recordings. Default: the session data dir. */
	sessionsDir?: string;
	/** Fallback poll interval while a turn runs. Default 200ms. */
	pollMs?: number;
	/** How long to wait for the recording's last run to be flushed. Default 15s. */
	flushTimeoutMs?: number;
	onProgress?: (progress: SessionReplayRerunProgress) => void;
}

export interface SessionReplayRerunMatch {
	/** 1-based live iteration. */
	iteration: number;
	/** How the live request lined up with a recorded model call (lenient source lookup). */
	match: SessionReplayModelResponseMatch | "missing";
	/** Recorded iteration it lined up with. */
	recordedIteration?: number;
}

export interface SessionReplayRerunResult {
	sessionId: string;
	/** Recorded vs live, iteration by iteration (truncated at the stop when stopped). */
	comparison: SessionReplayDivergenceReport;
	matches: SessionReplayRerunMatch[];
	approvals: SessionReplayRerunApproval[];
	turns: { recorded: number; sent: number };
	stopped: {
		reason: "until-divergence";
		iteration: number;
		kind: SessionReplayDivergenceKind;
	} | null;
	/** Last turn's finish reason, when a turn finished. */
	finishReason?: string;
	warnings: string[];
}

export interface SessionReplayRerun {
	readonly turns: readonly SessionReplayRerunTurn[];
	readonly recordedIterations: readonly SessionReplayComparableIteration[];
	readonly kinds: readonly SessionReplayDivergenceKind[];
	/** Pass as the session's `requestToolApproval` capability. */
	requestToolApproval(
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult>;
	run(options: RunSessionReplayRerunOptions): Promise<SessionReplayRerunResult>;
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function payloadOf(event: SessionReplayEvent): Record<string, unknown> {
	return event.payload && typeof event.payload === "object"
		? (event.payload as Record<string, unknown>)
		: {};
}

class SessionReplayRerunImpl implements SessionReplayRerun {
	readonly turns: SessionReplayRerunTurn[];
	readonly recordedIterations: SessionReplayComparableIteration[];
	readonly kinds: SessionReplayDivergenceKind[];
	private readonly recorded: CreateSessionReplayRerunOptions["recorded"];
	private readonly options: CreateSessionReplayRerunOptions;
	private readonly source: SessionReplaySource;
	private readonly turnWarnings: string[];
	private readonly iterationBySeq = new Map<number, number>();
	private readonly pendingApprovals: RecordedApproval[] = [];
	private readonly approvals: SessionReplayRerunApproval[] = [];
	private onProgress?: (progress: SessionReplayRerunProgress) => void;

	private liveIteration = 0;
	private readonly liveToolCalls = new Map<
		number,
		SessionReplayComparableToolCall[]
	>();
	private iterationsEnded = 0;
	private readonly checked = new Set<number>();
	private stopped: SessionReplayRerunResult["stopped"] = null;
	private stopDivergences: SessionReplayDivergence[] = [];
	private abortStop?: () => void;
	private wake?: () => void;

	constructor(options: CreateSessionReplayRerunOptions) {
		this.options = options;
		this.recorded = options.recorded;
		this.kinds = [...(options.kinds ?? SESSION_REPLAY_RERUN_DIVERGENCE_KINDS)];
		this.recordedIterations = buildSessionReplayComparableIterations(
			options.recorded,
		);
		const interactive =
			options.interactive ?? options.recorded.entry?.interactive;
		const collected = collectSessionReplayRerunTurns(options.recorded, {
			...(interactive !== undefined ? { interactive } : {}),
		});
		this.turns = collected.turns;
		this.turnWarnings = collected.warnings;
		this.source = createSessionReplaySource(options.recorded, {
			strictness: "lenient",
		});
		for (const iteration of this.recordedIterations) {
			for (const decision of [
				...iteration.decisions.beforeModelCall,
				...iteration.decisions.afterModelCall,
			]) {
				if (decision.seq !== undefined) {
					this.iterationBySeq.set(decision.seq, iteration.index);
				}
			}
		}
	}

	private get interactive(): boolean {
		return (
			this.options.interactive ?? this.recorded.entry?.interactive ?? false
		);
	}

	private toLive<T>(value: T): T {
		return this.options.pathMap ? this.options.pathMap.toLive(value) : value;
	}

	private toRecorded<T>(value: T): T {
		return this.options.pathMap
			? this.options.pathMap.toRecorded(value)
			: value;
	}

	private emit(progress: SessionReplayRerunProgress): void {
		try {
			this.onProgress?.(progress);
		} catch {
			// A progress renderer must not break the rerun.
		}
	}

	private counts(kind: SessionReplayDivergenceKind): boolean {
		return this.kinds.includes(kind);
	}

	/** Recorded decisions up to the end of the live iteration's recorded counterpart. */
	private pullRecordedApprovals(): void {
		const next = this.recordedIterations[this.liveIteration];
		const due = next?.modelCall
			? this.source.decisionsDue({ callIndex: next.modelCall.callIndex })
			: this.source.decisionsDue({ seq: Number.MAX_SAFE_INTEGER });
		for (const event of due) {
			if (event.name !== "approval_resolved" || event.seq === undefined) {
				continue;
			}
			const payload = payloadOf(event);
			this.pendingApprovals.push({
				seq: event.seq,
				iteration: this.iterationBySeq.get(event.seq) ?? null,
				...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
				...(typeof payload.toolName === "string"
					? { toolName: payload.toolName }
					: {}),
				approved: payload.approved === true,
				...(typeof payload.reason === "string"
					? { reason: payload.reason }
					: {}),
				...(payload.decidedBy && typeof payload.decidedBy === "object"
					? {
							decidedBy: payload.decidedBy as ToolApprovalResult["decidedBy"],
						}
					: {}),
			});
		}
	}

	private takeRecordedApproval(
		request: ToolApprovalRequest,
	): RecordedApproval | undefined {
		this.pullRecordedApprovals();
		const byId = this.pendingApprovals.findIndex(
			(approval) => approval.toolCallId === request.toolCallId,
		);
		const index =
			byId >= 0
				? byId
				: this.pendingApprovals.findIndex(
						(approval) => approval.toolName === request.toolName,
					);
		if (index < 0) return undefined;
		const [approval] = this.pendingApprovals.splice(index, 1);
		return approval;
	}

	readonly requestToolApproval = async (
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult> => {
		const recorded = this.takeRecordedApproval(request);
		let result: ToolApprovalResult;
		let source: SessionReplayRerunApproval["source"];
		if (this.options.decideApproval) {
			result = await this.options.decideApproval({
				request,
				...(recorded
					? {
							recorded: {
								approved: recorded.approved,
								...(recorded.reason ? { reason: recorded.reason } : {}),
								iteration: recorded.iteration,
							},
						}
					: {}),
			});
			source = "interactive";
		} else if (recorded) {
			result = {
				approved: recorded.approved,
				...(recorded.reason ? { reason: recorded.reason } : {}),
				...(recorded.decidedBy ? { decidedBy: recorded.decidedBy } : {}),
			};
			source = "recording";
		} else {
			result = {
				approved: false,
				reason: `Replay has no recorded approval decision for ${request.toolName}.`,
				decidedBy: { kind: "system", detail: "replay_no_recorded_decision" },
			};
			source = "no-recording";
		}
		const approval: SessionReplayRerunApproval = {
			iteration: this.liveIteration,
			toolName: request.toolName,
			toolCallId: request.toolCallId,
			approved: result.approved,
			...(result.reason ? { reason: result.reason } : {}),
			source,
			...(recorded ? { recordedSeq: recorded.seq } : {}),
		};
		this.approvals.push(approval);
		this.emit({ type: "approval", approval });
		return result;
	};

	private stop(divergences: SessionReplayDivergence[]): void {
		const first = divergences.find((divergence) => divergence.counted);
		if (!first || this.stopped || !this.options.untilDivergence) return;
		this.stopped = {
			reason: "until-divergence",
			iteration: first.iteration,
			kind: first.kind,
		};
		this.stopDivergences = divergences;
		this.emit({
			type: "stopped",
			iteration: first.iteration,
			divergence: first,
		});
		this.abortStop?.();
	}

	/** Live iteration beyond the recording's last. */
	private extraIterationDivergence(
		iteration: number,
	): SessionReplayDivergence[] {
		const report = compareSessionReplayIterations(
			this.recordedIterations,
			[
				...this.recordedIterations,
				...Array.from(
					{ length: iteration - this.recordedIterations.length },
					(_, offset) => ({
						index: this.recordedIterations.length + offset + 1,
						assistantText: "",
						toolCalls: [],
						toolResults: [],
						decisions: { beforeModelCall: [], afterModelCall: [] },
					}),
				),
			],
			{ kinds: this.kinds },
		);
		return report.divergences.filter(
			(divergence) => divergence.kind === "iteration-count",
		);
	}

	/**
	 * Tool calls arrive (as `content_start`) before the tools run, ahead of
	 * the persisted iteration. Compares the calls seen so far with the
	 * recorded iteration's calls at the same positions; everything else is
	 * taken from the recording so only tool-call differences can show.
	 */
	private checkToolCallsEarly(iteration: number): void {
		if (!this.options.untilDivergence || this.stopped) return;
		const recorded = this.recordedIterations[iteration - 1];
		if (!recorded) {
			if (this.counts("iteration-count")) {
				this.stop(this.extraIterationDivergence(iteration));
			}
			return;
		}
		if (!this.counts("tool-calls")) return;
		const live = this.liveToolCalls.get(iteration) ?? [];
		const found = compareSessionReplayIteration(
			{ ...recorded, toolCalls: recorded.toolCalls.slice(0, live.length) },
			{ ...recorded, toolCalls: live },
			{ kinds: this.kinds, includeInheritedMessages: false },
		);
		this.stop(found);
	}

	private onEvent = (event: CoreSessionEvent): void => {
		if (event.type !== "agent_event") return;
		const { event: agentEvent, teamRole } = event.payload;
		if (teamRole === "teammate" || agentEvent.parentAgentId) return;
		switch (agentEvent.type) {
			case "iteration_start":
				this.liveIteration += 1;
				this.liveToolCalls.set(this.liveIteration, []);
				this.emit({ type: "iteration-started", iteration: this.liveIteration });
				if (this.liveIteration > this.recordedIterations.length) {
					this.checkToolCallsEarly(this.liveIteration);
				}
				return;
			case "iteration_end":
				this.iterationsEnded += 1;
				this.wake?.();
				return;
			case "content_start":
				if (agentEvent.contentType !== "tool" || !agentEvent.toolCallId) return;
				{
					const calls = this.liveToolCalls.get(this.liveIteration) ?? [];
					if (calls.some((call) => call.id === agentEvent.toolCallId)) return;
					calls.push({
						id: agentEvent.toolCallId,
						name: agentEvent.toolName ?? "",
						input: this.toRecorded(agentEvent.input),
					});
					this.liveToolCalls.set(this.liveIteration, calls);
					this.checkToolCallsEarly(this.liveIteration);
				}
				return;
			default:
				return;
		}
	};

	private async readLive(
		core: SessionReplayRerunCore,
		sessionId: string,
		sessionsDir: string,
		systemPrompt: string | undefined,
	): Promise<SessionReplaySessionData> {
		const [messages, recording] = await Promise.all([
			core.readMessages(sessionId).catch(() => [] as MessageWithMetadata[]),
			readSessionRecording(join(sessionsDir, sessionId)),
		]);
		const live: SessionReplaySessionData = {
			transcript: {
				sessionId,
				...(systemPrompt !== undefined ? { systemPrompt } : {}),
				messages,
			},
			events: recording
				? mergeSessionReplayEvents(
						toSessionReplayRecordedEvents(recording.events),
					)
				: [],
			requests: recording?.requests ?? [],
			blobs: new Map(
				(recording?.blobs ?? []).map((blob) => [blob.sha256, blob]),
			),
		};
		return this.options.pathMap
			? mapSessionReplaySessionData(live, this.options.pathMap)
			: live;
	}

	/**
	 * Compares every live iteration that is complete and not yet compared.
	 * While a turn runs an iteration is complete once it ended and its tool
	 * results and (if the recorded one has it) request record are on disk;
	 * after the run everything persisted is complete.
	 */
	private checkCompleteIterations(
		live: readonly SessionReplayComparableIteration[],
		final: boolean,
	): void {
		for (const liveIteration of live) {
			const index = liveIteration.index;
			if (this.checked.has(index) || this.stopped) continue;
			const recorded = this.recordedIterations[index - 1];
			if (!final) {
				const ended = index <= this.iterationsEnded || index < live.length;
				const results =
					liveIteration.toolResults.length >= liveIteration.toolCalls.length;
				const request = !recorded?.request || liveIteration.request;
				if (!ended || !results || !request) continue;
			}
			this.checked.add(index);
			const divergences = recorded
				? compareSessionReplayIteration(recorded, liveIteration, {
						kinds: this.kinds,
						includeInheritedMessages: false,
					})
				: this.extraIterationDivergence(index);
			const counted = divergences.some((divergence) => divergence.counted);
			this.emit({ type: "iteration", iteration: index, divergences, counted });
			if (counted) this.stop(divergences);
		}
	}

	private finalReport(
		live: readonly SessionReplayComparableIteration[],
	): SessionReplayDivergenceReport {
		const options = { kinds: this.kinds, includeInheritedMessages: false };
		if (!this.stopped) {
			return compareSessionReplayIterations(
				this.recordedIterations,
				live,
				options,
			);
		}
		const stopAt = this.stopped.iteration;
		const persisted = live[stopAt - 1];
		const recorded = this.recordedIterations[stopAt - 1];
		const persistedAgrees =
			persisted &&
			recorded &&
			compareSessionReplayIteration(recorded, persisted, options).some(
				(divergence) =>
					divergence.counted && divergence.kind === this.stopped?.kind,
			);
		if (persistedAgrees) {
			return compareSessionReplayIterations(
				this.recordedIterations.slice(0, stopAt),
				live.slice(0, stopAt),
				options,
			);
		}
		const before = compareSessionReplayIterations(
			this.recordedIterations.slice(0, stopAt - 1),
			live.slice(0, stopAt - 1),
			options,
		);
		const divergences = [...before.divergences, ...this.stopDivergences];
		const first = divergences.find((divergence) => divergence.counted) ?? null;
		return {
			...before,
			iterations: {
				recorded: this.recordedIterations.length,
				live: Math.max(live.length, stopAt),
			},
			perIteration: [
				...before.perIteration,
				{
					iteration: stopAt,
					kinds: [
						...new Set(
							this.stopDivergences.map((divergence) => divergence.kind),
						),
					],
					counted: this.stopDivergences.some(
						(divergence) => divergence.counted,
					),
				},
			],
			divergences,
			first,
			diverged: first !== null,
			failed: first !== null,
		};
	}

	private matches(
		live: readonly SessionReplayComparableIteration[],
	): SessionReplayRerunMatch[] {
		const source = createSessionReplaySource(this.recorded, {
			strictness: "lenient",
		});
		return live.flatMap((iteration) => {
			if (!iteration.request) return [];
			const response = source.nextModelResponse({
				request: iteration.request,
				...(iteration.modelCall
					? { position: { callIndex: iteration.modelCall.callIndex } }
					: {}),
			});
			return [
				response.status === "served"
					? {
							iteration: iteration.index,
							match: response.match,
							recordedIteration: response.iteration,
						}
					: { iteration: iteration.index, match: "missing" as const },
			];
		});
	}

	private async waitForRecordingFlush(
		sessionsDir: string,
		sessionId: string,
		runs: number,
		timeoutMs: number,
	): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const recording = await readSessionRecording(
				join(sessionsDir, sessionId),
			);
			const finished =
				recording?.events.filter((event) => event.name === "run_finished")
					.length ?? 0;
			if (finished >= runs) return true;
			await sleep(50);
		}
		return false;
	}

	async run(
		options: RunSessionReplayRerunOptions,
	): Promise<SessionReplayRerunResult> {
		const { core } = options;
		this.onProgress = options.onProgress;
		const sessionsDir = options.sessionsDir ?? resolveSessionDataDir();
		const sessionId =
			options.start.config.sessionId?.trim() || createSessionId();
		const systemPrompt = options.start.config.systemPrompt;
		const warnings = [...this.turnWarnings];
		const pollMs = options.pollMs ?? 200;
		if (this.turns.length === 0) {
			throw new Error(
				`Session ${this.recorded.transcript.sessionId} has no user prompt to rerun.`,
			);
		}

		this.abortStop = () => {
			void core
				.abort(
					sessionId,
					new Error("Replay rerun stopped at the first divergence"),
				)
				.catch(() => {});
		};
		const unsubscribe = core.subscribe(this.onEvent, { sessionId });
		let polling = true;
		let checking: Promise<void> = Promise.resolve();
		const check = (final: boolean) => {
			checking = checking.then(async () => {
				const live = buildSessionReplayComparableIterations(
					await this.readLive(core, sessionId, sessionsDir, systemPrompt),
				);
				this.checkCompleteIterations(live, final);
			});
			return checking;
		};
		const poller = (async () => {
			while (polling) {
				await Promise.race([
					sleep(pollMs),
					new Promise<void>((resolve) => {
						this.wake = resolve;
					}),
				]);
				if (!polling) break;
				await check(false).catch(() => {});
			}
		})();

		let started = false;
		let sent = 0;
		let runs = 0;
		let finishReason: string | undefined;
		let sessionClosed = false;
		try {
			for (const [position, turn] of this.turns.entries()) {
				if (this.stopped) break;
				if (sessionClosed) {
					warnings.push(
						`The recorded session ran ${this.turns.length} turns but the rerun's session closed after turn ${position}; the remaining turns were not sent.`,
					);
					break;
				}
				this.emit({
					type: "turn",
					turn: position + 1,
					of: this.turns.length,
					iteration: turn.iteration,
				});
				const prompt = this.toLive(turn.prompt);
				let result: AgentResult | undefined;
				if (!started && turn.source === "start") {
					const startedSession = await core.start({
						...options.start,
						config: {
							...options.start.config,
							sessionId,
							recording: { enabled: true },
						},
						prompt,
						interactive: this.interactive,
					});
					started = true;
					result =
						startedSession.result ??
						(await core.send({
							sessionId,
							prompt,
							...(turn.mode ? { mode: turn.mode } : {}),
						}));
					sessionClosed = startedSession.result !== undefined;
				} else {
					if (!started) {
						await core.start({
							...options.start,
							config: {
								...options.start.config,
								sessionId,
								recording: { enabled: true },
							},
							interactive: this.interactive,
						});
						started = true;
					}
					result = await core.send({
						sessionId,
						prompt,
						...(turn.mode ? { mode: turn.mode } : {}),
					});
				}
				sent += 1;
				runs += 1;
				finishReason = result?.finishReason ?? finishReason;
				if (!this.interactive) sessionClosed = true;
				await check(false).catch(() => {});
			}
		} finally {
			polling = false;
			this.wake?.();
			await poller;
			unsubscribe();
		}

		if (
			runs > 0 &&
			!(await this.waitForRecordingFlush(
				sessionsDir,
				sessionId,
				runs,
				options.flushTimeoutMs ?? 15_000,
			))
		) {
			warnings.push(
				"The rerun's recording was not flushed in time; its last records may be missing from the comparison.",
			);
		}
		await checking.catch(() => {});
		const liveData = await this.readLive(
			core,
			sessionId,
			sessionsDir,
			systemPrompt,
		);
		const live = buildSessionReplayComparableIterations(liveData);
		this.checkCompleteIterations(live, true);
		const comparison = this.finalReport(live);
		return {
			sessionId,
			comparison: {
				...comparison,
				warnings: [...comparison.warnings],
			},
			matches: this.matches(live),
			approvals: [...this.approvals],
			turns: { recorded: this.turns.length, sent },
			stopped: this.stopped,
			...(finishReason ? { finishReason } : {}),
			warnings,
		};
	}
}

/**
 * Runs a recorded session again, live, with the recording as the oracle.
 *
 * The session is started with recording on and each recorded user turn is
 * sent the way it was delivered. Approvals are answered from the recording
 * by `seq` (or asked, with `decideApproval`). Every finished live iteration
 * is compared with the recorded one using the replay comparison, so the
 * same divergence kinds as `session diff` are reported; tool calls are also
 * checked as they arrive, so `untilDivergence` aborts a run at the first
 * differing call before later calls run. The divergent call itself may
 * already be executing when the abort lands.
 */
export function createSessionReplayRerun(
	options: CreateSessionReplayRerunOptions,
): SessionReplayRerun {
	return new SessionReplayRerunImpl(options);
}

// ── Report ────────────────────────────────────────────────────────────────

export const SESSION_REPLAY_RERUN_REPORT_FORMAT =
	"cline.session-replay-rerun-report";
export const SESSION_REPLAY_RERUN_REPORT_VERSION = 1;
export const SESSION_REPLAY_RERUN_REPORT_FILE = "rerun-report.json";

/** The divergence report a rerun writes next to the bundle it reran. */
export interface SessionReplayRerunReport {
	format: typeof SESSION_REPLAY_RERUN_REPORT_FORMAT;
	version: typeof SESSION_REPLAY_RERUN_REPORT_VERSION;
	createdAt: string;
	recorded: { bundleDir: string; sessionId: string };
	/** The rerun session, and the bundle it was exported to. */
	live: { sessionId: string; bundleDir?: string; validated?: boolean };
	workspace: {
		method: "checkpoint" | "copy" | "in-place";
		source: string;
		root: string;
		cwd: string;
		checkpoint?: { ref: string; kind: "stash" | "commit"; base: string };
	};
	container?: { runtime: string; image: string; command: string[] };
	env: {
		/** Whether the recorded env was applied to the commands the rerun ran. */
		applied: boolean;
		changed: Array<{ key: string; recorded?: string; live?: string }>;
		unknown: string[];
	};
	options: {
		kinds: SessionReplayDivergenceKind[];
		requestMatching: SessionReplayRequestMatching;
		untilDivergence: boolean;
		interactive: boolean;
		provider: string;
		model: string;
		recordedProvider: string;
		recordedModel: string;
	};
	turns: { recorded: number; sent: number };
	stopped: SessionReplayRerunResult["stopped"];
	finishReason?: string;
	comparison: SessionReplayDivergenceReport;
	matches: SessionReplayRerunMatch[];
	approvals: SessionReplayRerunApproval[];
	/** Things the bundle could not reproduce. */
	gaps: string[];
	warnings: string[];
}

/** Writes `rerun-report.json` into `dir` and returns its path. */
export async function writeSessionReplayRerunReport(
	dir: string,
	report: SessionReplayRerunReport,
): Promise<string> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, SESSION_REPLAY_RERUN_REPORT_FILE);
	await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return path;
}
