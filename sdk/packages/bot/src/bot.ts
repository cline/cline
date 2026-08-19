/**
 * Bot session/run orchestration (Gateway RFC, Phases 2 and 6).
 *
 * Semantics encoded here:
 * - A session is allocated only with its first ACCEPTED prompt (lazy).
 *   A rejected prompt never creates a session.
 * - The session workspace is immutable after creation.
 * - One mutating root run per session; admission is FIFO per session with
 *   an immediate `{runId, acceptedAt, queuePosition}` acknowledgement.
 * - Steering merges into the targeted session's active run.
 * - Disconnect never implies abort.
 * - A contractor accepts exactly one task, then tears down: its record is
 *   retired (retained) and its session closed.
 *
 * Sessions come in two kinds (Phase 6):
 * - The CANONICAL session is the bot's own desktop/CLI conversation:
 *   created lazily by `submitPrompt`, reattached across restarts.
 * - DEDICATED sessions isolate external conversations (one per connector
 *   conversation): created by `submitPromptToSession` without a session
 *   id, reused by id afterwards. Dedicated sessions never share context
 *   with the canonical session or with each other — an external user can
 *   never inherit desktop context, and desktop only enters a dedicated
 *   session by explicitly naming its id.
 *
 * Every session runs on its own lane: its own FIFO queue and its own
 * single active run.
 */

import type { SessionId } from "@cline/shared/gateway";
import {
	assertRunStateTransition,
	type RunAccepted,
	RunAcceptedSchema,
	type RunId,
} from "@cline/shared/gateway";
import {
	ContractorTaskError,
	RunAdmissionError,
	WorkspaceImmutableError,
} from "./errors";
import type { BotRecord } from "./identity";
import { type BotMemory, discoverMemories } from "./memories";
import { resolveEffectiveConfig, type TurnOverrides } from "./overrides";
import type {
	BotPorts,
	EngineOutcome,
	EngineRunHandle,
	RunRecord,
	SessionRecord,
	WorkspaceRef,
} from "./ports";
import { BotRegistry } from "./registry";

export interface SubmitPromptOptions {
	/**
	 * Workspace for the session. Only honored on the first accepted prompt;
	 * afterwards it must match the session's immutable workspace.
	 */
	workspace?: WorkspaceRef;
	overrides?: TurnOverrides;
}

export interface SubmitToSessionOptions extends SubmitPromptOptions {
	/**
	 * Target session. Omitted: a NEW dedicated session is created with the
	 * accepted prompt. Present: the session must exist, belong to this
	 * bot, and be active — canonical or dedicated (desktop opens a
	 * dedicated conversation only by explicitly naming it here).
	 */
	sessionId?: SessionId;
}

const DEFAULT_WORKSPACE: WorkspaceRef = { rootPath: "." };

interface QueuedRun {
	runId: RunId;
	input: string;
	overrides?: TurnOverrides;
}

/** One session's execution lane: FIFO queue + single active run. */
interface Lane {
	sessionId: SessionId;
	readonly queue: QueuedRun[];
	active?: { runId: RunId; handle: EngineRunHandle };
}

export class Bot {
	private readonly botId: BotRecord["identity"]["botId"];
	private readonly ports: BotPorts;
	private readonly registry: BotRegistry;

	/** Canonical (desktop/CLI) session id; lazily created. */
	private canonicalSessionId?: SessionId;
	/** Lanes by session id (canonical included once it exists). */
	private readonly lanes = new Map<SessionId, Lane>();

	constructor(botId: BotRecord["identity"]["botId"], ports: BotPorts) {
		this.botId = botId;
		this.ports = ports;
		this.registry = new BotRegistry(ports);
		// Fail fast on unknown bots.
		this.registry.get(botId);
		// Reattach to the existing active canonical session, if any
		// (identity survives process and connection lifecycles). Dedicated
		// sessions reattach lazily when addressed by id.
		this.canonicalSessionId = ports.sessions
			.listByBot(botId)
			.find(
				(session) =>
					session.state === "active" &&
					(session.kind ?? "canonical") === "canonical",
			)?.sessionId;
	}

	get record(): BotRecord {
		return this.registry.get(this.botId);
	}

	/** The canonical session (dedicated sessions are addressed by id). */
	get session(): SessionRecord | undefined {
		return this.canonicalSessionId
			? this.ports.sessions.get(this.canonicalSessionId)
			: undefined;
	}

	/** The canonical session's active run. */
	get activeRun(): RunRecord | undefined {
		const lane = this.canonicalSessionId
			? this.lanes.get(this.canonicalSessionId)
			: undefined;
		return lane?.active ? this.ports.runs.get(lane.active.runId) : undefined;
	}

	/** True when `runId` is the active run of any of this bot's lanes. */
	isRunActive(runId: RunId): boolean {
		return this.laneOfActiveRun(runId) !== undefined;
	}

	/**
	 * Admit a prompt into the canonical session. On acceptance this lazily
	 * creates the session (first prompt only), records a queued run, and
	 * acks immediately.
	 */
	submitPrompt(text: string, options: SubmitPromptOptions = {}): RunAccepted {
		const record = this.requireActiveBot();
		this.requireText(text);
		const session = this.session;
		if (session?.state === "closed") {
			throw new RunAdmissionError("Session is closed and admits no runs");
		}
		if (record.identity.role === "contractor" && session) {
			// The contractor's single task was accepted when its session was
			// created; a second prompt is rejected, not queued.
			throw new ContractorTaskError();
		}
		this.requireWorkspaceMatch(session, options.workspace);

		// ---- Prompt accepted: only now may a session come into existence.
		const sessionRecord =
			session ?? this.createSession(options.workspace, "canonical");
		this.canonicalSessionId = sessionRecord.sessionId;
		return this.enqueue(sessionRecord, text, options.overrides);
	}

	/**
	 * Admit a prompt into an explicit session (Phase 6). Without a
	 * `sessionId` a NEW dedicated session is created — this is how each
	 * external conversation gets its own isolated context. With a
	 * `sessionId` the prompt joins that session's FIFO lane, which is also
	 * how desktop intentionally participates in a connector conversation.
	 * Contractors take exactly one task and never own dedicated sessions.
	 */
	submitPromptToSession(
		text: string,
		options: SubmitToSessionOptions = {},
	): RunAccepted & { sessionId: SessionId } {
		const record = this.requireActiveBot();
		this.requireText(text);
		if (record.identity.role === "contractor") {
			throw new RunAdmissionError(
				"Contractors take exactly one task in their single session; dedicated sessions are not available",
			);
		}
		let session: SessionRecord;
		if (options.sessionId) {
			const existing = this.ports.sessions.get(options.sessionId);
			if (!existing || existing.botId !== this.botId) {
				throw new RunAdmissionError(
					`Session ${options.sessionId} does not belong to bot ${this.botId}`,
				);
			}
			if (existing.state === "closed") {
				throw new RunAdmissionError("Session is closed and admits no runs");
			}
			this.requireWorkspaceMatch(existing, options.workspace);
			session = existing;
		} else {
			// ---- Prompt accepted: the dedicated session comes into
			// existence with it.
			session = this.createSession(options.workspace, "dedicated");
		}
		const accepted = this.enqueue(session, text, options.overrides);
		return { ...accepted, sessionId: session.sessionId };
	}

	/** Merge steering text into the canonical session's active run. */
	steer(text: string): boolean {
		const lane = this.canonicalLane();
		if (!lane?.active) {
			return false;
		}
		return lane.active.handle.steer(text);
	}

	/** Merge steering text into the lane running `runId`. */
	steerRun(runId: RunId, text: string): boolean {
		const lane = this.laneOfActiveRun(runId);
		if (!lane?.active) {
			return false;
		}
		return lane.active.handle.steer(text);
	}

	/** Cooperatively interrupt every active run of this bot (all lanes). */
	interrupt(reason?: string): boolean {
		let any = false;
		for (const lane of this.lanes.values()) {
			if (lane.active) {
				lane.active.handle.interrupt(reason);
				any = true;
			}
		}
		return any;
	}

	/** Hard-abort every active run of this bot (all lanes). */
	abort(reason?: string): boolean {
		let any = false;
		for (const lane of this.lanes.values()) {
			if (lane.active) {
				lane.active.handle.abort(reason);
				any = true;
			}
		}
		return any;
	}

	/** Cooperatively interrupt the lane running `runId`. */
	interruptRun(runId: RunId, reason?: string): boolean {
		const lane = this.laneOfActiveRun(runId);
		if (!lane?.active) {
			return false;
		}
		lane.active.handle.interrupt(reason);
		return true;
	}

	/** Hard-abort the lane running `runId`. */
	abortRun(runId: RunId, reason?: string): boolean {
		const lane = this.laneOfActiveRun(runId);
		if (!lane?.active) {
			return false;
		}
		lane.active.handle.abort(reason);
		return true;
	}

	/** Abort a run that is still queued (never started), in any lane. */
	cancelQueued(runId: RunId): boolean {
		for (const lane of this.lanes.values()) {
			const index = lane.queue.findIndex((entry) => entry.runId === runId);
			if (index !== -1) {
				lane.queue.splice(index, 1);
				this.transitionRun(runId, "aborted");
				return true;
			}
		}
		return false;
	}

	/**
	 * A client connection went away. Deliberately a no-op for runs:
	 * disconnect never implies abort.
	 */
	clientDisconnected(): void {
		// Intentionally empty — sessions and runs outlive connections.
	}

	/**
	 * Re-admit a committed run that was still `queued` when a previous
	 * process died (Gateway RFC, Phase 3 crash recovery). Queued runs
	 * were acknowledged but never attempted, so executing them completes
	 * admission — unlike abandoned attempts, which are interrupted and
	 * never auto-resumed. Callers pass records in FIFO (admission) order.
	 * The run re-enters the lane of ITS session (canonical or dedicated).
	 */
	recoverQueuedRun(record: RunRecord, overrides?: TurnOverrides): void {
		if (record.botId !== this.botId) {
			throw new RunAdmissionError(
				`Run ${record.runId} belongs to bot ${record.botId}, not ${this.botId}`,
			);
		}
		if (record.state !== "queued") {
			throw new RunAdmissionError(
				`Run ${record.runId} is ${record.state}; only queued runs are recoverable`,
			);
		}
		const session = this.ports.sessions.get(record.sessionId);
		if (
			!session ||
			session.botId !== this.botId ||
			session.state !== "active"
		) {
			throw new RunAdmissionError(
				`Run ${record.runId} does not belong to an active session of this bot`,
			);
		}
		const lane = this.laneFor(session.sessionId);
		if (lane.queue.some((entry) => entry.runId === record.runId)) {
			return;
		}
		lane.queue.push({ runId: record.runId, input: record.input, overrides });
		this.pump(lane);
	}

	/** Close the canonical session; it admits no further runs. */
	closeSession(): void {
		this.closeSessionById(this.canonicalSessionId);
	}

	/** Close any session of this bot by id (dedicated ones included). */
	closeSessionById(sessionId: SessionId | undefined): void {
		if (!sessionId) {
			return;
		}
		const session = this.ports.sessions.get(sessionId);
		if (
			!session ||
			session.botId !== this.botId ||
			session.state === "closed"
		) {
			return;
		}
		this.ports.sessions.save({
			...session,
			state: "closed",
			revision: session.revision + 1,
		});
	}

	/** Discover file-backed memories through the memory port. */
	discoverMemories(): BotMemory[] {
		if (!this.ports.memories) {
			return [];
		}
		return discoverMemories(this.ports.memories);
	}

	/** Resolves once no lane has an active or queued run. */
	async whenIdle(): Promise<void> {
		for (;;) {
			const busy = [...this.lanes.values()].filter((lane) => lane.active);
			if (busy.length === 0) {
				return;
			}
			for (const lane of busy) {
				if (lane.active) {
					await lane.active.handle.result;
				}
			}
			// Let the completion continuations (state transitions, pump) run.
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private requireActiveBot(): BotRecord {
		const record = this.record;
		if (record.status !== "active") {
			throw new RunAdmissionError(`Bot ${this.botId} is retired`);
		}
		return record;
	}

	private requireText(text: string): void {
		if (!text.trim()) {
			throw new RunAdmissionError("Prompt must not be empty");
		}
	}

	private requireWorkspaceMatch(
		session: SessionRecord | undefined,
		workspace: WorkspaceRef | undefined,
	): void {
		if (
			session &&
			workspace &&
			workspace.rootPath !== session.workspace.rootPath
		) {
			throw new WorkspaceImmutableError(
				`Session workspace ${session.workspace.rootPath} cannot change to ${workspace.rootPath}`,
			);
		}
	}

	private canonicalLane(): Lane | undefined {
		return this.canonicalSessionId
			? this.lanes.get(this.canonicalSessionId)
			: undefined;
	}

	private laneOfActiveRun(runId: RunId): Lane | undefined {
		for (const lane of this.lanes.values()) {
			if (lane.active?.runId === runId) {
				return lane;
			}
		}
		return undefined;
	}

	private laneFor(sessionId: SessionId): Lane {
		let lane = this.lanes.get(sessionId);
		if (!lane) {
			lane = { sessionId, queue: [] };
			this.lanes.set(sessionId, lane);
		}
		return lane;
	}

	private enqueue(
		session: SessionRecord,
		text: string,
		overrides: TurnOverrides | undefined,
	): RunAccepted {
		const acceptedAt = this.ports.clock.now();
		const runId = this.ports.ids.runId();
		const lane = this.laneFor(session.sessionId);
		const queuePosition = (lane.active ? 1 : 0) + lane.queue.length;

		this.ports.runs.save({
			runId,
			sessionId: session.sessionId,
			botId: this.botId,
			state: "queued",
			input: text,
			acceptedAt,
		});
		lane.queue.push({ runId, input: text, overrides });
		this.pump(lane);

		return RunAcceptedSchema.parse({ runId, acceptedAt, queuePosition });
	}

	private createSession(
		workspace: WorkspaceRef | undefined,
		kind: "canonical" | "dedicated",
	): SessionRecord {
		const record: SessionRecord = {
			sessionId: this.ports.ids.sessionId(),
			botId: this.botId,
			workspace: Object.freeze({ ...(workspace ?? DEFAULT_WORKSPACE) }),
			state: "active",
			kind,
			createdAt: this.ports.clock.now(),
			revision: 0,
		};
		this.ports.sessions.save(record);
		return record;
	}

	private pump(lane: Lane): void {
		if (lane.active) {
			return;
		}
		const next = lane.queue.shift();
		if (!next) {
			return;
		}
		const session = this.ports.sessions.get(lane.sessionId);
		if (!session) {
			throw new Error("invariant violation: run queued without a session");
		}
		this.transitionRun(next.runId, "running", {
			startedAt: this.ports.clock.now(),
		});
		const record = this.record;
		const handle = this.ports.engine.start({
			runId: next.runId,
			sessionId: session.sessionId,
			botId: this.botId,
			input: next.input,
			workspaceRoot: session.workspace.rootPath,
			effectiveConfig: resolveEffectiveConfig(record.config, next.overrides),
			overrides: next.overrides,
		});
		lane.active = { runId: next.runId, handle };
		void handle.result.then((outcome) =>
			this.settleRun(lane, next.runId, outcome),
		);
	}

	private settleRun(lane: Lane, runId: RunId, outcome: EngineOutcome): void {
		this.transitionRun(runId, outcome.status, {
			endedAt: this.ports.clock.now(),
			outputText: outcome.outputText,
			error: outcome.error,
		});
		lane.active = undefined;
		if (this.record.identity.role === "contractor") {
			// Contractor teardown: one task + retention. The record stays
			// (retired), the session closes, queued extras cannot exist.
			this.registry.retire(this.botId);
			this.closeSession();
			return;
		}
		this.pump(lane);
	}

	private transitionRun(
		runId: RunId,
		to: RunRecord["state"],
		patch: Partial<Omit<RunRecord, "runId" | "state">> = {},
	): void {
		const record = this.ports.runs.get(runId);
		if (!record) {
			throw new Error(`invariant violation: unknown run ${runId}`);
		}
		assertRunStateTransition(record.state, to);
		this.ports.runs.save({ ...record, ...patch, state: to });
	}
}
