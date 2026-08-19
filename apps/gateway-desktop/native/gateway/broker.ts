/**
 * DesktopBroker — owns the Gateway connection and the replaceable UI
 * projection.
 *
 * - Connects through an injected `GatewayPortFactory` (production: the
 *   `@cline/gateway/client` typed client; tests: fakes). It NEVER
 *   starts, stops, upgrades, or replaces a Gateway.
 * - Hydrates snapshots, subscribes from the persisted cursor, applies
 *   only contiguous events, and forces a clean reconnect+rehydrate on
 *   any gap.
 * - Reconnects with capped, jittered backoff. Reconnection never
 *   mutates: no auto-retry of runs, no replayed commands, and the SAME
 *   session is always resumed — a replacement session is never created
 *   to paper over a connection failure.
 * - Translates the fixed bridge command set into typed Gateway calls;
 *   client request IDs double as Gateway idempotency keys.
 */

import type { GatewayEvent } from "@cline/shared/gateway";
import { createEventCursor, encodeEventCursor } from "@cline/shared/gateway";
import type { BridgeCommand } from "../../shared/bridge";
import {
	desktopError,
	type PublicDesktopError,
	toPublicDesktopError,
} from "../../shared/errors";
import type { DesktopProjection } from "../../shared/projection";
import { MANAGED_WORKSPACE_PROJECTION_ID } from "../../shared/projection";
import type { Logger } from "../logging";
import type { GatewayPort, GatewayPortFactory } from "./port";
import {
	addApproval,
	addNotice,
	applyGatewayEvent,
	applySnapshot,
	createReducerContext,
	hydrate,
	type ReducerContext,
	removeApproval,
	setConnection,
	takeDirtyKeys,
} from "./reducer";
import type { DesktopStateStore } from "./state-store";

/** Reconnect backoff per the spec: 250ms → 10s cap, with jitter. */
export const RECONNECT_BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000] as const;
export const RECONNECT_BACKOFF_CAP_MS = 10_000;

/** Replays larger than this abandon incremental recovery (full rebuild). */
const MAX_INCREMENTAL_REPLAY_EVENTS = 5_000;

const COMMAND_CACHE_LIMIT = 500;

export function backoffDelayMs(
	attempt: number,
	jitterRatio: number,
	random: () => number = Math.random,
): number {
	const base =
		attempt < RECONNECT_BACKOFF_MS.length
			? RECONNECT_BACKOFF_MS[attempt]
			: RECONNECT_BACKOFF_CAP_MS;
	if (jitterRatio <= 0) {
		return base;
	}
	const jitter = 1 + jitterRatio * (random() * 2 - 1);
	return Math.max(0, Math.round(base * jitter));
}

export type ProjectionFrame =
	| { kind: "replace"; projection: DesktopProjection }
	| {
			kind: "patch";
			baseRevision: number;
			revision: number;
			patch: Partial<DesktopProjection>;
	  };

export type ProjectionListener = (frame: ProjectionFrame) => void;

export interface DesktopBrokerOptions {
	connectPort: GatewayPortFactory;
	stateStore: DesktopStateStore;
	logger: Logger;
	clock?: () => number;
	/** 0 disables jitter (deterministic tests). Default 0.2 (±20%). */
	jitterRatio?: number;
	/** Native capability: reveal the diagnostics folder. */
	revealDiagnostics?: () => void | Promise<void>;
	/** Test hook: scheduler for reconnect timers. */
	setTimer?: (fn: () => void, ms: number) => unknown;
}

export class DesktopBroker {
	private readonly options: DesktopBrokerOptions;
	private context: ReducerContext;
	private port: GatewayPort | undefined;
	private stopped = false;
	private connectInFlight = false;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly listeners = new Set<ProjectionListener>();
	private lastEmittedRevision = 0;
	private flushScheduled = false;
	private readonly pendingApprovals = new Map<
		string,
		(resolution: unknown) => void
	>();
	private readonly commandCache = new Map<string, Promise<unknown>>();
	private persistTimer: ReturnType<typeof setTimeout> | undefined;
	private snapshotRefreshTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(options: DesktopBrokerOptions) {
		this.options = options;
		this.context = createReducerContext(options.clock);
		this.context.projection.diagnostics.revealAvailable = Boolean(
			options.revealDiagnostics,
		);
	}

	// -------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------

	async start(): Promise<void> {
		setConnection(this.context, { state: "connecting" });
		this.flush();
		await this.attemptConnect();
	}

	/** Closing the broker NEVER interrupts a run (server invariant). */
	stop(): void {
		this.stopped = true;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		if (this.snapshotRefreshTimer) {
			clearTimeout(this.snapshotRefreshTimer);
			this.snapshotRefreshTimer = undefined;
		}
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistNow();
		}
		this.port?.close();
		this.port = undefined;
	}

	get projectionSnapshot(): DesktopProjection {
		return structuredClone(this.context.projection);
	}

	get connectionState(): DesktopProjection["connection"]["state"] {
		return this.context.projection.connection.state;
	}

	onProjection(listener: ProjectionListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	// -------------------------------------------------------------------
	// Connection management
	// -------------------------------------------------------------------

	private async attemptConnect(): Promise<void> {
		if (this.stopped || this.connectInFlight || this.port) {
			return;
		}
		this.connectInFlight = true;
		try {
			const persisted = this.options.stateStore.current;
			const port = await this.options.connectPort({
				clientId: persisted.clientId,
			});
			if (this.stopped) {
				port.close();
				return;
			}
			this.port = port;

			// Same gatewayId resumes; a different Gateway identity means the
			// event log and every ID space changed: rebuild from scratch.
			if (persisted.gatewayId && persisted.gatewayId !== port.hello.gatewayId) {
				this.options.logger.warn("gateway.identityChanged", {
					previous: persisted.gatewayId,
					current: port.hello.gatewayId,
				});
				this.options.stateStore.reset();
				const fresh = createReducerContext(this.options.clock);
				fresh.projection.diagnostics.revealAvailable =
					this.context.projection.diagnostics.revealAvailable;
				this.context = fresh;
			}
			this.options.stateStore.save({
				gatewayId: port.hello.gatewayId,
				clientId: port.hello.clientId,
			});

			port.onEvent((event) => this.handleEvent(event));
			port.onServerRequest((request) => {
				addApproval(this.context, request);
				this.flush();
				this.options.logger.info("approval.received", {
					requestId: request.id,
					method: request.method,
				});
				return new Promise((resolve) => {
					this.pendingApprovals.set(request.id, resolve);
				});
			});
			port.onClose(() => this.handleDisconnect());

			await this.hydrateAndSubscribe(port);
			this.reconnectAttempt = 0;
			this.options.logger.info("gateway.connected", {
				gatewayId: port.hello.gatewayId,
				instanceId: port.hello.instanceId,
			});
			this.flush();
		} catch (error) {
			const publicError = toPublicDesktopError(error);
			this.port?.close();
			this.port = undefined;
			if (publicError.code === "protocol_version_unsupported") {
				// Incompatible protocol is a terminal, visible state — no
				// silent retry loop; the user must update client or Gateway.
				setConnection(this.context, {
					state: "incompatible",
					lastError: publicError,
				});
				this.flush();
				this.options.logger.error("gateway.incompatible", {
					error: publicError,
				});
				return;
			}
			setConnection(this.context, {
				state: this.reconnectAttempt > 0 ? "reconnecting" : "unavailable",
				lastError: publicError,
				reconnectAttempt: this.reconnectAttempt,
			});
			this.flush();
			this.scheduleReconnect();
		} finally {
			this.connectInFlight = false;
		}
	}

	private handleDisconnect(): void {
		if (this.stopped) {
			return;
		}
		this.port = undefined;
		// Pending approvals belong to the dead connection; the Gateway will
		// re-issue anything still unanswered when we resubscribe.
		this.pendingApprovals.clear();
		setConnection(this.context, {
			state: "reconnecting",
			reconnectAttempt: this.reconnectAttempt,
		});
		addNotice(this.context, "Connection to the Gateway was lost");
		this.flush();
		this.options.logger.warn("gateway.disconnected", {});
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		if (this.stopped || this.reconnectTimer || this.port) {
			return;
		}
		const delay = backoffDelayMs(
			this.reconnectAttempt,
			this.options.jitterRatio ?? 0.2,
		);
		this.reconnectAttempt += 1;
		const setTimer = this.options.setTimer ?? setTimeout;
		this.reconnectTimer = setTimer(() => {
			this.reconnectTimer = undefined;
			void this.attemptConnect();
		}, delay) as ReturnType<typeof setTimeout>;
	}

	/** Manual reconnect (user action): resets backoff and tries now. */
	async reconnectNow(): Promise<void> {
		if (this.port) {
			return;
		}
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = undefined;
		}
		this.reconnectAttempt = 0;
		setConnection(this.context, { state: "connecting" });
		this.flush();
		await this.attemptConnect();
	}

	private async hydrateAndSubscribe(port: GatewayPort): Promise<void> {
		const status = await port.getStatus();
		const lastEventSequence =
			typeof status.counts?.lastEventSequence === "number"
				? status.counts.lastEventSequence
				: 0;
		const persistedCursor = this.options.stateStore.current.cursorSequence;
		// Resume from the persisted cursor when the replay is affordable;
		// otherwise rebuild wholesale from snapshots (cursor jumps ahead).
		const cursorBasis =
			persistedCursor >= 0 &&
			lastEventSequence - persistedCursor <= MAX_INCREMENTAL_REPLAY_EVENTS
				? persistedCursor
				: lastEventSequence;

		const [bots, sessions, pendingRuns, connectors, schedules] =
			await Promise.all([
				port.listBots(),
				port.listSessions(),
				port.listRuns(),
				port.listConnectors(),
				port.listSchedules(),
			]);
		const scheduleJobs = await this.collectScheduleJobs(
			port,
			schedules.schedules,
		);

		let snapshot: Awaited<ReturnType<GatewayPort["getSession"]>> | undefined;
		let selectedSessionId =
			this.options.stateStore.current.selectedSessionId ??
			this.context.projection.selectedSessionId;
		if (
			selectedSessionId &&
			!sessions.sessions.some(
				(session) => session.sessionId === selectedSessionId,
			)
		) {
			selectedSessionId = undefined;
		}
		if (!selectedSessionId) {
			// Nothing selected: follow the selected (or default lead) bot's
			// active session so a relaunch lands back in the conversation.
			const focusBotId =
				this.options.stateStore.current.selectedBotId ??
				this.context.projection.selectedBotId ??
				(typeof status.defaultBotId === "string"
					? status.defaultBotId
					: undefined);
			selectedSessionId = sessions.sessions.find(
				(session) => session.botId === focusBotId && session.state === "active",
			)?.sessionId;
		}
		if (selectedSessionId) {
			snapshot = await port.getSession({ sessionId: selectedSessionId });
		}

		const persistedSelections = this.options.stateStore.current;
		if (persistedSelections.selectedBotId) {
			this.context.projection.selectedBotId = persistedSelections.selectedBotId;
		}
		if (persistedSelections.selectedWorkspaceId) {
			this.context.projection.selectedWorkspaceId =
				persistedSelections.selectedWorkspaceId;
		}

		hydrate(this.context, {
			hello: {
				gatewayId: port.hello.gatewayId,
				instanceId: port.hello.instanceId,
				protocolVersion: port.hello.protocolVersion,
			},
			status,
			bots: bots.bots,
			sessions: sessions.sessions,
			pendingRuns: pendingRuns.runs,
			connectors: connectors.connectors,
			schedules: schedules.schedules,
			scheduleJobs,
			snapshot,
			cursorBasis,
		});
		this.schedulePersist();

		await port.subscribe({
			cursor: encodeEventCursor(createEventCursor(cursorBasis)),
		});
	}

	/** Recent job reports per schedule (bounded read-only diagnostics). */
	private async collectScheduleJobs(
		port: GatewayPort,
		schedules: readonly { scheduleId: string }[],
	): Promise<Map<string, Awaited<ReturnType<GatewayPort["scheduleReport"]>>["jobs"]>> {
		const jobs = new Map<
			string,
			Awaited<ReturnType<GatewayPort["scheduleReport"]>>["jobs"]
		>();
		for (const schedule of schedules.slice(0, 20)) {
			try {
				const report = await port.scheduleReport({
					scheduleId: schedule.scheduleId,
				});
				jobs.set(schedule.scheduleId, report.jobs);
			} catch {
				// Diagnostics only: a failed report never blocks hydration.
			}
		}
		return jobs;
	}

	/**
	 * Refresh the active-session snapshot (debounced). Used when runs are
	 * admitted by OTHER actors (second clients, connectors, schedules):
	 * their lifecycle events carry no prompt or provenance, so the
	 * snapshot supplies both.
	 */
	private scheduleSnapshotRefresh(): void {
		if (this.snapshotRefreshTimer) {
			return;
		}
		this.snapshotRefreshTimer = setTimeout(() => {
			this.snapshotRefreshTimer = undefined;
			void this.refreshActiveSessionSnapshot();
		}, 150);
	}

	private async refreshActiveSessionSnapshot(): Promise<void> {
		const port = this.port;
		const sessionId = this.context.projection.activeSession?.sessionId;
		if (!port || !sessionId) {
			return;
		}
		try {
			const snapshot = await port.getSession({ sessionId });
			applySnapshot(this.context, snapshot);
			this.flush();
		} catch (error) {
			this.options.logger.warn("snapshot.refresh.failed", {
				error: toPublicDesktopError(error),
			});
		}
	}

	private handleEvent(event: GatewayEvent): void {
		const result = applyGatewayEvent(this.context, event);
		if (result.outcome === "gap") {
			this.options.logger.warn("events.gap", {
				expected: this.context.cursorSequence + 1,
				received: event.sequence,
			});
			// Contiguity broken: drop the connection and rebuild from
			// snapshots. A fresh connection avoids double subscriptions.
			const port = this.port;
			this.port = undefined;
			port?.close();
			return;
		}
		if (result.outcome !== "applied") {
			return;
		}
		if (
			event.event === "approval.resolved" &&
			typeof event.payload?.requestId === "string"
		) {
			// Some other client answered first; settle the dangling handler
			// (the Gateway ignores late responses for resolved requests).
			const pending = this.pendingApprovals.get(event.payload.requestId);
			if (pending) {
				this.pendingApprovals.delete(event.payload.requestId);
				pending({ approved: false, reason: "resolved by another client" });
			}
		}
		if (
			event.event === "run.queued" &&
			event.scope.runId &&
			event.scope.sessionId ===
				this.context.projection.activeSession?.sessionId &&
			!this.context.promptPreviews.has(event.scope.runId)
		) {
			// A run admitted by another actor (second client, connector, or
			// schedule): fetch the snapshot for its prompt and provenance.
			this.scheduleSnapshotRefresh();
		}
		this.schedulePersist();
		this.flush();
	}

	// -------------------------------------------------------------------
	// Bridge commands (closed set)
	// -------------------------------------------------------------------

	async execute(command: BridgeCommand): Promise<unknown> {
		const requestId = (command as { clientRequestId?: string }).clientRequestId;
		if (requestId) {
			const cached = this.commandCache.get(requestId);
			if (cached) {
				return cached;
			}
			const promise = this.executeUncached(command);
			this.commandCache.set(requestId, promise);
			if (this.commandCache.size > COMMAND_CACHE_LIMIT) {
				const oldest = this.commandCache.keys().next().value;
				if (oldest !== undefined) {
					this.commandCache.delete(oldest);
				}
			}
			// A rejected command may be retried with a fresh request ID; keep
			// the rejection cached so the SAME ID never re-executes.
			return promise;
		}
		return this.executeUncached(command);
	}

	private async executeUncached(command: BridgeCommand): Promise<unknown> {
		switch (command.command) {
			case "app.initialize":
				return { initialized: true };
			case "gateway.reconnect": {
				if (this.connectionState === "connected") {
					return { alreadyConnected: true };
				}
				await this.reconnectNow();
				return { state: this.connectionState };
			}
			case "bot.select": {
				const bot = this.context.projection.bots.find(
					(entry) => entry.botId === command.botId,
				);
				if (!bot) {
					throw desktopError("not_found", `Unknown bot: ${command.botId}`);
				}
				this.context.projection.selectedBotId = command.botId;
				this.commitSelections("selectedBotId");
				return { selectedBotId: command.botId };
			}
			case "workspace.select": {
				const workspace = this.context.projection.workspaces.find(
					(entry) => entry.workspaceId === command.workspaceId,
				);
				if (!workspace) {
					throw desktopError(
						"not_found",
						`Unknown workspace: ${command.workspaceId}`,
						{ action: "choose_workspace" },
					);
				}
				this.context.projection.selectedWorkspaceId = command.workspaceId;
				this.commitSelections("selectedWorkspaceId");
				return { selectedWorkspaceId: command.workspaceId };
			}
			case "session.select":
				return this.selectSession(command.sessionId);
			case "run.start":
				return this.startRun(command);
			case "run.steer": {
				const port = this.requirePort();
				try {
					return await port.steerRun({
						runId: command.runId,
						text: command.text,
						idempotencyKey: command.clientRequestId,
					});
				} catch (error) {
					throw toPublicDesktopError(error);
				}
			}
			case "run.interrupt": {
				const port = this.requirePort();
				try {
					return await port.interruptRun({
						runId: command.runId,
						...(command.reason ? { reason: command.reason } : {}),
						idempotencyKey: command.clientRequestId,
					});
				} catch (error) {
					throw toPublicDesktopError(error);
				}
			}
			case "run.retry": {
				const port = this.requirePort();
				try {
					return await port.retryRun({
						runId: command.runId,
						idempotencyKey: command.clientRequestId,
					});
				} catch (error) {
					throw toPublicDesktopError(error);
				}
			}
			case "approval.resolve":
				return this.resolveApproval(command);
			case "diagnostics.reveal": {
				const reveal = this.options.revealDiagnostics;
				if (!reveal) {
					throw desktopError(
						"diagnostics_unavailable",
						"Revealing the diagnostics folder is not available here",
					);
				}
				await reveal();
				return { revealed: true };
			}
			default: {
				// The schema already rejects unknown commands; this is the
				// compile-time exhaustiveness backstop.
				const never: never = command;
				throw desktopError(
					"invalid_command",
					`Unhandled command ${String(never)}`,
				);
			}
		}
	}

	private async selectSession(sessionId: string | undefined): Promise<unknown> {
		if (!sessionId) {
			this.context.projection.selectedSessionId = undefined;
			this.context.projection.activeSession = undefined;
			this.commitSelections("selectedSessionId", "activeSession");
			return { selectedSessionId: null };
		}
		if (
			!this.context.projection.sessions.some(
				(session) => session.sessionId === sessionId,
			)
		) {
			throw desktopError("not_found", `Unknown session: ${sessionId}`);
		}
		const port = this.requirePort();
		try {
			const snapshot = await port.getSession({ sessionId });
			applySnapshot(this.context, snapshot);
		} catch (error) {
			throw toPublicDesktopError(error);
		}
		this.commitSelections("selectedSessionId", "activeSession");
		return { selectedSessionId: sessionId };
	}

	private async startRun(command: {
		clientRequestId: string;
		botId: string;
		sessionId?: string;
		workspaceId?: string;
		prompt: string;
	}): Promise<unknown> {
		const port = this.requirePort();
		const projection = this.context.projection;
		const activeSessionOfBot = projection.sessions.find(
			(session) =>
				session.botId === command.botId && session.state === "active",
		);
		if (command.sessionId) {
			if (
				!activeSessionOfBot ||
				activeSessionOfBot.sessionId !== command.sessionId
			) {
				throw desktopError(
					"session_mismatch",
					"The requested session is not this bot's active session",
				);
			}
		}
		const workspaceId = command.workspaceId ?? projection.selectedWorkspaceId;
		let workspaceRoot: string | undefined;
		if (activeSessionOfBot) {
			// The session workspace is immutable; an explicit conflicting
			// choice is a user error, not something to forward and fail.
			if (
				command.workspaceId &&
				command.workspaceId !== activeSessionOfBot.workspaceId
			) {
				throw desktopError(
					"workspace_immutable",
					"This session's workspace is immutable; new turns reuse it",
					{ action: "choose_workspace" },
				);
			}
		} else if (workspaceId && workspaceId !== MANAGED_WORKSPACE_PROJECTION_ID) {
			const path = this.context.workspacePathById.get(workspaceId);
			if (!path) {
				throw desktopError("not_found", `Unknown workspace: ${workspaceId}`, {
					action: "choose_workspace",
				});
			}
			workspaceRoot = path;
		}
		try {
			const accepted = await port.startRun({
				botId: command.botId,
				prompt: command.prompt,
				...(workspaceRoot ? { workspaceRoot } : {}),
				idempotencyKey: command.clientRequestId,
			});
			this.context.promptPreviews.set(
				accepted.runId,
				command.prompt.length > 280
					? `${command.prompt.slice(0, 280)}…`
					: command.prompt,
			);
			this.options.logger.info("run.accepted", {
				runId: accepted.runId,
				queuePosition: accepted.queuePosition,
			});
			// Follow the session the run landed in (lazy creation means the
			// session may not exist in the projection until events arrive).
			void this.followRunSession(port, command.botId);
			return accepted;
		} catch (error) {
			throw toPublicDesktopError(error);
		}
	}

	/** After an accepted run, select the bot's active session. */
	private async followRunSession(
		port: GatewayPort,
		botId: string,
	): Promise<void> {
		try {
			const { sessions } = await port.listSessions({ botId });
			const active = sessions.find((session) => session.state === "active");
			if (!active) {
				return;
			}
			const snapshot = await port.getSession({
				sessionId: active.sessionId,
			});
			// Refresh the summary list too (a brand-new session may not have
			// produced its event yet when this snapshot returns).
			const all = await port.listSessions();
			const pending = await port.listRuns();
			const connectors = await port.listConnectors();
			const schedules = await port.listSchedules();
			hydrate(this.context, {
				hello: {
					gatewayId: port.hello.gatewayId,
					instanceId: port.hello.instanceId,
					protocolVersion: port.hello.protocolVersion,
				},
				status: await port.getStatus(),
				bots: (await port.listBots()).bots,
				sessions: all.sessions,
				pendingRuns: pending.runs,
				connectors: connectors.connectors,
				schedules: schedules.schedules,
				scheduleJobs: await this.collectScheduleJobs(
					port,
					schedules.schedules,
				),
				snapshot,
				cursorBasis: this.context.cursorSequence,
			});
			this.commitSelections("sessions", "activeSession", "selectedSessionId");
		} catch (error) {
			this.options.logger.warn("run.followSession.failed", {
				error: toPublicDesktopError(error),
			});
		}
	}

	private async resolveApproval(command: {
		clientRequestId: string;
		requestId: string;
		approved: boolean;
		reason?: string;
	}): Promise<unknown> {
		const pending = this.pendingApprovals.get(command.requestId);
		const listed = this.context.projection.approvals.some(
			(approval) => approval.requestId === command.requestId,
		);
		if (!pending || !listed) {
			throw desktopError(
				"approval_already_resolved",
				"This approval was already answered (first answer wins)",
			);
		}
		this.pendingApprovals.delete(command.requestId);
		pending({
			approved: command.approved,
			...(command.reason ? { reason: command.reason } : {}),
		});
		removeApproval(this.context, command.requestId);
		this.flush();
		this.options.logger.info("approval.answered", {
			requestId: command.requestId,
			approved: command.approved,
		});
		return { resolved: true, approved: command.approved };
	}

	// -------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------

	private requirePort(): GatewayPort {
		if (!this.port) {
			throw desktopError(
				"gateway_unreachable",
				"The Gateway is not connected; start it and reconnect",
				{ retryable: true, action: "start_gateway" },
			);
		}
		return this.port;
	}

	private commitSelections(...keys: (keyof DesktopProjection)[]): void {
		this.context.projection.revision += 1;
		this.context.projection.generatedAt = (this.options.clock ?? Date.now)();
		for (const key of keys) {
			this.context.dirtyKeys.add(key);
		}
		this.context.dirtyKeys.add("revision");
		this.context.dirtyKeys.add("generatedAt");
		this.schedulePersist();
		this.flush();
	}

	private schedulePersist(): void {
		if (this.persistTimer) {
			return;
		}
		this.persistTimer = setTimeout(() => {
			this.persistTimer = undefined;
			this.persistNow();
		}, 250);
	}

	/** Cursor persists only AFTER events were committed locally. */
	private persistNow(): void {
		const projection = this.context.projection;
		this.options.stateStore.save({
			cursorSequence: this.context.cursorSequence,
			...(projection.selectedBotId
				? { selectedBotId: projection.selectedBotId }
				: {}),
			...(projection.selectedSessionId
				? { selectedSessionId: projection.selectedSessionId }
				: {}),
			...(projection.selectedWorkspaceId
				? { selectedWorkspaceId: projection.selectedWorkspaceId }
				: {}),
		});
	}

	private flush(): void {
		if (this.flushScheduled) {
			return;
		}
		this.flushScheduled = true;
		queueMicrotask(() => {
			this.flushScheduled = false;
			const keys = takeDirtyKeys(this.context);
			if (keys.length === 0) {
				return;
			}
			const projection = this.context.projection;
			const patch: Record<string, unknown> = {};
			for (const key of keys) {
				patch[key] = structuredClone(projection[key]);
			}
			const frame: ProjectionFrame = {
				kind: "patch",
				baseRevision: this.lastEmittedRevision,
				revision: projection.revision,
				patch: patch as Partial<DesktopProjection>,
			};
			this.lastEmittedRevision = projection.revision;
			for (const listener of this.listeners) {
				listener(frame);
			}
		});
	}
}

export type { PublicDesktopError };
