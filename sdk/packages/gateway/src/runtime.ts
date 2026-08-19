/**
 * Gateway async runtime (Gateway RFC, Phase 3).
 *
 * Composes the Phase 2 bot domain with the SQLite authority:
 *
 * - `run.start` admits into a durable FIFO queue and acks immediately
 *   with `{runId, acceptedAt, queuePosition}` — it never blocks on the
 *   turn.
 * - Every execution is a recorded run attempt; failed attempts retry up
 *   to a configured cap while the run stays `running`.
 * - Every state change lands in the durable event log; clients replay
 *   from a cursor. Canonical message history is stored behind the
 *   `AgentMessage` messages contract.
 * - Disconnect never implies abort; crash recovery interrupts abandoned
 *   attempts (never auto-resumes them) and re-admits committed queued
 *   runs in FIFO order.
 * - Admission applies adaptive backpressure: a session whose pending
 *   queue is full rejects new prompts with a retryable error.
 */

import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
	BotClock,
	BotIdSource,
	BotPorts,
	BotRecord,
	EngineInvocation,
	EngineOutcome,
	EnginePort,
	EngineRunHandle,
	MemorySource,
	RunRecord,
	SessionRecord,
	SessionRepository,
	TurnOverrides,
} from "@cline/bot";
import {
	Bot,
	BotDomainError,
	BotRegistry,
	resolveEffectiveConfig,
} from "@cline/bot";
import type {
	BotId,
	GatewayError,
	GatewayEventScope,
	GatewayInstanceId,
	GatewayServerRequest,
	RunAccepted,
	RunId,
	SessionId,
} from "@cline/shared/gateway";
import {
	createBotId,
	createGatewayError,
	createRunId,
	createSessionId,
	EventCursorDecodeError,
	GATEWAY_PROTOCOL_VERSION,
	RunStateTransitionError,
} from "@cline/shared/gateway";
import type { GatewayDatabase } from "./db";
import { OUTBOX_KIND_SESSION_PROJECTION } from "./outbox";
import type { GatewayPaths } from "./paths";
import type { GatewayStores } from "./stores";

/**
 * Sentinel workspace root: the Gateway materializes a managed directory
 * under `bots/<botId>/workspaces/<sessionId>` when a session is created
 * with it.
 */
export const MANAGED_WORKSPACE_ROOT = "@managed";

/** A handler failure that already knows its wire error. */
export class GatewayCallError extends Error {
	readonly gatewayError: GatewayError;

	constructor(gatewayError: GatewayError) {
		super(gatewayError.message);
		this.name = "GatewayCallError";
		this.gatewayError = gatewayError;
	}
}

/** Map any thrown value onto exactly one wire error. */
export function toGatewayError(error: unknown): GatewayError {
	if (error instanceof GatewayCallError) {
		return error.gatewayError;
	}
	if (error instanceof RunStateTransitionError) {
		return error.gatewayError;
	}
	if (error instanceof EventCursorDecodeError) {
		return error.gatewayError;
	}
	if (error instanceof BotDomainError) {
		switch (error.code) {
			case "bot_not_found":
				return createGatewayError("not_found", error.message);
			case "delegation_not_allowed":
			case "messaging_not_allowed":
				return createGatewayError("unauthorized", error.message);
			case "role_immutable":
				return createGatewayError("invalid_request", error.message);
			default:
				return createGatewayError("run_admission_rejected", error.message);
		}
	}
	return createGatewayError(
		"internal",
		error instanceof Error ? error.message : String(error),
	);
}

function kebabToCamel(value: string): string {
	return value.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

// -----------------------------------------------------------------------------
// Managed session workspaces
// -----------------------------------------------------------------------------

class ManagedWorkspaceSessionRepository implements SessionRepository {
	private readonly inner: SessionRepository;
	private readonly resolveRoot: (botId: BotId, sessionId: SessionId) => string;
	private readonly materialize: (rootPath: string) => void;

	constructor(
		inner: SessionRepository,
		resolveRoot: (botId: BotId, sessionId: SessionId) => string,
		materialize: (rootPath: string) => void,
	) {
		this.inner = inner;
		this.resolveRoot = resolveRoot;
		this.materialize = materialize;
	}

	get(sessionId: SessionId): SessionRecord | undefined {
		return this.inner.get(sessionId);
	}

	listByBot(botId: BotId): readonly SessionRecord[] {
		return this.inner.listByBot(botId);
	}

	save(record: SessionRecord): void {
		if (record.workspace.rootPath === MANAGED_WORKSPACE_ROOT) {
			const rootPath = this.resolveRoot(record.botId, record.sessionId);
			this.materialize(rootPath);
			this.inner.save({
				...record,
				workspace: Object.freeze({ rootPath }),
			});
			return;
		}
		this.inner.save(record);
	}
}

// -----------------------------------------------------------------------------
// Instrumented repositories: durable events + audit + outbox
// -----------------------------------------------------------------------------

const RUN_STATE_EVENTS: Record<RunRecord["state"], string> = {
	queued: "run.queued",
	running: "run.started",
	completed: "run.completed",
	failed: "run.failed",
	aborted: "run.aborted",
	interrupted: "run.interrupted",
};

const TERMINAL_STATES: ReadonlySet<RunRecord["state"]> = new Set([
	"completed",
	"failed",
	"aborted",
	"interrupted",
]);

interface InstrumentationSinks {
	stores: GatewayStores;
	clock: BotClock;
	outboxEnqueued(): void;
}

class InstrumentedRunRepository {
	private readonly inner: GatewayStores["runs"];
	private readonly sinks: InstrumentationSinks;

	constructor(inner: GatewayStores["runs"], sinks: InstrumentationSinks) {
		this.inner = inner;
		this.sinks = sinks;
	}

	get(runId: RunId): RunRecord | undefined {
		return this.inner.get(runId);
	}

	listBySession(sessionId: SessionId): readonly RunRecord[] {
		return this.inner.listBySession(sessionId);
	}

	save(record: RunRecord): void {
		const previous = this.inner.get(record.runId);
		this.inner.save(record);
		if (previous && previous.state === record.state) {
			return;
		}
		const now = this.sinks.clock.now();
		const scope: GatewayEventScope = {
			botId: record.botId,
			sessionId: record.sessionId,
			runId: record.runId,
		};
		const payload: Record<string, unknown> = { state: record.state };
		if (record.state === "queued") {
			payload.acceptedAt = record.acceptedAt;
		}
		if (record.startedAt !== undefined) {
			payload.startedAt = record.startedAt;
		}
		if (TERMINAL_STATES.has(record.state)) {
			payload.endedAt = record.endedAt;
			if (record.outputText !== undefined) {
				payload.outputText = record.outputText;
			}
			if (record.error !== undefined) {
				payload.error = record.error;
			}
		}
		this.sinks.stores.events.append(
			RUN_STATE_EVENTS[record.state],
			scope,
			payload,
			now,
		);
		this.sinks.stores.audit.record(
			"gateway",
			RUN_STATE_EVENTS[record.state],
			record.runId,
			{ sessionId: record.sessionId, botId: record.botId },
			now,
		);
		if (TERMINAL_STATES.has(record.state)) {
			this.sinks.stores.outbox.enqueue(
				OUTBOX_KIND_SESSION_PROJECTION,
				{ sessionId: record.sessionId },
				now,
			);
			this.sinks.outboxEnqueued();
		}
	}
}

class InstrumentedSessionRepository implements SessionRepository {
	private readonly inner: SessionRepository;
	private readonly sinks: InstrumentationSinks;

	constructor(inner: SessionRepository, sinks: InstrumentationSinks) {
		this.inner = inner;
		this.sinks = sinks;
	}

	get(sessionId: SessionId): SessionRecord | undefined {
		return this.inner.get(sessionId);
	}

	listByBot(botId: BotId): readonly SessionRecord[] {
		return this.inner.listByBot(botId);
	}

	save(record: SessionRecord): void {
		const previous = this.inner.get(record.sessionId);
		this.inner.save(record);
		const now = this.sinks.clock.now();
		const stored = this.inner.get(record.sessionId);
		const scope: GatewayEventScope = {
			botId: record.botId,
			sessionId: record.sessionId,
		};
		if (!previous) {
			this.sinks.stores.events.append(
				"session.created",
				scope,
				{
					workspaceRoot:
						stored?.workspace.rootPath ?? record.workspace.rootPath,
				},
				now,
			);
			this.sinks.stores.audit.record(
				"gateway",
				"session.created",
				record.sessionId,
				{ botId: record.botId },
				now,
			);
			return;
		}
		if (previous.state !== "closed" && record.state === "closed") {
			this.sinks.stores.events.append("session.closed", scope, undefined, now);
			this.sinks.stores.audit.record(
				"gateway",
				"session.closed",
				record.sessionId,
				undefined,
				now,
			);
		}
	}
}

// -----------------------------------------------------------------------------
// Attempting engine port: run attempts + retry + durable engine events
// -----------------------------------------------------------------------------

export interface EngineRetryPolicy {
	/** Total attempts per run (1 = never auto-retry). */
	readonly maxAttempts: number;
}

class AttemptingEngineHandle implements EngineRunHandle {
	readonly result: Promise<EngineOutcome>;
	private current: EngineRunHandle | undefined;
	private stopRequested = false;

	constructor(
		invocation: EngineInvocation,
		inner: EnginePort,
		sinks: InstrumentationSinks,
		database: GatewayDatabase,
		policy: EngineRetryPolicy,
	) {
		this.result = (async () => {
			let outcome: EngineOutcome = {
				status: "failed",
				outputText: "",
				error: { name: "EngineError", message: "Engine produced no outcome" },
			};
			const scope: GatewayEventScope = {
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
			};
			for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
				const attemptRecord = sinks.stores.attempts.begin(
					invocation.runId,
					sinks.clock.now(),
				);
				sinks.stores.events.append(
					"run.attemptStarted",
					scope,
					{ attempt: attemptRecord.attempt },
					sinks.clock.now(),
				);
				const handle = inner.start(invocation);
				this.current = handle;
				const unsubscribe = handle.subscribe?.((event) => {
					persistEngineEvent(database, sinks, invocation, event);
				});
				outcome = await handle.result;
				unsubscribe?.();
				this.current = undefined;
				sinks.stores.attempts.settle(
					invocation.runId,
					attemptRecord.attempt,
					outcome.status,
					sinks.clock.now(),
					outcome.error,
				);
				sinks.stores.events.append(
					"run.attemptSettled",
					scope,
					{
						attempt: attemptRecord.attempt,
						status: outcome.status,
						...(outcome.error ? { error: outcome.error } : {}),
					},
					sinks.clock.now(),
				);
				if (outcome.status !== "failed" || this.stopRequested) {
					break;
				}
				if (attempt < policy.maxAttempts) {
					sinks.stores.events.append(
						"run.attemptRetrying",
						scope,
						{ nextAttempt: attempt + 1 },
						sinks.clock.now(),
					);
				}
			}
			return outcome;
		})();
	}

	steer(text: string): boolean {
		return this.current?.steer(text) ?? false;
	}

	interrupt(reason?: string): void {
		this.stopRequested = true;
		this.current?.interrupt(reason);
	}

	abort(reason?: string): void {
		this.stopRequested = true;
		this.current?.abort(reason);
	}

	subscribe(listener: (event: unknown) => void): () => void {
		// Live tail of the current attempt only; durable events cover replay.
		return this.current?.subscribe?.(listener) ?? (() => {});
	}
}

function persistEngineEvent(
	database: GatewayDatabase,
	sinks: InstrumentationSinks,
	invocation: EngineInvocation,
	event: unknown,
): void {
	if (typeof event !== "object" || event === null) {
		return;
	}
	const typed = event as { type?: unknown; message?: unknown };
	if (typeof typed.type !== "string") {
		return;
	}
	const eventType = typed.type;
	const scope: GatewayEventScope = {
		botId: invocation.botId,
		sessionId: invocation.sessionId,
		runId: invocation.runId,
	};
	const now = sinks.clock.now();
	database.transaction(() => {
		if (eventType === "message-appended" && typed.message) {
			const message = typed.message as {
				id: string;
				role: string;
				createdAt: number;
			};
			sinks.stores.messages.append(
				invocation.sessionId,
				invocation.runId,
				// The payload is the AgentMessage messages contract.
				message as Parameters<GatewayStores["messages"]["append"]>[2],
			);
			sinks.stores.events.append(
				"run.messageAppended",
				scope,
				{ message: typed.message },
				now,
			);
			sinks.stores.outbox.enqueue(
				OUTBOX_KIND_SESSION_PROJECTION,
				{ sessionId: invocation.sessionId },
				now,
			);
			sinks.outboxEnqueued();
			return;
		}
		sinks.stores.events.append(
			`engine.${kebabToCamel(eventType)}`,
			scope,
			{ ...(event as Record<string, unknown>) },
			now,
		);
	});
}

export class AttemptingEnginePort implements EnginePort {
	private readonly inner: EnginePort;
	private readonly sinks: InstrumentationSinks;
	private readonly database: GatewayDatabase;
	private readonly policy: EngineRetryPolicy;

	constructor(
		inner: EnginePort,
		sinks: InstrumentationSinks,
		database: GatewayDatabase,
		policy: EngineRetryPolicy,
	) {
		this.inner = inner;
		this.sinks = sinks;
		this.database = database;
		this.policy = policy;
	}

	start(invocation: EngineInvocation): EngineRunHandle {
		// Execute against the config snapshotted at admission (never the
		// live bot config or in-memory overrides): every attempt of a run —
		// including after a crash — binds the same provider/model.
		const snapshot = this.sinks.stores.runs.getConfigSnapshot(invocation.runId);
		const pinned = snapshot
			? { ...invocation, effectiveConfig: snapshot }
			: invocation;
		return new AttemptingEngineHandle(
			pinned,
			this.inner,
			this.sinks,
			this.database,
			this.policy,
		);
	}
}

// -----------------------------------------------------------------------------
// File-backed memories
// -----------------------------------------------------------------------------

class FileMemorySource implements MemorySource {
	private readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	list(): readonly { path: string; content: string }[] {
		let names: string[];
		try {
			names = readdirSync(this.dir, { recursive: true, encoding: "utf8" });
		} catch {
			return [];
		}
		const entries: { path: string; content: string }[] = [];
		for (const name of names.sort()) {
			try {
				entries.push({
					path: name,
					content: readFileSync(join(this.dir, name), "utf8"),
				});
			} catch {
				// Directories and unreadable files are skipped.
			}
		}
		return entries;
	}
}

// -----------------------------------------------------------------------------
// Approval broker (server-initiated requests)
// -----------------------------------------------------------------------------

interface PendingServerRequest {
	readonly request: GatewayServerRequest;
	resolve(result: unknown): void;
	reject(error: GatewayError): void;
}

/**
 * Server-initiated questions (tool approval, credentials). Pending
 * requests survive client disconnects — they are re-issued to any client
 * that (re)subscribes to the scope. Disconnect neither loses nor
 * implicitly answers them.
 */
export class ApprovalBroker {
	private readonly pending = new Map<string, PendingServerRequest>();
	private nextId = 0;
	/** Set by the server: deliver a request to matching live clients. */
	deliver: ((request: GatewayServerRequest) => void) | undefined;

	request(
		method: string,
		scope: GatewayEventScope,
		params: Record<string, unknown>,
	): Promise<unknown> {
		this.nextId += 1;
		const request: GatewayServerRequest = {
			version: GATEWAY_PROTOCOL_VERSION,
			id: `srq_${this.nextId}`,
			method,
			scope,
			params,
		};
		return new Promise((resolve, reject) => {
			this.pending.set(request.id, {
				request,
				resolve,
				reject: (error) => reject(new GatewayCallError(error)),
			});
			this.deliver?.(request);
		});
	}

	respond(id: string, result: unknown, error?: GatewayError): boolean {
		const entry = this.pending.get(id);
		if (!entry) {
			return false;
		}
		this.pending.delete(id);
		if (error) {
			entry.reject(error);
		} else {
			entry.resolve(result);
		}
		return true;
	}

	/** Pending requests matching a subscription scope (for re-issue). */
	pendingForScope(scope: GatewayEventScope): readonly GatewayServerRequest[] {
		return [...this.pending.values()]
			.map((entry) => entry.request)
			.filter((request) => {
				if (scope.runId && request.scope.runId !== scope.runId) {
					return false;
				}
				if (scope.sessionId && request.scope.sessionId !== scope.sessionId) {
					return false;
				}
				if (scope.botId && request.scope.botId !== scope.botId) {
					return false;
				}
				return true;
			});
	}

	get pendingCount(): number {
		return this.pending.size;
	}
}

// -----------------------------------------------------------------------------
// Runtime
// -----------------------------------------------------------------------------

export interface GatewayRuntimeOptions {
	database: GatewayDatabase;
	stores: GatewayStores;
	paths: GatewayPaths;
	instanceId: GatewayInstanceId;
	/** Inner execution port; the runtime layers attempts/retry on top. */
	engine: EnginePort;
	clock?: BotClock;
	retry?: Partial<EngineRetryPolicy>;
	/** Adaptive backpressure: max queued+running runs per session. */
	maxPendingRunsPerSession?: number;
	/** Managed workspace materialization (default: mkdir -p, mode 0700). */
	materializeWorkspace?: (rootPath: string) => void;
	/** Called whenever a transaction enqueued outbox work. */
	onOutboxEnqueued?: () => void;
}

export interface RunStartParams {
	botId: BotId;
	prompt: string;
	workspaceRoot?: string;
	overrides?: TurnOverrides;
}

export interface GatewayRecoveryReport {
	readonly interruptedRuns: readonly RunId[];
	readonly requeuedRuns: readonly RunId[];
	readonly orphanedQueuedRuns: readonly RunId[];
}

export class GatewayRuntime {
	readonly database: GatewayDatabase;
	readonly stores: GatewayStores;
	readonly paths: GatewayPaths;
	readonly instanceId: GatewayInstanceId;
	readonly clock: BotClock;
	readonly approvals = new ApprovalBroker();
	readonly startedAt: number;

	private readonly registry: BotRegistry;
	private readonly enginePort: AttemptingEnginePort;
	private readonly sessionsPort: SessionRepository;
	private readonly runsPort: InstrumentedRunRepository;
	private readonly ids: BotIdSource;
	private readonly bots = new Map<BotId, Bot>();
	private readonly maxPendingRunsPerSession: number;
	private readonly onOutboxEnqueued: () => void;
	private draining = false;
	private defaultBot: BotRecord | undefined;

	constructor(options: GatewayRuntimeOptions) {
		this.database = options.database;
		this.stores = options.stores;
		this.paths = options.paths;
		this.instanceId = options.instanceId;
		this.clock = options.clock ?? { now: () => Date.now() };
		this.startedAt = this.clock.now();
		this.maxPendingRunsPerSession = options.maxPendingRunsPerSession ?? 32;
		this.onOutboxEnqueued = options.onOutboxEnqueued ?? (() => {});
		const sinks: InstrumentationSinks = {
			stores: this.stores,
			clock: this.clock,
			outboxEnqueued: () => this.onOutboxEnqueued(),
		};
		this.ids = {
			botId: () => createBotId(),
			sessionId: () => createSessionId(),
			runId: () => createRunId(),
		};
		this.enginePort = new AttemptingEnginePort(
			options.engine,
			sinks,
			this.database,
			{ maxAttempts: Math.max(1, options.retry?.maxAttempts ?? 1) },
		);
		const materialize =
			options.materializeWorkspace ??
			((rootPath: string) => {
				mkdirSync(rootPath, { recursive: true, mode: 0o700 });
			});
		this.sessionsPort = new InstrumentedSessionRepository(
			new ManagedWorkspaceSessionRepository(
				this.stores.sessions,
				(botId, sessionId) => this.paths.sessionWorkspaceDir(botId, sessionId),
				materialize,
			),
			sinks,
		);
		this.runsPort = new InstrumentedRunRepository(this.stores.runs, sinks);
		this.registry = new BotRegistry({
			bots: this.stores.bots,
			ids: this.ids,
			clock: this.clock,
		});
	}

	/** Ensure the default lead bot `cline` exists. */
	bootstrap(): BotRecord {
		this.defaultBot = this.database.transaction(() => {
			const before = this.stores.bots.list().length;
			const record = this.registry.bootstrap();
			if (this.stores.bots.list().length !== before) {
				this.stores.meta.bumpCatalogGeneration();
				this.stores.audit.record(
					"gateway",
					"bot.bootstrapped",
					record.identity.botId,
					{ name: record.identity.name, role: record.identity.role },
					this.clock.now(),
				);
			}
			return record;
		});
		return this.defaultBot;
	}

	get defaultBotId(): BotId | undefined {
		return this.defaultBot?.identity.botId;
	}

	get isDraining(): boolean {
		return this.draining;
	}

	/**
	 * Manual crash recovery, run before serving: abandoned attempts are
	 * interrupted — never auto-resumed — and committed queued runs are
	 * re-admitted in FIFO admission order (they were acknowledged but
	 * never attempted).
	 */
	recover(): GatewayRecoveryReport {
		const interrupted = this.database.transaction(() => {
			const abandoned = this.stores.runs.listByState("running");
			const now = this.clock.now();
			for (const run of abandoned) {
				this.runsPort.save({
					...run,
					state: "interrupted",
					endedAt: now,
					error: {
						name: "GatewayRestart",
						message:
							"Run abandoned by a Gateway restart; attempts are never auto-resumed",
					},
				});
			}
			this.stores.attempts.interruptOpenAttempts(now);
			if (abandoned.length > 0) {
				this.stores.audit.record(
					"gateway",
					"recovery.interruptedAbandonedRuns",
					undefined,
					{ runIds: abandoned.map((run) => run.runId) },
					now,
				);
			}
			return abandoned.map((run) => run.runId);
		});

		const requeued: RunId[] = [];
		const orphaned: RunId[] = [];
		for (const record of this.stores.runs.listQueued()) {
			try {
				this.getBot(record.botId).recoverQueuedRun(record);
				requeued.push(record.runId);
			} catch {
				// The session is closed or the bot retired; the run cannot be
				// re-admitted. Abort it so the queue converges.
				orphaned.push(record.runId);
				this.database.transaction(() => {
					this.runsPort.save({
						...record,
						state: "aborted",
						endedAt: this.clock.now(),
						error: {
							name: "GatewayRestart",
							message: "Queued run could not be re-admitted after restart",
						},
					});
				});
			}
		}
		if (requeued.length > 0 || orphaned.length > 0) {
			this.stores.audit.record(
				"gateway",
				"recovery.requeuedCommittedRuns",
				undefined,
				{ requeued, orphaned },
				this.clock.now(),
			);
		}
		this.stores.events.append(
			"gateway.recoveryCompleted",
			{},
			{
				interruptedRuns: interrupted,
				requeuedRuns: requeued,
				orphanedQueuedRuns: orphaned,
			},
			this.clock.now(),
		);
		return {
			interruptedRuns: interrupted,
			requeuedRuns: requeued,
			orphanedQueuedRuns: orphaned,
		};
	}

	/** Admit a prompt: durable FIFO queue + immediate acknowledgement. */
	startRun(actor: string, params: RunStartParams): RunAccepted {
		if (this.draining) {
			throw new GatewayCallError(
				createGatewayError(
					"gateway_draining",
					"Gateway is draining and refuses new mutating work",
					{ retryable: true },
				),
			);
		}
		const bot = this.getBot(params.botId);
		const session = bot.session;
		if (session) {
			const pending = this.stores.runs.countPendingBySession(session.sessionId);
			if (pending >= this.maxPendingRunsPerSession) {
				throw new GatewayCallError(
					createGatewayError(
						"run_admission_rejected",
						`Session queue is full (${pending} pending runs); retry later`,
						{
							retryable: true,
							details: {
								pending,
								limit: this.maxPendingRunsPerSession,
							},
						},
					),
				);
			}
		}
		return this.database.transaction(() => {
			// Effective config at admission (provider/model/prompt settings —
			// never credentials). Persisted as the run's snapshot below;
			// every attempt — retries, deferred queue starts, and crash
			// recovery — executes against it instead of live bot config.
			const snapshotConfig = resolveEffectiveConfig(
				bot.record.config,
				params.overrides,
			);
			const accepted = bot.submitPrompt(params.prompt, {
				// An explicit workspace is always forwarded so a mismatch with
				// an existing session's immutable workspace is rejected loudly.
				workspace: params.workspaceRoot
					? { rootPath: params.workspaceRoot }
					: session
						? undefined
						: { rootPath: MANAGED_WORKSPACE_ROOT },
				overrides: params.overrides,
			});
			this.stores.runs.saveConfigSnapshot(accepted.runId, snapshotConfig);
			this.stores.audit.record(
				actor,
				"run.start",
				accepted.runId,
				{ botId: params.botId, queuePosition: accepted.queuePosition },
				this.clock.now(),
			);
			return accepted;
		});
	}

	/** Merge steering text into the active run. */
	steerRun(actor: string, runId: RunId, text: string): { merged: boolean } {
		const { bot, record } = this.requireRun(runId);
		if (record.state !== "running" || bot.activeRun?.runId !== runId) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_state_transition",
					`Run ${runId} is ${record.state}; steering merges only into the active run`,
					{ retryable: false },
				),
			);
		}
		const merged = bot.steer(text);
		if (merged) {
			this.database.transaction(() => {
				this.stores.events.append(
					"run.steered",
					{ botId: record.botId, sessionId: record.sessionId, runId },
					{ textLength: text.length },
					this.clock.now(),
				);
				this.stores.audit.record(
					actor,
					"run.steer",
					runId,
					undefined,
					this.clock.now(),
				);
			});
		}
		return { merged };
	}

	interruptRun(
		actor: string,
		runId: RunId,
		reason?: string,
	): { state: string } {
		return this.stopRun(actor, runId, "interrupt", reason);
	}

	abortRun(actor: string, runId: RunId, reason?: string): { state: string } {
		return this.stopRun(actor, runId, "abort", reason);
	}

	delegateBot(
		actor: string,
		params: {
			parentBotId: BotId;
			name: string;
			role: "worker" | "contractor";
			reason?: string;
		},
	): BotRecord {
		if (this.draining) {
			throw new GatewayCallError(
				createGatewayError(
					"gateway_draining",
					"Gateway is draining and refuses new mutating work",
					{ retryable: true },
				),
			);
		}
		return this.database.transaction(() => {
			const record = this.registry.delegate(params.parentBotId, {
				name: params.name,
				role: params.role,
				reason: params.reason,
			});
			this.stores.meta.bumpCatalogGeneration();
			this.stores.events.append(
				"bot.delegated",
				{ botId: record.identity.botId },
				{
					parentBotId: params.parentBotId,
					name: params.name,
					role: params.role,
				},
				this.clock.now(),
			);
			this.stores.audit.record(
				actor,
				"bot.delegate",
				record.identity.botId,
				{ parentBotId: params.parentBotId, role: params.role },
				this.clock.now(),
			);
			return record;
		});
	}

	listBots(): readonly BotRecord[] {
		return this.stores.bots.list();
	}

	listSessions(botId?: BotId): readonly SessionRecord[] {
		return botId
			? this.stores.sessions.listByBot(botId)
			: this.stores.sessions.list();
	}

	listRuns(filter: {
		sessionId?: SessionId;
		runId?: RunId;
	}): readonly RunRecord[] {
		if (filter.runId) {
			const record = this.stores.runs.get(filter.runId);
			return record ? [record] : [];
		}
		if (filter.sessionId) {
			return this.stores.runs.listBySession(filter.sessionId);
		}
		return [
			...this.stores.runs.listByState("queued"),
			...this.stores.runs.listByState("running"),
		];
	}

	attemptsForRun(
		runId: RunId,
	): ReturnType<GatewayStores["attempts"]["listByRun"]> {
		return this.stores.attempts.listByRun(runId);
	}

	/** Refuse new mutating work while existing runs finish. */
	drain(actor: string, reason?: string): { state: "draining" } {
		if (!this.draining) {
			this.draining = true;
			this.database.transaction(() => {
				this.stores.events.append(
					"gateway.drainStarted",
					{},
					reason ? { reason } : undefined,
					this.clock.now(),
				);
				this.stores.audit.record(
					actor,
					"gateway.drain",
					undefined,
					{ reason },
					this.clock.now(),
				);
			});
		}
		return { state: "draining" };
	}

	/** Cooperatively interrupt every active run (graceful stop path). */
	interruptAllActive(reason: string): void {
		for (const bot of this.bots.values()) {
			bot.interrupt(reason);
		}
	}

	/** Resolves once no bot has an active or queued run. */
	async whenIdle(): Promise<void> {
		for (;;) {
			const busy = [...this.bots.values()].filter((bot) => bot.activeRun);
			if (busy.length === 0) {
				return;
			}
			await Promise.all(busy.map((bot) => bot.whenIdle()));
		}
	}

	status(): Record<string, unknown> {
		return {
			state: this.draining ? "draining" : "serving",
			gatewayId: this.stores.meta.ensureGatewayId(),
			instanceId: this.instanceId,
			pid: process.pid,
			startedAt: this.startedAt,
			protocolVersion: GATEWAY_PROTOCOL_VERSION,
			defaultBotId: this.defaultBotId,
			catalogGeneration: this.stores.meta.catalogGeneration(),
			namespace: this.paths.namespace,
			dataDir: this.paths.dataDir,
			counts: {
				bots: this.stores.bots.list().length,
				sessions: this.stores.sessions.list().length,
				queuedRuns: this.stores.runs.countByState("queued"),
				runningRuns: this.stores.runs.countByState("running"),
				clients: this.stores.clients.count(),
				pendingOutbox: this.stores.outbox.countPending(),
				lastEventSequence: this.stores.events.lastSequence(),
				pendingServerRequests: this.approvals.pendingCount,
			},
		};
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private getBot(botId: BotId): Bot {
		const existing = this.bots.get(botId);
		if (existing) {
			return existing;
		}
		const ports: BotPorts = {
			clock: this.clock,
			ids: this.ids,
			bots: this.stores.bots,
			sessions: this.sessionsPort,
			runs: this.runsPort,
			engine: this.enginePort,
			memories: new FileMemorySource(this.paths.memoriesDir(botId)),
		};
		const bot = new Bot(botId, ports);
		this.bots.set(botId, bot);
		return bot;
	}

	private requireRun(runId: RunId): { bot: Bot; record: RunRecord } {
		const record = this.stores.runs.get(runId);
		if (!record) {
			throw new GatewayCallError(
				createGatewayError("not_found", `Unknown run: ${runId}`),
			);
		}
		return { bot: this.getBot(record.botId), record };
	}

	private stopRun(
		actor: string,
		runId: RunId,
		mode: "interrupt" | "abort",
		reason?: string,
	): { state: string } {
		const { bot, record } = this.requireRun(runId);
		if (record.state === "queued") {
			// A queued run never started; both stop modes cancel it.
			bot.cancelQueued(runId);
			this.stores.audit.record(
				actor,
				`run.${mode}`,
				runId,
				{ reason },
				this.clock.now(),
			);
			return { state: "aborted" };
		}
		if (record.state !== "running") {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_state_transition",
					`Run ${runId} is already ${record.state}`,
					{ retryable: false },
				),
			);
		}
		if (bot.activeRun?.runId !== runId) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_state_transition",
					`Run ${runId} is not this instance's active run (a previous instance owned it)`,
					{ retryable: false },
				),
			);
		}
		if (mode === "interrupt") {
			bot.interrupt(reason);
		} else {
			bot.abort(reason);
		}
		this.stores.audit.record(
			actor,
			`run.${mode}`,
			runId,
			{ reason },
			this.clock.now(),
		);
		return { state: "running" };
	}
}
