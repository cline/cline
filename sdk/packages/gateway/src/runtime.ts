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
	ConnectorId,
	GatewayError,
	GatewayEventScope,
	GatewayInstanceId,
	GatewayServerRequest,
	RunAccepted,
	RunId,
	RunProvenance,
	ScheduleId,
	SessionId,
} from "@cline/shared/gateway";
import {
	assertRunStateTransition,
	canRetryRunState,
	createBotId,
	createConnectorId,
	createGatewayError,
	createRunId,
	createScheduleId,
	createSessionId,
	EventCursorDecodeError,
	GATEWAY_PROTOCOL_VERSION,
	RunProvenanceSchema,
	RunStateTransitionError,
	SERVER_REQUEST_METHODS,
} from "@cline/shared/gateway";
import type { ConnectorRecord, ConnectorStatus } from "./connectors/store";
import { assertNonSecretConnectorConfig } from "./connectors/store";
import type { GatewayDatabase } from "./db";
import { OUTBOX_KIND_SESSION_PROJECTION } from "./outbox";
import type { GatewayPaths } from "./paths";
import type { CatalogPin, PluginCatalog } from "./plugins/catalog";
import type { ScheduleRecord } from "./schedules/store";
import type { GatewayStores, RunAttemptRecord, StoredMessage } from "./stores";
import { UsageQueryError } from "./usage";

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
	if (error instanceof UsageQueryError) {
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
	runTerminal?(record: RunRecord): void;
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
			if (record.startedAt !== undefined && record.endedAt !== undefined) {
				// Statistics "Longest Task": fold the run duration into the
				// daily aggregate at completion time (no rescan later).
				this.sinks.stores.usage.recordRunDuration(
					record.botId,
					now,
					record.endedAt - record.startedAt,
				);
			}
			this.sinks.stores.outbox.enqueue(
				OUTBOX_KIND_SESSION_PROJECTION,
				{ sessionId: record.sessionId },
				now,
			);
			this.sinks.outboxEnqueued();
			this.sinks.runTerminal?.(record);
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
		prepareInvocation?: (
			invocation: EngineInvocation,
			attempt: number,
		) => EngineInvocation | Promise<EngineInvocation>,
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
				let attemptInvocation = invocation;
				try {
					const prepared = prepareInvocation?.(
						invocation,
						attemptRecord.attempt,
					);
					attemptInvocation =
						prepared && "then" in prepared
							? await prepared
							: (prepared ?? invocation);
					if (attemptInvocation.executionSnapshot) {
						sinks.stores.events.append(
							"run.executionResolved",
							scope,
							{
								attempt: attemptRecord.attempt,
								providerId: attemptInvocation.executionSnapshot.providerId,
								modelId: attemptInvocation.executionSnapshot.modelId,
								catalogGeneration:
									attemptInvocation.executionSnapshot.catalogGeneration,
								policyHash:
									attemptInvocation.executionSnapshot.effectivePolicyHash,
								tools: attemptInvocation.executionSnapshot.tools.map(
									(tool) => ({
										toolId: tool.id,
										version: tool.version,
										executorId: tool.executorId,
									}),
								),
							},
							sinks.clock.now(),
						);
					}
				} catch (error) {
					outcome = {
						status: "failed",
						outputText: "",
						error: {
							name: error instanceof Error ? error.name : "ToolResolutionError",
							message: error instanceof Error ? error.message : String(error),
						},
					};
					sinks.stores.attempts.settle(
						invocation.runId,
						attemptRecord.attempt,
						"failed",
						sinks.clock.now(),
						outcome.error,
					);
					sinks.stores.events.append(
						"run.executionResolutionFailed",
						scope,
						{
							attempt: attemptRecord.attempt,
							error: outcome.error,
						},
						sinks.clock.now(),
					);
					break;
				}
				const handle = inner.start(attemptInvocation);
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
			// Message-completion statistics land in the same transaction as
			// the canonical message itself.
			sinks.stores.usage.recordMessage({
				occurredAt: now,
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				role: message.role,
			});
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
		if (eventType === "model-call-completed") {
			// Usage pipeline: normalize the engine's per-call metadata and
			// commit the usage event plus every aggregate atomically with
			// the durable engine event below.
			const call = event as {
				providerId?: string;
				modelId?: string;
				inputTokens?: number;
				outputTokens?: number;
				providerCost?: number;
				durationMs?: number;
				status?: string;
			};
			sinks.stores.usage.recordModelCall({
				occurredAt: now,
				botId: invocation.botId,
				sessionId: invocation.sessionId,
				runId: invocation.runId,
				providerId: call.providerId,
				modelId: call.modelId,
				inputTokens: Number(call.inputTokens ?? 0),
				outputTokens: Number(call.outputTokens ?? 0),
				providerCost: call.providerCost,
				durationMs: call.durationMs,
				status: call.status === "error" ? "error" : "ok",
			});
		}
		if (
			eventType === "tool-started" ||
			eventType === "tool-updated" ||
			eventType === "tool-finished" ||
			eventType === "approval-requested"
		) {
			const toolEvent = event as Record<string, unknown>;
			const sensitive = toolEvent.input ?? toolEvent.output ?? toolEvent.update;
			const serializedSize = (() => {
				try {
					return sensitive === undefined ? 0 : JSON.stringify(sensitive).length;
				} catch {
					return 0;
				}
			})();
			sinks.stores.events.append(
				`engine.${kebabToCamel(eventType)}`,
				scope,
				{
					type: eventType,
					sequence: toolEvent.sequence,
					timestamp: toolEvent.timestamp,
					toolCallId: toolEvent.toolCallId,
					toolName: toolEvent.toolName,
					...(toolEvent.isError !== undefined
						? { isError: toolEvent.isError }
						: {}),
					payloadSize: serializedSize,
					redacted: sensitive !== undefined,
				},
				now,
			);
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
	private readonly prepareInvocation?: GatewayRuntimeOptions["prepareInvocation"];

	constructor(
		inner: EnginePort,
		sinks: InstrumentationSinks,
		database: GatewayDatabase,
		policy: EngineRetryPolicy,
		prepareInvocation?: GatewayRuntimeOptions["prepareInvocation"],
	) {
		this.inner = inner;
		this.sinks = sinks;
		this.database = database;
		this.policy = policy;
		this.prepareInvocation = prepareInvocation;
	}

	start(invocation: EngineInvocation): EngineRunHandle {
		// Execute against the config snapshotted at admission (never the
		// live bot config or in-memory overrides): every attempt of a run —
		// including after a crash — binds the same provider/model.
		const snapshot = this.sinks.stores.runs.getConfigSnapshot(invocation.runId);
		const source = this.sinks.stores.provenance.get(invocation.runId)?.mode;
		const pinned = {
			...invocation,
			...(snapshot ? { effectiveConfig: snapshot } : {}),
			...(source ? { source } : {}),
		};
		return new AttemptingEngineHandle(
			pinned,
			this.inner,
			this.sinks,
			this.database,
			this.policy,
			this.prepareInvocation,
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
	/**
	 * First answer wins. Once a request settles this fires exactly once so
	 * the runtime can broadcast `approval.resolved` — every other attached
	 * client dismisses its copy instead of double-answering.
	 */
	onResolved:
		| ((request: GatewayServerRequest, approved: boolean) => void)
		| undefined;

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
		const approved =
			!error &&
			typeof result === "object" &&
			result !== null &&
			(result as { approved?: unknown }).approved === true;
		this.onResolved?.(entry.request, approved);
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
	/** Phase 4: plugin catalog; active runs pin their generation. */
	plugins?: PluginCatalog;
	/** Phase 4: worker/execution health reported through gateway.status. */
	executionHealth?: () => Record<string, unknown>;
	/** Optional configuration applied to the single bootstrap lead. */
	leadConfig?: BotRecord["config"];
	/** Display name supplied by the selected lead profile. */
	leadName?: string;
	/** Resolve and durably snapshot model/tool resources before execution. */
	prepareInvocation?: (
		invocation: EngineInvocation,
		attempt: number,
	) => EngineInvocation | Promise<EngineInvocation>;
}

export interface RunStartParams {
	botId: BotId;
	prompt: string;
	/**
	 * Target session. Omitted: the bot's canonical session. Present: that
	 * session's lane — desktop uses this to intentionally join a connector
	 * conversation's dedicated session.
	 */
	sessionId?: SessionId;
	workspaceRoot?: string;
	overrides?: TurnOverrides;
	/** Explicit provenance; defaults to interactive by the calling actor. */
	provenance?: RunProvenance;
	/** Close the bot's idle active session before admitting this prompt. */
	newSession?: boolean;
}

export interface SessionCreateParams {
	botId: BotId;
	workspaceRoot?: string;
}

export interface GatewayRecoveryReport {
	readonly interruptedRuns: readonly RunId[];
	readonly requeuedRuns: readonly RunId[];
	readonly orphanedQueuedRuns: readonly RunId[];
}

/**
 * Execution mode the Gateway reports to clients. Phase 3 runs engines
 * directly in the Gateway process with no OS sandbox; Phase 4 introduces
 * real sandboxed execution. Clients must surface this honestly.
 */
export const GATEWAY_EXECUTION_MODE = "development" as const;

/** Consistent read model of one session (hydration/recovery snapshot). */
export interface SessionSnapshot {
	readonly session: SessionRecord;
	readonly runs: readonly (RunRecord & {
		readonly attempts: readonly RunAttemptRecord[];
		/**
		 * How the run was admitted (interactive | connector | automation),
		 * so clients can show schedule/connector provenance honestly.
		 */
		readonly provenance?: RunProvenance;
	})[];
	readonly messages: readonly StoredMessage[];
	/**
	 * Event-log high-water mark observed in the same transaction as the
	 * rest of the snapshot: the cursor basis for resuming subscriptions.
	 */
	readonly lastEventSequence: number;
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
	private readonly plugins: PluginCatalog | undefined;
	private readonly executionHealth: (() => Record<string, unknown>) | undefined;
	private readonly leadConfig: BotRecord["config"] | undefined;
	private readonly leadName: string | undefined;
	/** Catalog generation pins held by active (non-terminal) runs. */
	private readonly catalogPins = new Map<RunId, CatalogPin>();
	/** Hooks invoked when a run reaches a terminal state. */
	private readonly runTerminalHooks = new Set<(record: RunRecord) => void>();
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
		this.plugins = options.plugins;
		this.executionHealth = options.executionHealth;
		this.leadConfig = options.leadConfig;
		this.leadName = options.leadName;
		const sinks: InstrumentationSinks = {
			stores: this.stores,
			clock: this.clock,
			outboxEnqueued: () => this.onOutboxEnqueued(),
			runTerminal: (record) => {
				this.releaseCatalogPin(record.runId);
				// Registered hooks (e.g. connector auto-replies) run inside
				// the settlement transaction; a hook failure must never fail
				// the settlement itself.
				for (const hook of this.runTerminalHooks) {
					try {
						hook(record);
					} catch (error) {
						this.stores.audit.record(
							"gateway",
							"run.terminalHookFailed",
							record.runId,
							{
								error: error instanceof Error ? error.message : String(error),
							},
							this.clock.now(),
						);
					}
				}
			},
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
			options.prepareInvocation,
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
		// Broadcast approval settlement: late answers from other clients are
		// dropped by the broker (first answer wins); the durable event lets
		// every attached client dismiss its pending copy.
		this.approvals.onResolved = (request, approved) => {
			this.database.transaction(() => {
				this.stores.events.append(
					request.method === SERVER_REQUEST_METHODS.toolApproval
						? "approval.resolved"
						: "serverRequest.resolved",
					request.scope,
					{ requestId: request.id, method: request.method, approved },
					this.clock.now(),
				);
			});
		};
	}

	/** Ensure the default lead bot `cline` exists. */
	bootstrap(): BotRecord {
		this.defaultBot = this.database.transaction(() => {
			const before = this.stores.bots.list().length;
			const record = this.registry.bootstrap({
				config: this.leadConfig,
				name: this.leadName,
			});
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
				this.getBot(record.botId).recoverQueuedRun(
					record,
					undefined,
					this.stores.provenance.get(record.runId)?.mode,
				);
				this.pinCatalog(record.runId);
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

	/**
	 * Admit a prompt: durable FIFO queue + immediate acknowledgement.
	 * Without a `sessionId` the prompt enters the bot's canonical
	 * session; with one it joins that session's lane — including a
	 * connector conversation's dedicated session, which is how desktop
	 * intentionally participates in an external conversation.
	 */
	startRun(actor: string, params: RunStartParams): RunAccepted {
		this.refuseWhileDraining();
		const bot = this.getBot(params.botId);
		const targetSession = params.sessionId
			? this.stores.sessions.get(params.sessionId)
			: bot.session;
		if (params.sessionId && !targetSession) {
			throw new GatewayCallError(
				createGatewayError("not_found", `Unknown session: ${params.sessionId}`),
			);
		}
		let session = bot.session;
		if (params.newSession && params.sessionId) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_request",
					"newSession and sessionId cannot be used together",
				),
			);
		}
		if (session) {
			const pending = this.stores.runs.countPendingBySession(session.sessionId);
			if (params.newSession && pending > 0) {
				throw new GatewayCallError(
					createGatewayError(
						"invalid_state_transition",
						"Cannot start a new session while the current session has active or queued runs",
						{ retryable: true },
					),
				);
			}
		}
		this.applyBackpressure(
			params.newSession ? undefined : targetSession?.sessionId,
		);
		const provenance = RunProvenanceSchema.parse(
			params.provenance ?? { mode: "interactive", submittedBy: actor },
		);
		return this.database.transaction(() => {
			if (params.newSession && session) {
				bot.replaceSession();
				session = undefined;
			}
			// Effective config at admission (provider/model/prompt settings —
			// never credentials). Persisted as the run's snapshot below;
			// every attempt — retries, deferred queue starts, and crash
			// recovery — executes against it instead of live bot config.
			const snapshotConfig = resolveEffectiveConfig(
				bot.record.config,
				params.overrides,
			);
			const admitted = params.sessionId
				? bot.submitPromptToSession(params.prompt, {
						sessionId: params.sessionId,
						workspace: params.workspaceRoot
							? { rootPath: params.workspaceRoot }
							: undefined,
						overrides: params.overrides,
						source: provenance.mode,
					})
				: bot.submitPrompt(params.prompt, {
						// An explicit workspace is always forwarded so a mismatch
						// with an existing session's immutable workspace is
						// rejected loudly.
						workspace: params.workspaceRoot
							? { rootPath: params.workspaceRoot }
							: session
								? undefined
								: { rootPath: MANAGED_WORKSPACE_ROOT },
						overrides: params.overrides,
						source: provenance.mode,
					});
			// Dedicated-session admission also identifies the selected session for
			// connector callers. `run.start` has a deliberately smaller wire
			// response, so do not leak that domain-only field through the Gateway.
			const accepted: RunAccepted = {
				runId: admitted.runId,
				acceptedAt: admitted.acceptedAt,
				queuePosition: admitted.queuePosition,
			};
			this.finishAdmission(actor, params.botId, accepted, provenance);
			this.stores.runs.saveConfigSnapshot(accepted.runId, snapshotConfig);
			return accepted;
		});
	}

	createSession(actor: string, params: SessionCreateParams): SessionRecord {
		this.refuseWhileDraining();
		const bot = this.getBot(params.botId);
		return this.database.transaction(() => {
			const session = bot.openSession(
				params.workspaceRoot ? { rootPath: params.workspaceRoot } : undefined,
			);
			this.stores.audit.record(actor, "session.create", session.sessionId, {
				botId: params.botId,
			});
			return session;
		});
	}

	/**
	 * Connector admission (Gateway RFC, Phase 6): the same durable FIFO
	 * admission path as desktop/CLI prompts, but into the conversation's
	 * DEDICATED session — a new one on first contact, the routed one
	 * afterwards. External conversations therefore never touch the bot's
	 * canonical session or each other's.
	 */
	startConnectorRun(params: {
		botId: BotId;
		prompt: string;
		connectorId: ConnectorId;
		externalAccountId: string;
		externalConversationId: string;
		/** The conversation's existing dedicated session, when routed. */
		sessionId?: SessionId;
	}): RunAccepted & { sessionId: SessionId } {
		this.refuseWhileDraining();
		const actor = `connector:${params.connectorId}`;
		const bot = this.getBot(params.botId);
		if (params.sessionId) {
			this.applyBackpressure(params.sessionId);
		}
		const provenance = RunProvenanceSchema.parse({
			mode: "connector",
			submittedBy: actor,
			connectorId: params.connectorId,
			externalAccountId: params.externalAccountId,
			externalConversationId: params.externalConversationId,
		});
		return this.database.transaction(() => {
			const snapshotConfig = resolveEffectiveConfig(bot.record.config);
			const accepted = bot.submitPromptToSession(params.prompt, {
				sessionId: params.sessionId,
				// New conversations get a managed workspace of their own.
				workspace: params.sessionId
					? undefined
					: { rootPath: MANAGED_WORKSPACE_ROOT },
				source: "connector",
			});
			this.finishAdmission(actor, params.botId, accepted, provenance);
			this.stores.runs.saveConfigSnapshot(accepted.runId, snapshotConfig);
			return accepted;
		});
	}

	/** Automation admission for the scheduler: an ordinary run. */
	startAutomationRun(schedule: {
		scheduleId: ScheduleId;
		botId: BotId;
		prompt: string;
		name: string;
	}): RunAccepted {
		return this.startRun(`schedule:${schedule.scheduleId}`, {
			botId: schedule.botId,
			prompt: schedule.prompt,
			provenance: {
				mode: "automation",
				submittedBy: `schedule:${schedule.scheduleId}`,
				scheduleId: schedule.scheduleId,
				reason: schedule.name,
			},
		});
	}

	runProvenance(runId: RunId): RunProvenance | undefined {
		return this.stores.provenance.get(runId);
	}

	/** Catalog generations currently pinned by active runs (tests/status). */
	pinnedCatalogGenerations(): readonly number[] {
		return [...this.catalogPins.values()]
			.map((pin) => pin.snapshot.generation)
			.sort((a, b) => a - b);
	}

	catalogGenerationForRun(runId: RunId): number | undefined {
		return this.catalogPins.get(runId)?.snapshot.generation;
	}

	private refuseWhileDraining(): void {
		if (this.draining) {
			throw new GatewayCallError(
				createGatewayError(
					"gateway_draining",
					"Gateway is draining and refuses new mutating work",
					{ retryable: true },
				),
			);
		}
	}

	/** Adaptive per-session admission backpressure. */
	private applyBackpressure(sessionId: SessionId | undefined): void {
		if (!sessionId) {
			return;
		}
		const pending = this.stores.runs.countPendingBySession(sessionId);
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

	/** Shared post-admission bookkeeping (inside the admission transaction). */
	private finishAdmission(
		actor: string,
		botId: BotId,
		accepted: RunAccepted,
		provenance: RunProvenance,
	): void {
		this.stores.provenance.record(accepted.runId, provenance, this.clock.now());
		this.pinCatalog(accepted.runId);
		this.stores.audit.record(
			actor,
			"run.start",
			accepted.runId,
			{
				botId,
				queuePosition: accepted.queuePosition,
				mode: provenance.mode,
			},
			this.clock.now(),
		);
	}

	private pinCatalog(runId: RunId): void {
		if (this.plugins && !this.catalogPins.has(runId)) {
			this.catalogPins.set(runId, this.plugins.pin());
		}
	}

	private releaseCatalogPin(runId: RunId): void {
		const pin = this.catalogPins.get(runId);
		if (pin) {
			this.catalogPins.delete(runId);
			pin.release();
		}
	}

	/** Merge steering text into the run's active lane. */
	steerRun(actor: string, runId: RunId, text: string): { merged: boolean } {
		const { bot, record } = this.requireRun(runId);
		if (record.state !== "running" || !bot.isRunActive(runId)) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_state_transition",
					`Run ${runId} is ${record.state}; steering merges only into the active run`,
					{ retryable: false },
				),
			);
		}
		const merged = bot.steerRun(runId, text);
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

	/**
	 * Manual retry: re-admit a failed or interrupted run under the SAME
	 * runId. The next execution is a new attempt in the run's durable
	 * attempt history. Only an explicit client command lands here — the
	 * Gateway never auto-retries after a reconnect or restart.
	 */
	retryRun(actor: string, runId: RunId, reason?: string): RunAccepted {
		if (this.draining) {
			throw new GatewayCallError(
				createGatewayError(
					"gateway_draining",
					"Gateway is draining and refuses new mutating work",
					{ retryable: true },
				),
			);
		}
		const { bot, record } = this.requireRun(runId);
		if (!canRetryRunState(record.state)) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_state_transition",
					`Run ${runId} is ${record.state}; only failed or interrupted runs can be retried`,
					{ retryable: false },
				),
			);
		}
		assertRunStateTransition(record.state, "queued");
		const session = this.stores.sessions.get(record.sessionId);
		if (!session || session.state !== "active") {
			throw new GatewayCallError(
				createGatewayError(
					"run_admission_rejected",
					`Run ${runId} belongs to a closed or missing session and cannot be retried`,
					{ retryable: false },
				),
			);
		}
		const pendingAhead = this.stores.runs.countPendingBySession(
			record.sessionId,
		);
		if (pendingAhead >= this.maxPendingRunsPerSession) {
			throw new GatewayCallError(
				createGatewayError(
					"run_admission_rejected",
					`Session queue is full (${pendingAhead} pending runs); retry later`,
					{
						retryable: true,
						details: {
							pending: pendingAhead,
							limit: this.maxPendingRunsPerSession,
						},
					},
				),
			);
		}
		return this.database.transaction(() => {
			const acceptedAt = this.clock.now();
			const nextAttempt = this.stores.attempts.listByRun(runId).length + 1;
			this.stores.events.append(
				"run.retried",
				{ botId: record.botId, sessionId: record.sessionId, runId },
				{
					previousState: record.state,
					nextAttempt,
					...(reason ? { reason } : {}),
				},
				acceptedAt,
			);
			const requeued: RunRecord = {
				...record,
				state: "queued",
				acceptedAt,
				startedAt: undefined,
				endedAt: undefined,
				outputText: undefined,
				error: undefined,
			};
			// Emits the durable `run.queued` event via the instrumented repo.
			this.runsPort.save(requeued);
			bot.recoverQueuedRun(
				requeued,
				undefined,
				this.stores.provenance.get(runId)?.mode,
			);
			this.stores.audit.record(
				actor,
				"run.retry",
				runId,
				{ previousState: record.state, nextAttempt, reason },
				acceptedAt,
			);
			return { runId, acceptedAt, queuePosition: pendingAhead };
		});
	}

	/** Consistent hydration snapshot of one session (single transaction). */
	getSessionSnapshot(sessionId: SessionId): SessionSnapshot {
		return this.database.transaction(() => {
			const session = this.stores.sessions.get(sessionId);
			if (!session) {
				throw new GatewayCallError(
					createGatewayError("not_found", `Unknown session: ${sessionId}`),
				);
			}
			return {
				session,
				runs: this.stores.runs.listBySession(sessionId).map((run) => {
					const provenance = this.stores.provenance.get(run.runId);
					return {
						...run,
						attempts: this.stores.attempts.listByRun(run.runId),
						...(provenance ? { provenance } : {}),
					};
				}),
				messages: this.stores.messages.listBySession(sessionId),
				lastEventSequence: this.stores.events.lastSequence(),
			};
		});
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

	/**
	 * Register a bot-scoped connector (Gateway RFC, Phase 6). The config
	 * is non-secret; the credential stays an owner-only 0600 file named
	 * by `credentialRef`.
	 */
	registerConnector(
		actor: string,
		params: {
			botId: BotId;
			kind: string;
			name: string;
			config?: Record<string, unknown>;
			credentialRef?: string;
		},
	): ConnectorRecord {
		if (this.draining) {
			throw new GatewayCallError(
				createGatewayError(
					"gateway_draining",
					"Gateway is draining and refuses new mutating work",
					{ retryable: true },
				),
			);
		}
		const bot = this.stores.bots.get(params.botId);
		if (!bot) {
			throw new GatewayCallError(
				createGatewayError("not_found", `Unknown bot: ${params.botId}`),
			);
		}
		// Config is non-secret by contract; tokens go into 0600 files.
		assertNonSecretConnectorConfig(params.config ?? {});
		return this.database.transaction(() => {
			const record: ConnectorRecord = {
				connectorId: createConnectorId(),
				botId: params.botId,
				kind: params.kind,
				name: params.name,
				config: params.config ?? {},
				credentialRef: params.credentialRef,
				status: "enabled",
				createdAt: this.clock.now(),
				revision: 0,
			};
			this.stores.connectors.save(record);
			this.stores.events.append(
				"connector.registered",
				{ botId: params.botId },
				{
					connectorId: record.connectorId,
					kind: params.kind,
					name: params.name,
				},
				this.clock.now(),
			);
			this.stores.audit.record(
				actor,
				"connector.register",
				record.connectorId,
				{ botId: params.botId, kind: params.kind },
				this.clock.now(),
			);
			return record;
		});
	}

	listConnectors(botId?: BotId): readonly ConnectorRecord[] {
		return this.stores.connectors.list(botId);
	}

	/** Register a run-terminal hook (e.g. connector auto-replies). */
	onRunTerminal(hook: (record: RunRecord) => void): () => void {
		this.runTerminalHooks.add(hook);
		return () => {
			this.runTerminalHooks.delete(hook);
		};
	}

	requireConnector(connectorId: ConnectorId): ConnectorRecord {
		const record = this.stores.connectors.get(connectorId);
		if (!record) {
			throw new GatewayCallError(
				createGatewayError("not_found", `Unknown connector: ${connectorId}`),
			);
		}
		return record;
	}

	/** Enable or disable a connector (audited). */
	setConnectorEnabled(
		actor: string,
		connectorId: ConnectorId,
		enabled: boolean,
	): ConnectorRecord {
		this.refuseWhileDraining();
		const record = this.requireConnector(connectorId);
		const status: ConnectorStatus = enabled ? "enabled" : "disabled";
		if (record.status === status) {
			return record;
		}
		return this.database.transaction(() => {
			const updated: ConnectorRecord = {
				...record,
				status,
				revision: record.revision + 1,
			};
			this.stores.connectors.save(updated);
			this.stores.events.append(
				enabled ? "connector.enabled" : "connector.disabled",
				{ botId: record.botId },
				{ connectorId },
				this.clock.now(),
			);
			this.stores.audit.record(
				actor,
				enabled ? "connector.enable" : "connector.disable",
				connectorId,
				undefined,
				this.clock.now(),
			);
			return updated;
		});
	}

	/** Update non-secret connector configuration (audited). */
	updateConnectorConfig(
		actor: string,
		connectorId: ConnectorId,
		config: Record<string, unknown>,
	): ConnectorRecord {
		this.refuseWhileDraining();
		const record = this.requireConnector(connectorId);
		assertNonSecretConnectorConfig(config);
		return this.database.transaction(() => {
			const updated: ConnectorRecord = {
				...record,
				config,
				revision: record.revision + 1,
			};
			this.stores.connectors.save(updated);
			this.stores.audit.record(
				actor,
				"connector.updateConfig",
				connectorId,
				{ keys: Object.keys(config) },
				this.clock.now(),
			);
			return updated;
		});
	}

	/**
	 * Replace the credential REFERENCE (the secret itself is placed via
	 * `cline-gateway secret-put` / an owner-only 0600 file, never here).
	 */
	setConnectorCredentialRef(
		actor: string,
		connectorId: ConnectorId,
		credentialRef: string | undefined,
	): ConnectorRecord {
		this.refuseWhileDraining();
		const record = this.requireConnector(connectorId);
		return this.database.transaction(() => {
			const updated: ConnectorRecord = {
				...record,
				credentialRef,
				revision: record.revision + 1,
			};
			this.stores.connectors.save(updated);
			this.stores.audit.record(
				actor,
				"connector.setCredential",
				connectorId,
				// The reference name only — never a secret value.
				{ credentialRef: credentialRef ?? null },
				this.clock.now(),
			);
			return updated;
		});
	}

	/** Remove a connector (routes and outbound history are retained). */
	removeConnector(
		actor: string,
		connectorId: ConnectorId,
	): { removed: boolean } {
		this.refuseWhileDraining();
		const record = this.requireConnector(connectorId);
		return this.database.transaction(() => {
			const removed = this.stores.connectors.delete(connectorId);
			this.stores.events.append(
				"connector.removed",
				{ botId: record.botId },
				{ connectorId },
				this.clock.now(),
			);
			this.stores.audit.record(
				actor,
				"connector.remove",
				connectorId,
				undefined,
				this.clock.now(),
			);
			return { removed };
		});
	}

	/** The conversation routes of one connector (with their sessions). */
	listConnectorRoutes(
		connectorId: ConnectorId,
	): ReturnType<GatewayStores["connectorRoutes"]["listByConnector"]> {
		this.requireConnector(connectorId);
		return this.stores.connectorRoutes.listByConnector(connectorId);
	}

	/** Outbound message records (delivery state surface for clients). */
	listOutboundMessages(filter: {
		connectorId?: ConnectorId;
		botId?: BotId;
		state?: "pending" | "sending" | "delivered" | "failed";
		limit?: number;
	}): ReturnType<GatewayStores["connectorOutbound"]["list"]> {
		return this.stores.connectorOutbound.list(filter);
	}

	/** Create a schedule (Gateway RFC, Phase 6): a durable trigger. */
	createSchedule(
		actor: string,
		params: {
			botId: BotId;
			name: string;
			prompt: string;
			intervalMs?: number;
			at?: number;
			maxAttempts?: number;
			/** Deliver firing outcomes to a connector conversation. */
			notify?: {
				connectorId: ConnectorId;
				externalAccountId: string;
				externalConversationId: string;
			};
		},
	): ScheduleRecord {
		if (this.draining) {
			throw new GatewayCallError(
				createGatewayError(
					"gateway_draining",
					"Gateway is draining and refuses new mutating work",
					{ retryable: true },
				),
			);
		}
		const bot = this.stores.bots.get(params.botId);
		if (!bot) {
			throw new GatewayCallError(
				createGatewayError("not_found", `Unknown bot: ${params.botId}`),
			);
		}
		if ((params.intervalMs === undefined) === (params.at === undefined)) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_request",
					"A schedule takes exactly one trigger: intervalMs (recurring) or at (one-shot)",
				),
			);
		}
		if (params.notify) {
			// The notify target must be a connector of the SAME bot.
			const connector = this.stores.connectors.get(params.notify.connectorId);
			if (!connector || connector.botId !== params.botId) {
				throw new GatewayCallError(
					createGatewayError(
						"unauthorized",
						`Notify connector ${params.notify.connectorId} does not belong to bot ${params.botId}`,
					),
				);
			}
		}
		return this.database.transaction(() => {
			const now = this.clock.now();
			const record: ScheduleRecord = {
				scheduleId: createScheduleId(),
				botId: params.botId,
				name: params.name,
				prompt: params.prompt,
				intervalMs: params.intervalMs,
				at: params.at,
				nextDueAt: params.at ?? now + (params.intervalMs ?? 0),
				enabled: true,
				maxAttempts: Math.max(1, params.maxAttempts ?? 1),
				notify: params.notify,
				createdAt: now,
				revision: 0,
			};
			this.stores.schedules.save(record);
			this.stores.events.append(
				"schedule.created",
				{ botId: params.botId },
				{ scheduleId: record.scheduleId, name: params.name },
				now,
			);
			this.stores.audit.record(
				actor,
				"schedule.create",
				record.scheduleId,
				{ botId: params.botId },
				now,
			);
			return record;
		});
	}

	listSchedules(botId?: BotId): readonly ScheduleRecord[] {
		return this.stores.schedules.list(botId);
	}

	scheduleReport(
		scheduleId: ScheduleId,
	): ReturnType<GatewayStores["scheduleJobs"]["report"]> {
		return this.stores.scheduleJobs.report(scheduleId);
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
			// Reported honestly until Phase 4 lands real sandboxed execution:
			// engines run unsandboxed inside the Gateway process.
			executionMode: GATEWAY_EXECUTION_MODE,
			sandboxed: false,
			gatewayId: this.stores.meta.ensureGatewayId(),
			instanceId: this.instanceId,
			pid: process.pid,
			startedAt: this.startedAt,
			protocolVersion: GATEWAY_PROTOCOL_VERSION,
			defaultBotId: this.defaultBotId,
			catalogGeneration: this.stores.meta.catalogGeneration(),
			namespace: this.paths.namespace,
			dataDir: this.paths.dataDir,
			// Isolation is always visible in health/telemetry — including
			// the default direct in-process execution (a development mode).
			execution: this.executionHealth?.() ?? {
				isolation: "in-process-direct",
				development: true,
			},
			...(this.plugins
				? {
						plugins: {
							generation: this.plugins.current.generation,
							plugins: this.plugins.current.entries.length,
							heldGenerations: this.plugins.heldGenerations(),
							pinnedByRuns: this.catalogPins.size,
							lastReloadOk: this.plugins.lastReloadReport?.ok ?? true,
						},
					}
				: {}),
			counts: {
				bots: this.stores.bots.list().length,
				sessions: this.stores.sessions.list().length,
				queuedRuns: this.stores.runs.countByState("queued"),
				runningRuns: this.stores.runs.countByState("running"),
				clients: this.stores.clients.count(),
				pendingOutbox: this.stores.outbox.countPending(),
				lastEventSequence: this.stores.events.lastSequence(),
				pendingServerRequests: this.approvals.pendingCount,
				connectors: this.stores.connectors.list().length,
				schedules: this.stores.schedules.list().length,
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
		if (!bot.isRunActive(runId)) {
			throw new GatewayCallError(
				createGatewayError(
					"invalid_state_transition",
					`Run ${runId} is not this instance's active run (a previous instance owned it)`,
					{ retryable: false },
				),
			);
		}
		if (mode === "interrupt") {
			bot.interruptRun(runId, reason);
		} else {
			bot.abortRun(runId, reason);
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
