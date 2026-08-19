/**
 * In-process fake of the `GatewayPort` surface for broker integration
 * tests. Mirrors the Phase 3 semantics the broker depends on: lazy
 * session creation, immediate run acks, a global contiguous event log
 * with cursor replay, snapshots, and server-initiated approvals. Used
 * ONLY by tests — production always connects through
 * `@cline/gateway/client`.
 */

import type {
	BotRecord,
	ConnectorRecord,
	GatewayStatusSummary,
	RunRecord,
	ScheduleJobRecord,
	ScheduleRecord,
	SessionRecord,
	SessionSnapshot,
} from "@cline/gateway/client";
import type {
	GatewayEvent,
	GatewayServerRequest,
	RunAccepted,
} from "@cline/shared/gateway";
import { decodeEventCursor } from "@cline/shared/gateway";
import type { GatewayHelloInfo, GatewayPort } from "../gateway/port";

let fakeCounter = 0;

export interface FakeGatewayOptions {
	gatewayId?: string;
	instanceId?: string;
	protocolVersion?: number;
}

/** Shared "authority" state so several fake ports see one Gateway. */
export class FakeGatewayAuthority {
	readonly gatewayId: string;
	instanceId: string;
	readonly bots: BotRecord[] = [];
	readonly sessions: SessionRecord[] = [];
	readonly runs = new Map<string, RunRecord>();
	readonly attemptsByRun = new Map<string, number>();
	readonly connectors: ConnectorRecord[] = [];
	readonly schedules: ScheduleRecord[] = [];
	readonly scheduleJobs = new Map<string, ScheduleJobRecord[]>();
	readonly provenanceByRun = new Map<string, Record<string, unknown>>();
	readonly messagesBySession = new Map<
		string,
		{
			messageSeq: number;
			sessionId: string;
			runId?: string;
			message: unknown;
		}[]
	>();
	readonly events: GatewayEvent[] = [];
	private sequence = 0;
	readonly ports = new Set<FakeGatewayPort>();
	readonly idempotency = new Map<string, unknown>();
	private nextServerRequestId = 0;
	readonly pendingServerRequests = new Map<
		string,
		{ request: GatewayServerRequest; resolve: (value: unknown) => void }
	>();

	constructor(options: FakeGatewayOptions = {}) {
		fakeCounter += 1;
		this.gatewayId = options.gatewayId ?? `gw_fake${fakeCounter}`;
		this.instanceId = options.instanceId ?? `gwi_fake${fakeCounter}_1`;
		const botId = `bot_fake${fakeCounter}`;
		this.bots.push({
			identity: {
				botId: botId as never,
				name: "cline",
				role: "lead" as never,
				parentBotId: null,
				provenance: { createdBy: "bootstrap" },
				createdAt: 1,
			},
			config: {} as never,
			status: "active",
			revision: 0,
		});
	}

	get defaultBotId(): string {
		return this.bots[0].identity.botId;
	}

	appendEvent(
		event: string,
		scope: { botId?: string; sessionId?: string; runId?: string },
		payload?: Record<string, unknown>,
	): GatewayEvent {
		this.sequence += 1;
		const stored = {
			version: 1,
			sequence: this.sequence,
			event,
			scope,
			...(payload ? { payload } : {}),
		} as GatewayEvent;
		this.events.push(stored);
		for (const port of this.ports) {
			port.deliver(stored);
		}
		return stored;
	}

	get lastSequence(): number {
		return this.sequence;
	}

	/** Server-initiated approval request (broadcast to subscribed ports). */
	requestApproval(
		scope: { botId?: string; sessionId?: string; runId?: string },
		params: Record<string, unknown>,
	): { id: string; answer: Promise<unknown> } {
		this.nextServerRequestId += 1;
		const id = `srq_fake_${this.nextServerRequestId}`;
		const request = {
			version: 1,
			id,
			method: "client.requestToolApproval",
			scope,
			params,
		} as GatewayServerRequest;
		const answer = new Promise<unknown>((resolve) => {
			this.pendingServerRequests.set(id, { request, resolve });
		});
		for (const port of this.ports) {
			port.deliverServerRequest(request);
		}
		return { id, answer };
	}

	/** First answer wins; later answers are dropped (like the Gateway). */
	respondToApproval(id: string, result: unknown): boolean {
		const entry = this.pendingServerRequests.get(id);
		if (!entry) {
			return false;
		}
		this.pendingServerRequests.delete(id);
		entry.resolve(result);
		const approved =
			typeof result === "object" &&
			result !== null &&
			(result as { approved?: unknown }).approved === true;
		this.appendEvent("approval.resolved", entry.request.scope, {
			requestId: id,
			method: entry.request.method,
			approved,
		});
		return true;
	}

	sessionFor(botId: string): SessionRecord | undefined {
		return this.sessions.find(
			(session) => session.botId === botId && session.state === "active",
		);
	}

	/** Register a fake connector (diagnostics fixtures). */
	addConnector(input: {
		botId: string;
		kind: string;
		name: string;
		credentialRef?: string;
	}): ConnectorRecord {
		fakeCounter += 1;
		const record: ConnectorRecord = {
			connectorId: `con_fake${fakeCounter}` as never,
			botId: input.botId as never,
			kind: input.kind,
			name: input.name,
			config: Object.freeze({}),
			...(input.credentialRef ? { credentialRef: input.credentialRef } : {}),
			status: "enabled",
			createdAt: Date.now(),
			revision: 0,
		};
		this.connectors.push(record);
		this.appendEvent(
			"connector.registered",
			{ botId: input.botId },
			{ connectorId: record.connectorId, kind: record.kind, name: record.name },
		);
		return record;
	}

	/** Create a fake schedule (diagnostics fixtures). */
	addSchedule(input: {
		botId: string;
		name: string;
		prompt: string;
		intervalMs?: number;
		at?: number;
	}): ScheduleRecord {
		fakeCounter += 1;
		const record: ScheduleRecord = {
			scheduleId: `sch_fake${fakeCounter}` as never,
			botId: input.botId as never,
			name: input.name,
			prompt: input.prompt,
			...(input.intervalMs !== undefined
				? { intervalMs: input.intervalMs }
				: {}),
			...(input.at !== undefined ? { at: input.at } : {}),
			nextDueAt: Date.now() + (input.intervalMs ?? 0),
			enabled: true,
			maxAttempts: 1,
			createdAt: Date.now(),
			revision: 0,
		};
		this.schedules.push(record);
		this.appendEvent(
			"schedule.created",
			{ botId: input.botId },
			{ scheduleId: record.scheduleId, name: record.name },
		);
		return record;
	}

	/** Admit a run the way a connector message would (provenance). */
	admitConnectorRun(
		connectorId: string,
		botId: string,
		prompt: string,
	): RunAccepted {
		const accepted = this.startRun({ botId, prompt });
		this.provenanceByRun.set(accepted.runId, {
			mode: "connector",
			submittedBy: `connector:${connectorId}`,
			connectorId,
			externalAccountId: "acct-1",
			externalConversationId: "conv-1",
		});
		const run = this.runs.get(accepted.runId);
		this.appendEvent(
			"connector.messageAdmitted",
			{
				botId,
				sessionId: run?.sessionId ?? "",
				runId: accepted.runId,
			},
			{
				connectorId,
				externalConversationId: "conv-1",
				externalMessageId: "msg-1",
				routeCreated: true,
			},
		);
		return accepted;
	}

	/** Admit a run the way the scheduler would (automation provenance). */
	admitAutomationRun(
		scheduleId: string,
		botId: string,
		prompt: string,
	): RunAccepted {
		const accepted = this.startRun({ botId, prompt });
		this.provenanceByRun.set(accepted.runId, {
			mode: "automation",
			submittedBy: `schedule:${scheduleId}`,
			scheduleId,
		});
		const jobs = this.scheduleJobs.get(scheduleId) ?? [];
		jobs.push({
			jobId: jobs.length + 1,
			scheduleId: scheduleId as never,
			dueAt: Date.now(),
			state: "completed",
			attempts: 1,
			runId: accepted.runId as never,
			createdAt: Date.now(),
			settledAt: Date.now(),
		});
		this.scheduleJobs.set(scheduleId, jobs);
		return accepted;
	}

	startRun(input: {
		botId: string;
		prompt: string;
		workspaceRoot?: string;
		idempotencyKey?: string;
	}): RunAccepted {
		if (input.idempotencyKey) {
			const replay = this.idempotency.get(input.idempotencyKey);
			if (replay) {
				return replay as RunAccepted;
			}
		}
		let session = this.sessionFor(input.botId);
		if (!session) {
			fakeCounter += 1;
			session = {
				sessionId: `ses_fake${fakeCounter}` as never,
				botId: input.botId as never,
				workspace: Object.freeze({
					rootPath:
						input.workspaceRoot ?? `/fake/managed/ses_fake${fakeCounter}`,
				}),
				state: "active",
				createdAt: Date.now(),
				revision: 0,
			};
			this.sessions.push(session);
			this.appendEvent(
				"session.created",
				{ botId: input.botId, sessionId: session.sessionId },
				{ workspaceRoot: session.workspace.rootPath },
			);
		} else if (
			input.workspaceRoot &&
			input.workspaceRoot !== session.workspace.rootPath
		) {
			throw gatewayErrorObject(
				"run_admission_rejected",
				"Session workspace cannot change",
				false,
			);
		}
		fakeCounter += 1;
		const runId = `run_fake${fakeCounter}`;
		const pending = [...this.runs.values()].filter(
			(run) =>
				run.sessionId === session.sessionId &&
				(run.state === "queued" || run.state === "running"),
		);
		const accepted: RunAccepted = {
			runId: runId as never,
			acceptedAt: Date.now(),
			queuePosition: pending.length,
		};
		this.runs.set(runId, {
			runId: runId as never,
			sessionId: session.sessionId,
			botId: input.botId as never,
			state: "queued",
			input: input.prompt,
			acceptedAt: accepted.acceptedAt,
		});
		this.provenanceByRun.set(runId, {
			mode: "interactive",
			submittedBy: "cli_fake_client",
		});
		this.appendEvent(
			"run.queued",
			{
				botId: input.botId,
				sessionId: session.sessionId,
				runId,
			},
			{ state: "queued", acceptedAt: accepted.acceptedAt },
		);
		if (input.idempotencyKey) {
			this.idempotency.set(input.idempotencyKey, accepted);
		}
		return accepted;
	}

	setRunState(
		runId: string,
		state: RunRecord["state"],
		payload: Record<string, unknown> = {},
	): void {
		const run = this.runs.get(runId);
		if (!run) {
			throw new Error(`unknown fake run ${runId}`);
		}
		this.runs.set(runId, { ...run, state });
		const eventName = {
			queued: "run.queued",
			running: "run.started",
			completed: "run.completed",
			failed: "run.failed",
			aborted: "run.aborted",
			interrupted: "run.interrupted",
		}[state];
		this.appendEvent(
			eventName,
			{ botId: run.botId, sessionId: run.sessionId, runId },
			{ state, ...payload },
		);
	}
}

function gatewayErrorObject(
	code: string,
	message: string,
	retryable: boolean,
): Error & { gatewayError: unknown } {
	return Object.assign(new Error(message), {
		gatewayError: { code, message, retryable },
	});
}

export class FakeGatewayPort implements GatewayPort {
	readonly hello: GatewayHelloInfo;
	readonly authority: FakeGatewayAuthority;
	private eventListeners = new Set<(event: GatewayEvent) => void>();
	private closeListeners = new Set<() => void>();
	private serverRequestHandler:
		| ((request: GatewayServerRequest) => Promise<unknown> | unknown)
		| undefined;
	private subscribedAfter: number | undefined;
	closed = false;

	constructor(authority: FakeGatewayAuthority, clientId?: string) {
		this.authority = authority;
		fakeCounter += 1;
		this.hello = {
			gatewayId: authority.gatewayId,
			instanceId: authority.instanceId,
			protocolVersion: 1,
			clientId: clientId ?? `cli_fake${fakeCounter}`,
			capabilities: ["runs.async", "events.replay", "serverRequests"],
		};
		authority.ports.add(this);
	}

	deliver(event: GatewayEvent): void {
		if (this.closed || this.subscribedAfter === undefined) {
			return;
		}
		if (event.sequence <= this.subscribedAfter) {
			return;
		}
		this.subscribedAfter = event.sequence;
		for (const listener of this.eventListeners) {
			listener(event);
		}
	}

	deliverServerRequest(request: GatewayServerRequest): void {
		if (this.closed || this.subscribedAfter === undefined) {
			return;
		}
		const handler = this.serverRequestHandler;
		if (!handler) {
			return;
		}
		void (async () => {
			const result = await handler(request);
			this.authority.respondToApproval(request.id, result);
		})();
	}

	async getStatus(): Promise<GatewayStatusSummary> {
		this.assertOpen();
		return {
			state: "serving",
			executionMode: "development",
			sandboxed: false,
			gatewayId: this.authority.gatewayId,
			instanceId: this.authority.instanceId,
			pid: 1234,
			startedAt: 1,
			protocolVersion: 1,
			defaultBotId: this.authority.defaultBotId as never,
			catalogGeneration: 3,
			namespace: "default",
			dataDir: "/fake/data",
			execution: { isolation: "in-process-direct", development: true },
			plugins: {
				generation: 3,
				plugins: 2,
				heldGenerations: [3],
				pinnedByRuns: 0,
				lastReloadOk: true,
			},
			connectorHealth: {
				running: this.authority.connectors.map((connector) => ({
					connectorId: connector.connectorId,
					workerId: `worker_${connector.connectorId}`,
					restarts: 0,
					state: "running",
				})),
			},
			counts: {
				bots: this.authority.bots.length,
				sessions: this.authority.sessions.length,
				queuedRuns: 0,
				runningRuns: 0,
				clients: this.authority.ports.size,
				pendingOutbox: 0,
				lastEventSequence: this.authority.lastSequence,
				pendingServerRequests: this.authority.pendingServerRequests.size,
				connectors: this.authority.connectors.length,
				schedules: this.authority.schedules.length,
			},
			port: 0,
			connections: this.authority.ports.size,
		};
	}

	async listConnectors(input?: {
		botId?: string;
	}): Promise<{ connectors: readonly ConnectorRecord[] }> {
		this.assertOpen();
		return {
			connectors: this.authority.connectors.filter(
				(connector) => !input?.botId || connector.botId === input.botId,
			),
		};
	}

	async listSchedules(input?: {
		botId?: string;
	}): Promise<{ schedules: readonly ScheduleRecord[] }> {
		this.assertOpen();
		return {
			schedules: this.authority.schedules.filter(
				(schedule) => !input?.botId || schedule.botId === input.botId,
			),
		};
	}

	async scheduleReport(input: {
		scheduleId: string;
	}): Promise<{ jobs: readonly ScheduleJobRecord[] }> {
		this.assertOpen();
		return { jobs: this.authority.scheduleJobs.get(input.scheduleId) ?? [] };
	}

	async listBots(): Promise<{ bots: readonly BotRecord[] }> {
		this.assertOpen();
		return { bots: [...this.authority.bots] };
	}

	async listSessions(input?: {
		botId?: string;
	}): Promise<{ sessions: readonly SessionRecord[] }> {
		this.assertOpen();
		return {
			sessions: this.authority.sessions.filter(
				(session) => !input?.botId || session.botId === input.botId,
			),
		};
	}

	async listRuns(input?: {
		sessionId?: string;
		runId?: string;
	}): Promise<{ runs: readonly RunRecord[] }> {
		this.assertOpen();
		const all = [...this.authority.runs.values()];
		if (input?.runId) {
			return { runs: all.filter((run) => run.runId === input.runId) };
		}
		if (input?.sessionId) {
			return { runs: all.filter((run) => run.sessionId === input.sessionId) };
		}
		return {
			runs: all.filter(
				(run) => run.state === "queued" || run.state === "running",
			),
		};
	}

	async getSession(input: { sessionId: string }): Promise<SessionSnapshot> {
		this.assertOpen();
		const session = this.authority.sessions.find(
			(entry) => entry.sessionId === input.sessionId,
		);
		if (!session) {
			throw gatewayErrorObject(
				"not_found",
				`Unknown session: ${input.sessionId}`,
				false,
			);
		}
		const runs = [...this.authority.runs.values()]
			.filter((run) => run.sessionId === input.sessionId)
			.map((run) => ({
				...run,
				attempts: Array.from(
					{ length: this.authority.attemptsByRun.get(run.runId) ?? 1 },
					(_, index) => ({
						runId: run.runId,
						attempt: index + 1,
						state: "completed" as const,
						instanceId: this.authority.instanceId,
						startedAt: run.acceptedAt,
					}),
				),
				...(this.authority.provenanceByRun.has(run.runId)
					? {
							provenance: this.authority.provenanceByRun.get(
								run.runId,
							) as never,
						}
					: {}),
			}));
		return {
			session,
			runs,
			messages: (this.authority.messagesBySession.get(input.sessionId) ??
				[]) as never,
			lastEventSequence: this.authority.lastSequence,
		};
	}

	async startRun(input: {
		botId: string;
		prompt: string;
		workspaceRoot?: string;
		idempotencyKey?: string;
	}): Promise<RunAccepted> {
		this.assertOpen();
		return this.authority.startRun(input);
	}

	async steerRun(input: {
		runId: string;
		text: string;
	}): Promise<{ merged: boolean }> {
		this.assertOpen();
		const run = this.authority.runs.get(input.runId);
		if (!run || run.state !== "running") {
			throw gatewayErrorObject(
				"invalid_state_transition",
				`Run ${input.runId} is not running`,
				false,
			);
		}
		this.authority.appendEvent(
			"run.steered",
			{ botId: run.botId, sessionId: run.sessionId, runId: run.runId },
			{ textLength: input.text.length },
		);
		return { merged: true };
	}

	async interruptRun(input: { runId: string }): Promise<{ state: string }> {
		this.assertOpen();
		const run = this.authority.runs.get(input.runId);
		if (!run) {
			throw gatewayErrorObject("not_found", "unknown run", false);
		}
		if (run.state === "queued") {
			this.authority.setRunState(input.runId, "aborted");
			return { state: "aborted" };
		}
		if (run.state !== "running") {
			throw gatewayErrorObject(
				"invalid_state_transition",
				`Run is already ${run.state}`,
				false,
			);
		}
		this.authority.setRunState(input.runId, "interrupted", {
			endedAt: Date.now(),
		});
		return { state: "running" };
	}

	async retryRun(input: {
		runId: string;
		idempotencyKey?: string;
	}): Promise<RunAccepted> {
		this.assertOpen();
		if (input.idempotencyKey) {
			const replay = this.authority.idempotency.get(
				`retry:${input.idempotencyKey}`,
			);
			if (replay) {
				return replay as RunAccepted;
			}
		}
		const run = this.authority.runs.get(input.runId);
		if (!run) {
			throw gatewayErrorObject("not_found", "unknown run", false);
		}
		if (run.state !== "failed" && run.state !== "interrupted") {
			throw gatewayErrorObject(
				"invalid_state_transition",
				`Run ${input.runId} is ${run.state}; only failed or interrupted runs can be retried`,
				false,
			);
		}
		const attempts = this.authority.attemptsByRun.get(input.runId) ?? 1;
		this.authority.attemptsByRun.set(input.runId, attempts + 1);
		this.authority.appendEvent(
			"run.retried",
			{ botId: run.botId, sessionId: run.sessionId, runId: run.runId },
			{ previousState: run.state, nextAttempt: attempts + 1 },
		);
		this.authority.setRunState(input.runId, "queued", {
			acceptedAt: Date.now(),
		});
		const accepted: RunAccepted = {
			runId: input.runId as never,
			acceptedAt: Date.now(),
			queuePosition: 0,
		};
		if (input.idempotencyKey) {
			this.authority.idempotency.set(`retry:${input.idempotencyKey}`, accepted);
		}
		return accepted;
	}

	async subscribe(params: { cursor?: string }): Promise<unknown> {
		this.assertOpen();
		const after = params.cursor
			? decodeEventCursor(params.cursor).lastSequence
			: this.authority.lastSequence;
		this.subscribedAfter = after;
		// Replay strictly after the cursor, like the real server.
		for (const event of this.authority.events) {
			if (event.sequence > after) {
				this.subscribedAfter = event.sequence;
				for (const listener of this.eventListeners) {
					listener(event);
				}
			}
		}
		// Re-issue pending server requests (reconnect semantics).
		for (const { request } of this.authority.pendingServerRequests.values()) {
			this.deliverServerRequest(request);
		}
		return { subscribed: true, replayFromSequence: after };
	}

	onEvent(listener: (event: GatewayEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onServerRequest(
		handler: (request: GatewayServerRequest) => Promise<unknown> | unknown,
	): void {
		this.serverRequestHandler = handler;
	}

	onClose(listener: () => void): () => void {
		this.closeListeners.add(listener);
		return () => this.closeListeners.delete(listener);
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.authority.ports.delete(this);
		for (const listener of this.closeListeners) {
			listener();
		}
	}

	/** Simulate the Gateway process dying (socket loss). */
	simulateDisconnect(): void {
		this.close();
	}

	private assertOpen(): void {
		if (this.closed) {
			throw gatewayErrorObject(
				"gateway_unreachable",
				"Connection is closed",
				true,
			);
		}
	}
}
