/**
 * Bot session/run orchestration (Gateway RFC, Phase 2).
 *
 * Semantics encoded here:
 * - A session is allocated only with its first ACCEPTED prompt (lazy).
 *   A rejected prompt never creates a session.
 * - The session workspace is immutable after creation.
 * - One mutating root run per session; admission is FIFO with an
 *   immediate `{runId, acceptedAt, queuePosition}` acknowledgement.
 * - Steering merges into the active run.
 * - Disconnect never implies abort.
 * - A contractor accepts exactly one task, then tears down: its record is
 *   retired (retained) and its session closed.
 */

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

const DEFAULT_WORKSPACE: WorkspaceRef = { rootPath: "." };

interface QueuedRun {
	runId: RunId;
	input: string;
	overrides?: TurnOverrides;
}

export class Bot {
	private readonly botId: BotRecord["identity"]["botId"];
	private readonly ports: BotPorts;
	private readonly registry: BotRegistry;

	private sessionId?: SessionRecord["sessionId"];
	private readonly queue: QueuedRun[] = [];
	private active?: { runId: RunId; handle: EngineRunHandle };

	constructor(botId: BotRecord["identity"]["botId"], ports: BotPorts) {
		this.botId = botId;
		this.ports = ports;
		this.registry = new BotRegistry(ports);
		// Fail fast on unknown bots.
		this.registry.get(botId);
		// Reattach to an existing active session, if any (identity survives
		// process and connection lifecycles).
		this.sessionId = ports.sessions
			.listByBot(botId)
			.find((session) => session.state === "active")?.sessionId;
	}

	get record(): BotRecord {
		return this.registry.get(this.botId);
	}

	get session(): SessionRecord | undefined {
		return this.sessionId ? this.ports.sessions.get(this.sessionId) : undefined;
	}

	get activeRun(): RunRecord | undefined {
		return this.active ? this.ports.runs.get(this.active.runId) : undefined;
	}

	/**
	 * Admit a prompt. On acceptance this lazily creates the session (first
	 * prompt only), records a queued run, and acks immediately.
	 */
	submitPrompt(text: string, options: SubmitPromptOptions = {}): RunAccepted {
		const record = this.record;
		if (record.status !== "active") {
			throw new RunAdmissionError(`Bot ${this.botId} is retired`);
		}
		if (!text.trim()) {
			throw new RunAdmissionError("Prompt must not be empty");
		}
		const session = this.session;
		if (session?.state === "closed") {
			throw new RunAdmissionError("Session is closed and admits no runs");
		}
		if (record.identity.role === "contractor" && session) {
			// The contractor's single task was accepted when its session was
			// created; a second prompt is rejected, not queued.
			throw new ContractorTaskError();
		}
		if (
			session &&
			options.workspace &&
			options.workspace.rootPath !== session.workspace.rootPath
		) {
			throw new WorkspaceImmutableError(
				`Session workspace ${session.workspace.rootPath} cannot change to ${options.workspace.rootPath}`,
			);
		}

		// ---- Prompt accepted: only now may a session come into existence.
		const acceptedAt = this.ports.clock.now();
		const sessionRecord = session ?? this.createSession(options.workspace);
		const runId = this.ports.ids.runId();
		const queuePosition = (this.active ? 1 : 0) + this.queue.length;

		this.ports.runs.save({
			runId,
			sessionId: sessionRecord.sessionId,
			botId: this.botId,
			state: "queued",
			input: text,
			acceptedAt,
		});
		this.queue.push({ runId, input: text, overrides: options.overrides });
		this.pump();

		return RunAcceptedSchema.parse({ runId, acceptedAt, queuePosition });
	}

	/** Merge steering text into the active run. False when nothing is active. */
	steer(text: string): boolean {
		if (!this.active) {
			return false;
		}
		return this.active.handle.steer(text);
	}

	/** Cooperatively interrupt the active run. */
	interrupt(reason?: string): boolean {
		if (!this.active) {
			return false;
		}
		this.active.handle.interrupt(reason);
		return true;
	}

	/** Hard-abort the active run. */
	abort(reason?: string): boolean {
		if (!this.active) {
			return false;
		}
		this.active.handle.abort(reason);
		return true;
	}

	/** Abort a run that is still queued (never started). */
	cancelQueued(runId: RunId): boolean {
		const index = this.queue.findIndex((entry) => entry.runId === runId);
		if (index === -1) {
			return false;
		}
		this.queue.splice(index, 1);
		this.transitionRun(runId, "aborted");
		return true;
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
		const session = this.session;
		if (!session || session.sessionId !== record.sessionId) {
			throw new RunAdmissionError(
				`Run ${record.runId} does not belong to the bot's active session`,
			);
		}
		if (this.queue.some((entry) => entry.runId === record.runId)) {
			return;
		}
		this.queue.push({ runId: record.runId, input: record.input, overrides });
		this.pump();
	}

	/** Close the session; it admits no further runs. */
	closeSession(): void {
		const session = this.session;
		if (!session || session.state === "closed") {
			return;
		}
		this.ports.sessions.save({
			...session,
			state: "closed",
			revision: session.revision + 1,
		});
	}

	/** Close the idle active session and allow the next prompt to create one. */
	replaceSession(): void {
		if (this.active || this.queue.length > 0) {
			throw new RunAdmissionError(
				"Cannot replace a session while runs are active or queued",
			);
		}
		this.closeSession();
		this.sessionId = undefined;
	}

	/** Discover file-backed memories through the memory port. */
	discoverMemories(): BotMemory[] {
		if (!this.ports.memories) {
			return [];
		}
		return discoverMemories(this.ports.memories);
	}

	/** Resolves once no run is active and the queue is drained. */
	async whenIdle(): Promise<void> {
		while (this.active) {
			await this.active.handle.result;
			// Let the completion continuation (state transitions, pump) run.
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private createSession(workspace?: WorkspaceRef): SessionRecord {
		const record: SessionRecord = {
			sessionId: this.ports.ids.sessionId(),
			botId: this.botId,
			workspace: Object.freeze({ ...(workspace ?? DEFAULT_WORKSPACE) }),
			state: "active",
			createdAt: this.ports.clock.now(),
			revision: 0,
		};
		this.ports.sessions.save(record);
		this.sessionId = record.sessionId;
		return record;
	}

	private pump(): void {
		if (this.active) {
			return;
		}
		const next = this.queue.shift();
		if (!next) {
			return;
		}
		const session = this.session;
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
		this.active = { runId: next.runId, handle };
		void handle.result.then((outcome) => this.settleRun(next.runId, outcome));
	}

	private settleRun(runId: RunId, outcome: EngineOutcome): void {
		this.transitionRun(runId, outcome.status, {
			endedAt: this.ports.clock.now(),
			outputText: outcome.outputText,
			error: outcome.error,
		});
		this.active = undefined;
		if (this.record.identity.role === "contractor") {
			// Contractor teardown: one task + retention. The record stays
			// (retired), the session closes, queued extras cannot exist.
			this.registry.retire(this.botId);
			this.closeSession();
			return;
		}
		this.pump();
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
