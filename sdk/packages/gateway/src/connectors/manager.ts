/**
 * Connector supervision (Gateway RFC, Phase 6).
 *
 * The Gateway supplies what `@cline/bot`'s connector semantics leave as
 * ports: durable routes, run admission into the shared FIFO queue,
 * credential loading from owner-only files, and worker supervision —
 * exactly one worker per connector instance, enforced twice: in-memory
 * for this process and through the durable instance registry across
 * restarts (a stale claim is taken over; a live one is respected, so a
 * duplicate instance is never created).
 *
 * A crashed adapter worker restarts with backoff from its dedupe cursor.
 * Because the cursor commits in the same transaction as the admission it
 * caused, the restart can neither skip nor duplicate messages.
 */

import type {
	ConnectorDescriptor,
	ConnectorReplyPort,
	ConnectorRunAdmission,
	NormalizedConnectorMessage,
} from "@cline/bot";
import { ConnectorInbox } from "@cline/bot";
import type { ConnectorId, WorkerId } from "@cline/shared/gateway";
import { createWorkerId } from "@cline/shared/gateway";
import type { GatewayDatabase } from "../db";
import type { GatewayStores } from "../stores";
import type { ConnectorAdapter } from "./adapter";
import type { ConnectorRecord } from "./store";

export interface ConnectorManagerOptions {
	database: GatewayDatabase;
	stores: GatewayStores;
	/** Admission into the bot's canonical session (runtime-backed). */
	admission: ConnectorRunAdmission;
	adapters: Record<string, ConnectorAdapter>;
	/** Resolve a credentialRef to its secret value (0600 file read). */
	readCredential?: (credentialRef: string) => string | undefined;
	gatewayInstanceId: string;
	clock?: () => number;
	restartBackoffMs?: number;
	/** A foreign instance claim older than this is considered dead. */
	instanceStaleMs?: number;
	heartbeatIntervalMs?: number;
	telemetry?: (event: Record<string, unknown>) => void;
}

interface RunningConnector {
	readonly connectorId: ConnectorId;
	readonly workerId: WorkerId;
	readonly controller: AbortController;
	restarts: number;
	state: "running" | "stopped";
	heartbeatTimer?: ReturnType<typeof setInterval>;
}

export class ConnectorManager {
	private readonly options: ConnectorManagerOptions;
	private readonly clock: () => number;
	private readonly telemetry: (event: Record<string, unknown>) => void;
	private readonly running = new Map<ConnectorId, RunningConnector>();
	private stopped = false;

	constructor(options: ConnectorManagerOptions) {
		this.options = options;
		this.clock = options.clock ?? (() => Date.now());
		this.telemetry = options.telemetry ?? (() => {});
	}

	/** Start every enabled connector (idempotent per connector). */
	startAll(): void {
		for (const record of this.options.stores.connectors.listEnabled()) {
			this.start(record.connectorId);
		}
	}

	/**
	 * Start one connector worker. Returns false when another live
	 * instance already owns the connector (never a duplicate).
	 */
	start(connectorId: ConnectorId): boolean {
		if (this.stopped) {
			return false;
		}
		if (this.running.has(connectorId)) {
			// One worker per connector instance inside this process too.
			return false;
		}
		const record = this.options.stores.connectors.get(connectorId);
		if (!record || record.status !== "enabled") {
			return false;
		}
		const adapter = this.options.adapters[record.kind];
		if (!adapter) {
			this.telemetry({
				kind: "connector.adapterMissing",
				connectorId,
				adapterKind: record.kind,
			});
			return false;
		}
		const workerId = createWorkerId();
		const claimed = this.options.stores.connectorInstances.claim(
			connectorId,
			workerId,
			this.options.gatewayInstanceId,
			this.clock(),
			this.options.instanceStaleMs ?? 30_000,
		);
		if (!claimed) {
			this.telemetry({
				kind: "connector.instanceClaimRefused",
				connectorId,
			});
			return false;
		}
		const controller = new AbortController();
		const running: RunningConnector = {
			connectorId,
			workerId,
			controller,
			restarts: 0,
			state: "running",
		};
		this.running.set(connectorId, running);
		const heartbeatIntervalMs = this.options.heartbeatIntervalMs ?? 5_000;
		if (heartbeatIntervalMs > 0) {
			running.heartbeatTimer = setInterval(() => {
				this.options.stores.connectorInstances.heartbeat(
					connectorId,
					workerId,
					this.clock(),
				);
			}, heartbeatIntervalMs);
			running.heartbeatTimer.unref?.();
		}
		void this.supervise(running, record, adapter);
		return true;
	}

	/** The authorized reply capability for a connector's bot side. */
	replyPortFor(connectorId: ConnectorId): ConnectorReplyPort {
		const record = this.options.stores.connectors.get(connectorId);
		if (!record) {
			throw new Error(`Unknown connector: ${connectorId}`);
		}
		const adapter = this.options.adapters[record.kind];
		if (!adapter) {
			throw new Error(`No adapter for connector kind "${record.kind}"`);
		}
		return adapter.createReplyPort(record.config, this.credentialFor(record));
	}

	status(): Record<string, unknown> {
		return {
			running: [...this.running.values()].map((entry) => ({
				connectorId: entry.connectorId,
				workerId: entry.workerId,
				restarts: entry.restarts,
				state: entry.state,
			})),
		};
	}

	async stop(): Promise<void> {
		this.stopped = true;
		for (const running of this.running.values()) {
			this.halt(running);
		}
		this.running.clear();
	}

	stopConnector(connectorId: ConnectorId): void {
		const running = this.running.get(connectorId);
		if (running) {
			this.halt(running);
			this.running.delete(connectorId);
		}
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private halt(running: RunningConnector): void {
		running.state = "stopped";
		running.controller.abort();
		if (running.heartbeatTimer) {
			clearInterval(running.heartbeatTimer);
		}
		this.options.stores.connectorInstances.release(
			running.connectorId,
			running.workerId,
		);
	}

	private credentialFor(record: ConnectorRecord): string | undefined {
		if (!record.credentialRef) {
			return undefined;
		}
		return this.options.readCredential?.(record.credentialRef);
	}

	private async supervise(
		running: RunningConnector,
		record: ConnectorRecord,
		adapter: ConnectorAdapter,
	): Promise<void> {
		const descriptor: ConnectorDescriptor = {
			connectorId: record.connectorId,
			botId: record.botId,
			kind: record.kind,
			name: record.name,
		};
		const inbox = new ConnectorInbox(descriptor, {
			routes: this.options.stores.connectorRoutes,
			admission: this.options.admission,
			clock: { now: () => this.clock() },
		});
		const backoffMs = this.options.restartBackoffMs ?? 1_000;
		while (running.state === "running" && !running.controller.signal.aborted) {
			try {
				await adapter.run({
					descriptor,
					config: record.config,
					credential: this.credentialFor(record),
					signal: running.controller.signal,
					cursor: () =>
						this.options.stores.connectorCursors.get(record.connectorId),
					deliver: (message, nextCursor) =>
						this.deliver(descriptor, inbox, message, nextCursor),
					commitCursor: (nextCursor) => {
						this.options.database.transaction(() => {
							this.options.stores.connectorCursors.set(
								record.connectorId,
								nextCursor,
								this.clock(),
							);
						});
					},
					log: (entry) =>
						this.telemetry({ ...entry, connectorId: record.connectorId }),
				});
				// A clean return only happens when the signal aborted.
				return;
			} catch (error) {
				if (running.controller.signal.aborted) {
					return;
				}
				running.restarts += 1;
				this.telemetry({
					kind: "connector.workerCrashed",
					connectorId: record.connectorId,
					restarts: running.restarts,
					error: error instanceof Error ? error.message : String(error),
				});
				this.options.stores.audit.record(
					"gateway",
					"connector.workerCrashed",
					record.connectorId,
					{ restarts: running.restarts },
					this.clock(),
				);
				await sleep(backoffMs, running.controller.signal);
			}
		}
	}

	/**
	 * Admission and cursor advance in one transaction: a crash can only
	 * happen before both committed (message re-delivered, no run exists)
	 * or after both committed (cursor skips it) — never in between.
	 */
	private deliver(
		descriptor: ConnectorDescriptor,
		inbox: ConnectorInbox,
		message: NormalizedConnectorMessage,
		nextCursor: string,
	): void {
		this.options.database.transaction(() => {
			const result = inbox.handleMessage(message);
			this.options.stores.connectorCursors.set(
				descriptor.connectorId,
				nextCursor,
				this.clock(),
			);
			this.options.stores.events.append(
				"connector.messageAdmitted",
				{
					botId: descriptor.botId,
					sessionId: result.accepted.sessionId,
					runId: result.accepted.runId,
				},
				{
					connectorId: descriptor.connectorId,
					externalConversationId: message.externalConversationId,
					externalMessageId: message.externalMessageId,
					routeCreated: result.routeCreated,
				},
				this.clock(),
			);
		});
	}
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, ms);
		timer.unref?.();
		function done() {
			signal.removeEventListener("abort", done);
			clearTimeout(timer);
			resolve();
		}
		signal.addEventListener("abort", done);
	});
}
