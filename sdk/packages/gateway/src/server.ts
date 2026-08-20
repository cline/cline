/**
 * Gateway server (Gateway RFC, Phase 3).
 *
 * One process, one authority: acquire the OS-backed exclusive lock,
 * migrate the SQLite authority, recover committed state, bind the
 * loopback socket exclusively, and only then publish the mode-0600
 * discovery record. A process that cannot take the lock never kills the
 * holder and never picks another port — it connects or diagnoses.
 *
 * Transport: newline-delimited JSON over loopback TCP. Every connection
 * opens with `gateway.hello` carrying the per-instance secret from the
 * discovery record. Events are pushed from the durable log through
 * per-subscription cursors — bounded pages with socket backpressure, so
 * a slow client never grows an unbounded in-memory projection and a
 * reconnecting client resumes exactly from its cursor.
 */

import { timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { basename, dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import type { EnginePort } from "@cline/bot";
import type {
	BotId,
	ClientId,
	ConnectorId,
	EventCursor,
	GatewayEventScope,
	GatewayInstanceId,
	GatewayRequest,
	GatewayResponse,
	GatewayServerRequest,
	IdempotencyKey,
	RunId,
	ScheduleId,
	SessionId,
} from "@cline/shared/gateway";
import {
	createGatewayError,
	createGatewayInstanceId,
	decodeEventCursor,
	GATEWAY_HELLO_METHOD,
	GATEWAY_PROTOCOL_VERSION,
	type GatewayError,
	GatewayServerResponseSchema,
	IDEMPOTENCY_KEY_PARAM,
} from "@cline/shared/gateway";
import type { ConnectorAdapter } from "./connectors/adapter";
import { OutboundDeliveryWorker } from "./connectors/delivery";
import { ConnectorManager } from "./connectors/manager";
import { ConnectorMessenger } from "./connectors/messenger";
import { SlackConnectorAdapter } from "./connectors/slack";
import { TelegramConnectorAdapter } from "./connectors/telegram";
import { createSendConnectorMessageTool } from "./connectors/tool";
import { type GatewayDatabase, openGatewayDatabase } from "./db";
import {
	createInstanceAuthToken,
	type DiscoveryRecord,
	removeDiscoveryRecord,
	writeDiscoveryRecord,
} from "./discovery";
import { resolveProviderModelSelection } from "./engine-binding";
import { negotiateHello, SUPPORTED_PROTOCOL_VERSIONS } from "./hello";
import type { ResolvedLeadProfile } from "./lead-profiles";
import { GatewayLock } from "./lock";
import { validateGatewayRequest } from "./methods";
import {
	createFileProjector,
	type OutboxProjector,
	OutboxWorker,
	type OutboxWorkerOptions,
} from "./outbox";
import {
	ensureGatewayDataDir,
	type GatewayPaths,
	type GatewayPathsOptions,
	resolveGatewayPaths,
} from "./paths";
import { PluginCatalog, type PluginSource } from "./plugins/catalog";
import {
	type GatewayRemoteAddress,
	GatewayRemoteListener,
	type GatewayRemoteOptions,
} from "./remote";
import {
	GatewayCallError,
	GatewayRuntime,
	type GatewayRuntimeOptions,
	toGatewayError,
} from "./runtime";
import { Scheduler } from "./schedules/scheduler";
import { readSecretFile } from "./secrets";
import { createGatewayStores, type GatewayStores } from "./stores";
import { ToolCatalog } from "./tools/catalog";
import { ToolConfigurationStore } from "./tools/store";
import { GatewayToolSystem } from "./tools/system";
import type { PriceResolver } from "./usage";

const MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_WORKSPACE_UPLOAD_BYTES = 5 * 1024 * 1024;
const EVENT_PAGE_SIZE = 100;

export interface GatewayServerOptions extends GatewayPathsOptions {
	/** Loopback only; the Gateway never listens on external interfaces. */
	host?: string;
	/** 0 (default) binds an ephemeral port; the port is never identity. */
	port?: number;
	/** Inner execution port (real engine binding or a test double). */
	engine: EnginePort;
	clock?: GatewayRuntimeOptions["clock"];
	retry?: GatewayRuntimeOptions["retry"];
	maxPendingRunsPerSession?: number;
	projector?: OutboxProjector;
	outbox?: OutboxWorkerOptions;
	/** Price snapshots for providers that do not report costs. */
	usagePrices?: PriceResolver;
	/** Graceful-stop budget before sockets are closed anyway. */
	stopTimeoutMs?: number;
	/** Phase 4: extra plugin discovery sources (global dir is implicit). */
	pluginSources?: readonly PluginSource[];
	/** Optional named configuration for the single bootstrap lead. */
	leadProfile?: ResolvedLeadProfile;
	/** Phase 4: worker/execution health surfaced in gateway.status. */
	executionHealth?: () => Record<string, unknown>;
	/** Phase 6: connector adapters (defaults: telegram + slack). */
	connectorAdapters?: Record<string, ConnectorAdapter>;
	/** Phase 6: start enabled connectors on boot (default true). */
	autoStartConnectors?: boolean;
	/** Phase 6: scheduler tick cadence (0 disables the timer). */
	schedulerTickMs?: number;
	/** Phase 6: outbound delivery tick cadence (0 disables the timer). */
	deliveryTickMs?: number;
	/** Phase 7: optional remote WebSocket listener with separate credentials. */
	remote?: GatewayRemoteOptions;
}

interface Subscription {
	scope: GatewayEventScope;
	after: number;
}

class Connection {
	readonly socket: Duplex;
	readonly expectedAuth: string;
	readonly transport: "local" | "remote";
	clientId: ClientId | undefined;
	authenticated = false;
	readonly subscriptions: Subscription[] = [];
	private buffer = "";
	private pumpChain: Promise<void> = Promise.resolve();
	private pumpRequested = false;
	private authTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor(
		socket: Duplex,
		expectedAuth: string,
		transport: "local" | "remote",
	) {
		this.socket = socket;
		this.expectedAuth = expectedAuth;
		this.transport = transport;
	}

	armAuthTimeout(timeoutMs: number): void {
		this.authTimeout = setTimeout(() => this.socket.destroy(), timeoutMs);
		this.authTimeout.unref?.();
	}

	markAuthenticated(): void {
		if (this.authTimeout) clearTimeout(this.authTimeout);
		this.authTimeout = undefined;
		this.authenticated = true;
	}

	dispose(): void {
		if (this.authTimeout) clearTimeout(this.authTimeout);
		this.authTimeout = undefined;
	}

	feed(chunk: string, onLine: (line: string) => void): void {
		this.buffer += chunk;
		if (this.buffer.length > MAX_LINE_BYTES) {
			this.socket.destroy();
			return;
		}
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line.length > 0) {
				onLine(line);
			}
		}
	}

	send(frame: unknown): void {
		if (this.socket.destroyed) {
			return;
		}
		this.socket.write(`${JSON.stringify(frame)}\n`);
	}

	/** Write with socket backpressure: resolve only once flushed/drained. */
	private writeWithBackpressure(frame: unknown): Promise<void> {
		return new Promise((resolve) => {
			if (this.socket.destroyed) {
				resolve();
				return;
			}
			const flushed = this.socket.write(`${JSON.stringify(frame)}\n`);
			if (flushed) {
				resolve();
				return;
			}
			const onDone = () => {
				this.socket.off("drain", onDone);
				this.socket.off("close", onDone);
				resolve();
			};
			this.socket.on("drain", onDone);
			this.socket.on("close", onDone);
		});
	}

	/**
	 * Deliver durable events for every subscription: paged reads from the
	 * event log, sequential per connection, coalescing repeated requests.
	 */
	schedulePump(events: GatewayStores["events"]): void {
		if (this.pumpRequested || this.socket.destroyed) {
			return;
		}
		this.pumpRequested = true;
		this.pumpChain = this.pumpChain.then(async () => {
			this.pumpRequested = false;
			for (const subscription of this.subscriptions) {
				for (;;) {
					if (this.socket.destroyed) {
						return;
					}
					const page = events.listAfter(
						subscription.after,
						subscription.scope,
						EVENT_PAGE_SIZE,
					);
					if (page.length === 0) {
						break;
					}
					for (const event of page) {
						subscription.after = event.sequence;
						await this.writeWithBackpressure(event);
					}
				}
			}
		});
	}
}

export class GatewayServer {
	readonly paths: GatewayPaths;
	readonly instanceId: GatewayInstanceId;
	readonly runtime: GatewayRuntime;
	readonly stores: GatewayStores;
	readonly outboxWorker: OutboxWorker;
	readonly plugins: PluginCatalog;
	readonly tools: GatewayToolSystem;
	readonly connectors: ConnectorManager;
	readonly scheduler: Scheduler;
	readonly messenger: ConnectorMessenger;
	readonly delivery: OutboundDeliveryWorker;
	discovery: DiscoveryRecord | undefined;

	private readonly database: GatewayDatabase;
	private readonly lock: GatewayLock;
	private readonly server: Server;
	private readonly authToken: string;
	private remoteListener: GatewayRemoteListener | undefined;
	private readonly connections = new Set<Connection>();
	private readonly stopTimeoutMs: number;
	private stopping = false;
	private unsubscribeEvents: (() => void) | undefined;
	/** Resolves when the server has fully stopped (used by gateway.stop). */
	private stopPromise: Promise<void> | undefined;
	private resolveStopped: (() => void) | undefined;
	/** Settles once the server has fully stopped (any initiator). */
	readonly whenStopped: Promise<void>;

	private constructor(options: {
		paths: GatewayPaths;
		lock: GatewayLock;
		database: GatewayDatabase;
		stores: GatewayStores;
		runtime: GatewayRuntime;
		outboxWorker: OutboxWorker;
		plugins: PluginCatalog;
		tools: GatewayToolSystem;
		connectors: ConnectorManager;
		scheduler: Scheduler;
		messenger: ConnectorMessenger;
		delivery: OutboundDeliveryWorker;
		instanceId: GatewayInstanceId;
		authToken: string;
		stopTimeoutMs: number;
	}) {
		this.paths = options.paths;
		this.lock = options.lock;
		this.database = options.database;
		this.stores = options.stores;
		this.runtime = options.runtime;
		this.outboxWorker = options.outboxWorker;
		this.plugins = options.plugins;
		this.tools = options.tools;
		this.connectors = options.connectors;
		this.scheduler = options.scheduler;
		this.messenger = options.messenger;
		this.delivery = options.delivery;
		this.instanceId = options.instanceId;
		this.authToken = options.authToken;
		this.stopTimeoutMs = options.stopTimeoutMs;
		this.server = createServer((socket) =>
			this.handleConnection(socket, this.authToken, "local"),
		);
		this.whenStopped = new Promise((resolve) => {
			this.resolveStopped = resolve;
		});
	}

	/**
	 * Become the authority for a data directory, or fail without side
	 * effects: `GatewayLockHeldError` means a live authority exists —
	 * connect to it or diagnose it, never replace it.
	 */
	static async start(options: GatewayServerOptions): Promise<GatewayServer> {
		const paths = resolveGatewayPaths(options);
		ensureGatewayDataDir(paths);

		// 1. Authority: the OS-backed exclusive lock. No lock, no server.
		const lock = GatewayLock.acquire(paths.lockFile);

		let database: GatewayDatabase | undefined;
		try {
			// 2. Durable state: open + migrate the SQLite authority.
			database = openGatewayDatabase(paths.databaseFile);
			const instanceId = createGatewayInstanceId();
			const stores = createGatewayStores(database, instanceId, {
				usage: { prices: options.usagePrices },
			});

			// Phase 4: the plugin catalog. The global source is implicit;
			// bot/workspace sources are added by the caller or per bot below.
			const plugins = new PluginCatalog({
				sources: [
					{ scope: { kind: "global" }, dir: paths.pluginsDir },
					...(options.pluginSources ?? []),
				],
				onPublish: () => {
					stores.meta.bumpCatalogGeneration();
				},
			});
			const tools = new GatewayToolSystem({
				catalog: new ToolCatalog(),
				configurations: new ToolConfigurationStore(database),
				attempts: stores.attempts,
				getBot: (botId) => stores.bots.get(botId as BotId),
				resolveModelSelection: (invocation) =>
					resolveProviderModelSelection(invocation),
				clock: () => options.clock?.now() ?? Date.now(),
			});

			let workerRef: OutboxWorker | undefined;
			const runtime = new GatewayRuntime({
				database,
				stores,
				paths,
				instanceId,
				engine: options.engine,
				clock: options.clock,
				retry: options.retry,
				maxPendingRunsPerSession: options.maxPendingRunsPerSession,
				onOutboxEnqueued: () => workerRef?.schedule(),
				plugins,
				executionHealth: options.executionHealth,
				leadConfig: options.leadProfile
					? {
							profileId: options.leadProfile.id,
							systemPrompt: options.leadProfile.systemPrompt,
						}
					: undefined,
				leadName: options.leadProfile?.name,
				prepareInvocation: (invocation, attempt) =>
					tools.prepareAttempt(invocation, attempt),
			});
			const outboxWorker = new OutboxWorker(
				stores,
				options.projector ?? createFileProjector(paths, stores),
				options.outbox,
			);
			workerRef = outboxWorker;

			// Phase 6: connector supervision over the bot-owned semantics.
			const connectors = new ConnectorManager({
				database,
				stores,
				admission: {
					submit: (botId, prompt, context) =>
						runtime.startConnectorRun({
							botId,
							prompt,
							connectorId: context.connectorId,
							externalAccountId: context.externalAccountId,
							externalConversationId: context.externalConversationId,
							sessionId: context.sessionId,
						}),
				},
				adapters: options.connectorAdapters ?? {
					telegram: new TelegramConnectorAdapter(),
					slack: new SlackConnectorAdapter(),
				},
				readCredential: (credentialRef) => readSecretFile(paths, credentialRef),
				gatewayInstanceId: instanceId,
			});

			// Phase 6: outbound delivery supervision, independent from model
			// execution. Pending deliveries resume after a restart.
			const delivery = new OutboundDeliveryWorker({
				database,
				stores,
				adapters: connectors.adapters,
				readCredential: (credentialRef) => readSecretFile(paths, credentialRef),
				instanceId,
				tickIntervalMs: options.deliveryTickMs ?? 500,
			});

			// Phase 6: the messenger — run replies, proactive sends,
			// notifications — all through one policy gate.
			const messenger = new ConnectorMessenger({
				database,
				stores,
				approvals: () => runtime.approvals,
				onEnqueued: () => {
					void delivery.tick().catch(() => {});
				},
			});
			runtime.onRunTerminal((record) => messenger.handleRunTerminal(record));

			// Phase 6: the scheduler; only this (lock-holding) instance claims.
			const scheduler = new Scheduler({
				database,
				stores,
				admitAutomationRun: (schedule) => runtime.startAutomationRun(schedule),
				notifyOutcome: (notification) => {
					if (!notification.schedule.notify) {
						return;
					}
					const prefix =
						notification.state === "completed"
							? `[schedule:${notification.schedule.name}]`
							: `[schedule:${notification.schedule.name}] FAILED:`;
					messenger.notify({
						botId: notification.schedule.botId,
						connectorId: notification.schedule.notify.connectorId,
						externalAccountId: notification.schedule.notify.externalAccountId,
						externalConversationId:
							notification.schedule.notify.externalConversationId,
						text: `${prefix} ${notification.summary}`.trim(),
						origin: "schedule",
						originScheduleId: notification.schedule.scheduleId,
						...(notification.runId
							? { originRunId: notification.runId as never }
							: {}),
						idempotencyKey: `schedule-notify:${notification.schedule.scheduleId}:${notification.jobId}:${notification.state}`,
						actor: `schedule:${notification.schedule.scheduleId}`,
					});
				},
				instanceId,
				tickIntervalMs: options.schedulerTickMs ?? 1_000,
			});

			const server = new GatewayServer({
				paths,
				lock,
				database,
				stores,
				runtime,
				outboxWorker,
				plugins,
				tools,
				connectors,
				scheduler,
				messenger,
				delivery,
				instanceId,
				authToken: createInstanceAuthToken(),
				stopTimeoutMs: options.stopTimeoutMs ?? 5_000,
			});

			// 3. Bootstrap + manual crash recovery before accepting clients.
			const lead = runtime.bootstrap();
			if (options.leadProfile?.pluginRoots.length) {
				plugins.addSource({
					scope: { kind: "bot", botId: lead.identity.botId },
					dir: dirname(options.leadProfile.pluginRoots[0]),
				});
			}
			// The lead bot's plugin dir is a standing source; reload imports
			// global + bot plugins into the first published generation.
			plugins.addSource({
				scope: { kind: "bot", botId: lead.identity.botId },
				dir: paths.botPluginsDir(lead.identity.botId),
			});
			plugins.reload();
			runtime.recover();
			outboxWorker.schedule();
			scheduler.start();
			// Resume outbound deliveries left pending by a previous process.
			delivery.start();
			if (options.autoStartConnectors ?? true) {
				connectors.startAll();
			}

			// 4. Exclusive loopback bind. Ephemeral by default: the singleton
			//    scope is the data directory, never a port.
			const host = options.host ?? "127.0.0.1";
			await new Promise<void>((resolve, reject) => {
				server.server.once("error", reject);
				server.server.listen({ host, port: options.port ?? 0 }, () => {
					server.server.off("error", reject);
					resolve();
				});
			});
			const address = server.server.address();
			if (address === null || typeof address === "string") {
				throw new Error("Gateway server bound to a non-TCP address");
			}

			// 5. Optional public transport. It has an independent credential;
			// the mode-0600 discovery secret is never valid remotely.
			if (options.remote) {
				try {
					const remoteOptions = options.remote;
					server.remoteListener = await GatewayRemoteListener.start(
						remoteOptions,
						(stream) => {
							const remoteCount = [...server.connections].filter(
								(connection) => connection.transport === "remote",
							).length;
							if (remoteCount >= (remoteOptions.maxConnections ?? 128)) {
								stream.destroy();
								return;
							}
							server.handleConnection(
								stream,
								remoteOptions.accessToken,
								"remote",
								remoteOptions.handshakeTimeoutMs ?? 10_000,
							);
						},
					);
				} catch (error) {
					await closeServer(server.server);
					throw error;
				}
			}

			// 6. Live event fan-out to subscribed connections.
			server.unsubscribeEvents = stores.events.subscribe(() => {
				for (const connection of server.connections) {
					if (connection.subscriptions.length > 0) {
						connection.schedulePump(stores.events);
					}
				}
			});

			// 6. Readiness reached: only now publish the discovery record.
			server.discovery = {
				gatewayId: stores.meta.ensureGatewayId(),
				instanceId,
				host,
				port: address.port,
				auth: server.authToken,
				pid: process.pid,
				startedAt: runtime.startedAt,
				protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
				dataDir: paths.dataDir,
				namespace: paths.namespace,
			};
			writeDiscoveryRecord(paths.discoveryFile, server.discovery);
			stores.audit.record("gateway", "gateway.started", instanceId, {
				port: address.port,
				remote: server.remoteListener?.address(),
			});

			// Route pending server requests to subscribed clients.
			runtime.approvals.deliver = (request) =>
				server.deliverServerRequest(request);

			return server;
		} catch (error) {
			database?.close();
			lock.release();
			throw error;
		}
	}

	/**
	 * Gateway-owned tools for one engine invocation (currently the
	 * constrained `send_connector_message`). Wired into the engine binding
	 * by the CLI's serve path.
	 */
	connectorTools(invocation: {
		botId: BotId;
		runId: RunId;
	}): ReturnType<typeof createSendConnectorMessageTool>[] {
		return [
			createSendConnectorMessageTool(invocation, {
				messenger: this.messenger,
				deliveryWorker: this.delivery,
			}),
		];
	}

	address(): { host: string; port: number } {
		const address = this.server.address();
		if (address === null || typeof address === "string") {
			throw new Error("Gateway server is not listening");
		}
		return { host: address.address, port: address.port };
	}

	remoteAddress(): GatewayRemoteAddress | undefined {
		return this.remoteListener?.address();
	}

	/**
	 * Stop the server. `graceful` interrupts active runs cooperatively,
	 * waits (bounded) for them to settle and the outbox to drain, and
	 * removes the discovery record. `crash` is a test hook that drops
	 * everything on the floor the way SIGKILL would — no state cleanup —
	 * so restart recovery can be exercised.
	 */
	async stop(mode: "graceful" | "crash" = "graceful"): Promise<void> {
		if (this.stopPromise) {
			return this.stopPromise;
		}
		this.stopPromise = this.doStop(mode);
		return this.stopPromise;
	}

	private async doStop(mode: "graceful" | "crash"): Promise<void> {
		// New connections are refused from here on (handleConnection guard).
		this.stopping = true;
		this.unsubscribeEvents?.();
		this.scheduler.stop();
		this.delivery.stop();
		await this.connectors.stop();
		if (mode === "graceful") {
			this.runtime.interruptAllActive("Gateway is stopping");
			await Promise.race([
				this.runtime.whenIdle(),
				new Promise((resolve) => setTimeout(resolve, this.stopTimeoutMs)),
			]);
			await this.outboxWorker.drain().catch(() => {});
			this.stores.audit.record("gateway", "gateway.stopped", this.instanceId);
			removeDiscoveryRecord(this.paths.discoveryFile, this.instanceId);
		}
		this.outboxWorker.stop();
		for (const connection of this.connections) {
			connection.socket.destroy();
		}
		this.connections.clear();
		await this.remoteListener?.close();
		await new Promise<void>((resolve) => {
			if (!this.server.listening) {
				resolve();
				return;
			}
			this.server.close(() => resolve());
		});
		this.database.close();
		this.lock.release();
		this.resolveStopped?.();
	}

	// ---------------------------------------------------------------------
	// Connection handling
	// ---------------------------------------------------------------------

	private handleConnection(
		socket: Duplex,
		expectedAuth: string,
		transport: "local" | "remote",
		handshakeTimeoutMs?: number,
	): void {
		if (this.stopping) {
			socket.destroy();
			return;
		}
		const connection = new Connection(socket, expectedAuth, transport);
		if (handshakeTimeoutMs !== undefined) {
			connection.armAuthTimeout(handshakeTimeoutMs);
		}
		this.connections.add(connection);
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			connection.feed(chunk, (line) => this.handleLine(connection, line));
		});
		const cleanup = () => {
			connection.dispose();
			this.connections.delete(connection);
			// Disconnect never implies abort: runs and pending server
			// requests are untouched; only the connection registry shrinks.
			// During stop the database may already be closed — socket close
			// events race shutdown, so the audit write is best-effort then.
			if (connection.clientId && !this.stopping) {
				this.stores.audit.record(
					"gateway",
					"client.disconnected",
					connection.clientId,
				);
			}
		};
		socket.on("close", cleanup);
		socket.on("error", () => socket.destroy());
	}

	private handleLine(connection: Connection, line: string): void {
		let value: unknown;
		try {
			value = JSON.parse(line);
		} catch {
			connection.send(
				errorResponse(
					"malformed",
					createGatewayError("invalid_request", "Frame is not valid JSON"),
				),
			);
			return;
		}

		// Frames without a method are server-request responses.
		if (
			typeof value === "object" &&
			value !== null &&
			!("method" in value) &&
			"id" in value
		) {
			this.handleServerResponse(connection, value);
			return;
		}

		const validated = validateGatewayRequest(value);
		if (!validated.ok) {
			const id =
				typeof value === "object" && value !== null && "id" in value
					? String((value as { id: unknown }).id)
					: "malformed";
			connection.send(errorResponse(id, validated.error));
			return;
		}
		const { request, definition, params } = validated;

		if (!connection.authenticated && request.method !== GATEWAY_HELLO_METHOD) {
			connection.send(
				errorResponse(
					request.id,
					createGatewayError(
						"handshake_required",
						"gateway.hello must be the first request of every connection",
					),
				),
			);
			return;
		}

		try {
			if (request.method === GATEWAY_HELLO_METHOD) {
				this.handleHello(connection, request, params);
				return;
			}
			if (definition.mutating) {
				this.handleMutating(connection, request, params);
				return;
			}
			const result = this.execute(connection, request.method, params);
			// Read methods may be async (e.g. connector credential probes).
			if (result instanceof Promise) {
				result.then(
					(value) => connection.send(okResponse(request.id, value)),
					(error) =>
						connection.send(errorResponse(request.id, toGatewayError(error))),
				);
				return;
			}
			connection.send(okResponse(request.id, result));
		} catch (error) {
			connection.send(errorResponse(request.id, toGatewayError(error)));
		}
	}

	private handleHello(
		connection: Connection,
		request: GatewayRequest,
		params: unknown,
	): void {
		const auth = (params as { auth?: string }).auth;
		if (!checkAuth(connection.expectedAuth, auth)) {
			connection.send(
				errorResponse(
					request.id,
					createGatewayError(
						"unauthorized",
						connection.transport === "local"
							? "gateway.hello requires the per-instance secret from the discovery record"
							: "gateway.hello requires a valid remote access token",
						{ retryable: false },
					),
				),
			);
			connection.socket.end();
			return;
		}
		const negotiation = negotiateHello(params, {
			gatewayId: this.stores.meta.ensureGatewayId(),
			instanceId: this.instanceId,
			catalogGeneration: this.stores.meta.catalogGeneration(),
		});
		if (!negotiation.ok) {
			connection.send(errorResponse(request.id, negotiation.error));
			connection.socket.end();
			return;
		}
		connection.markAuthenticated();
		connection.clientId = negotiation.result.clientId;
		const client = (
			params as {
				client: { name: string; version: string };
			}
		).client;
		this.database.transaction(() => {
			this.stores.clients.registerHello(
				negotiation.result.clientId,
				client.name,
				client.version,
				Date.now(),
			);
			this.stores.audit.record(
				negotiation.result.clientId,
				"client.connected",
				undefined,
				{
					name: client.name,
					version: client.version,
					transport: connection.transport,
				},
			);
		});
		connection.send(okResponse(request.id, negotiation.result));
	}

	private handleMutating(
		connection: Connection,
		request: GatewayRequest,
		params: unknown,
	): void {
		const key = (params as Record<string, unknown>)[
			IDEMPOTENCY_KEY_PARAM
		] as IdempotencyKey;
		const outcome = this.stores.idempotency.begin(key, request.method, params);
		if (outcome.kind === "conflict") {
			connection.send(errorResponse(request.id, outcome.error));
			return;
		}
		if (outcome.kind === "replay") {
			// Same key, same request: return the recorded outcome under the
			// caller's current correlation id.
			connection.send({ ...outcome.response, id: request.id });
			return;
		}
		if (outcome.kind === "pending") {
			connection.send(
				errorResponse(
					request.id,
					createGatewayError(
						"internal",
						"The original request with this idempotency key is still executing",
						{ retryable: true },
					),
				),
			);
			return;
		}
		let response: GatewayResponse;
		try {
			const result = this.database.transaction(() => {
				const value = this.execute(connection, request.method, params);
				return value;
			});
			response = okResponse(request.id, result);
		} catch (error) {
			response = errorResponse(request.id, toGatewayError(error));
		}
		if (response.error?.retryable === true) {
			// A retryable failure releases the key: the same request may be
			// retried with the same idempotency key.
			this.stores.idempotency.forget(key);
		} else {
			this.stores.idempotency.record(key, response);
		}
		connection.send(response);
	}

	/** Dispatch one validated request to the runtime. */
	private execute(
		connection: Connection,
		method: string,
		params: unknown,
	): unknown {
		const actor = connection.clientId ?? "unknown";
		const p = (params ?? {}) as Record<string, unknown>;
		switch (method) {
			case "gateway.status":
				return {
					...this.runtime.status(),
					tools: {
						generation: this.tools.catalog.current.generation,
						registered: this.tools.catalog.current.entries.length,
						available: this.tools.catalog.current.entries.filter(
							(entry) => entry.available,
						).length,
					},
					// Live connector worker health (read-only diagnostics).
					connectorHealth: this.connectors.status(),
					port: this.address().port,
					remote: this.remoteAddress(),
					connections: this.connections.size,
				};
			case "gateway.drain":
				return this.runtime.drain(actor, p.reason as string | undefined);
			case "gateway.stop": {
				this.runtime.drain(actor, "gateway.stop");
				this.stores.audit.record(actor, "gateway.stop");
				setImmediate(() => {
					void this.stop("graceful");
				});
				return { stopping: true };
			}
			case "run.start":
				return this.runtime.startRun(actor, {
					botId: p.botId as BotId,
					prompt: p.prompt as string,
					sessionId: p.sessionId as SessionId | undefined,
					workspaceRoot: p.workspaceRoot as string | undefined,
					newSession: p.newSession as boolean | undefined,
					overrides: p.overrides as never,
				});
			case "workspace.file.upload": {
				const sessionId = p.sessionId as SessionId;
				const session = this.runtime
					.listSessions()
					.find((candidate) => candidate.sessionId === sessionId);
				if (!session) {
					throw new GatewayCallError(
						createGatewayError("not_found", `Unknown session: ${sessionId}`),
					);
				}
				const data = Buffer.from(p.base64 as string, "base64");
				if (
					data.byteLength === 0 ||
					data.byteLength > MAX_WORKSPACE_UPLOAD_BYTES
				) {
					throw new GatewayCallError(
						createGatewayError(
							"invalid_request",
							`Uploads must contain between 1 byte and ${MAX_WORKSPACE_UPLOAD_BYTES} bytes`,
						),
					);
				}
				const requestedName = basename(p.name as string).replace(
					/[^A-Za-z0-9._-]/g,
					"_",
				);
				if (!requestedName || requestedName === "." || requestedName === "..") {
					throw new GatewayCallError(
						createGatewayError("invalid_request", "Upload filename is invalid"),
					);
				}
				const uploadDir = join(
					session.workspace.rootPath,
					".cline",
					"uploads",
					sessionId,
				);
				mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
				const path = join(uploadDir, `${Date.now()}-${requestedName}`);
				writeFileSync(path, data, { mode: 0o600, flag: "wx" });
				this.stores.audit.record(actor, "workspace.file.upload", path, {
					sessionId,
					name: requestedName,
					mediaType: p.mediaType,
					size: data.byteLength,
				});
				return { path, name: requestedName, size: data.byteLength };
			}
			case "session.create":
				return this.runtime.createSession(actor, {
					botId: p.botId as BotId,
					workspaceRoot: p.workspaceRoot as string | undefined,
				});
			case "run.steer":
				return this.runtime.steerRun(actor, p.runId as RunId, p.text as string);
			case "run.interrupt":
				return this.runtime.interruptRun(
					actor,
					p.runId as RunId,
					p.reason as string | undefined,
				);
			case "run.abort":
				return this.runtime.abortRun(
					actor,
					p.runId as RunId,
					p.reason as string | undefined,
				);
			case "run.retry":
				return this.runtime.retryRun(
					actor,
					p.runId as RunId,
					p.reason as string | undefined,
				);
			case "run.subscribe":
				return this.handleSubscribe(connection, p);
			case "run.list":
				return {
					runs: this.runtime.listRuns({
						sessionId: p.sessionId as SessionId | undefined,
						runId: p.runId as RunId | undefined,
					}),
				};
			case "tools.catalog":
				return this.tools.catalog.current;
			case "tools.profiles.list":
				return { profiles: this.tools.configurations.listProfiles() };
			case "tools.profiles.put": {
				const profile = this.tools.configurations.putProfile(
					p.profile as never,
					p.expectedRevision as number | undefined,
				);
				this.stores.audit.record(actor, "tools.profile.put", profile.name, {
					revision: profile.revision,
				});
				return profile;
			}
			case "tools.configuration.get":
				return this.tools.configurations.get(p.scope as never) ?? null;
			case "tools.configuration.put": {
				const record = this.tools.configurations.put(
					p.scope as never,
					p.config as never,
					p.expectedRevision as number | undefined,
				);
				this.stores.audit.record(
					actor,
					"tools.configuration.put",
					JSON.stringify(p.scope),
					{ revision: record.revision },
				);
				return record;
			}
			case "tools.previewEffective":
				return this.tools.previewFor({
					botId: p.botId as string,
					workspaceRoot: p.workspaceRoot as string,
					providerId: p.providerId as string,
					modelId: p.modelId as string,
					turn: p.turn as never,
				});
			case "bot.delegate":
				return this.runtime.delegateBot(actor, {
					parentBotId: p.parentBotId as BotId,
					name: p.name as string,
					role: p.role as "worker" | "contractor",
					reason: p.reason as string | undefined,
				});
			case "bot.list":
				return { bots: this.runtime.listBots() };
			case "bot.systemPrompt.get":
				return this.runtime.getBotSystemPrompt(p.botId as BotId);
			case "bot.systemPrompt.put":
				return this.runtime.putBotSystemPrompt(actor, {
					botId: p.botId as BotId,
					content: p.content as string,
					expectedRevision: p.expectedRevision as number | undefined,
				});
			case "session.list":
				return {
					sessions: this.runtime.listSessions(p.botId as BotId | undefined),
				};
			case "session.get":
				return this.runtime.getSessionSnapshot(p.sessionId as SessionId);
			// Statistics: bounded reads over the maintained aggregates only —
			// never a rescan of runs, events, or session message history.
			case "statistics.summary":
				return this.stores.usage.summary({
					from: p.from as string | undefined,
					to: p.to as string | undefined,
				});
			case "statistics.activity":
				return this.stores.usage.activity({
					from: p.from as string | undefined,
					to: p.to as string | undefined,
				});
			case "statistics.rankings":
				return this.stores.usage.rankings({
					dimension: p.dimension as "model" | "agent" | "topic",
					from: p.from as string | undefined,
					to: p.to as string | undefined,
					limit: p.limit as number | undefined,
				});
			case "statistics.usage":
				return this.stores.usage.month(p.month as string);
			case "connector.register": {
				const record = this.runtime.registerConnector(actor, {
					botId: p.botId as BotId,
					kind: p.kind as string,
					name: p.name as string,
					config: p.config as Record<string, unknown> | undefined,
					credentialRef: p.credentialRef as string | undefined,
				});
				this.connectors.start(record.connectorId);
				return record;
			}
			case "connector.list":
				return {
					connectors: this.runtime.listConnectors(p.botId as BotId | undefined),
				};
			case "connector.inspect": {
				const connectorId = p.connectorId as ConnectorId;
				const record = this.runtime.requireConnector(connectorId);
				return {
					connector: record,
					health: this.connectors.health(connectorId),
				};
			}
			case "connector.setEnabled": {
				const connectorId = p.connectorId as ConnectorId;
				const record = this.runtime.setConnectorEnabled(
					actor,
					connectorId,
					p.enabled as boolean,
				);
				if (record.status === "enabled") {
					this.connectors.start(connectorId);
				} else {
					this.connectors.stopConnector(connectorId);
				}
				return record;
			}
			case "connector.updateConfig":
				return this.runtime.updateConnectorConfig(
					actor,
					p.connectorId as ConnectorId,
					p.config as Record<string, unknown>,
				);
			case "connector.setCredential":
				return this.runtime.setConnectorCredentialRef(
					actor,
					p.connectorId as ConnectorId,
					p.credentialRef as string | undefined,
				);
			case "connector.remove": {
				const connectorId = p.connectorId as ConnectorId;
				this.connectors.stopConnector(connectorId);
				return this.runtime.removeConnector(actor, connectorId);
			}
			case "connector.routes":
				return {
					routes: this.runtime.listConnectorRoutes(
						p.connectorId as ConnectorId,
					),
				};
			case "connector.testCredentials": {
				const connectorId = p.connectorId as ConnectorId;
				const record = this.runtime.requireConnector(connectorId);
				const adapter = this.connectors.adapterFor(record.kind);
				if (!adapter) {
					throw new GatewayCallError(
						createGatewayError(
							"not_found",
							`No adapter for connector kind "${record.kind}"`,
						),
					);
				}
				// Async read: the credential is resolved and used here only —
				// never returned over the wire.
				return adapter
					.testCredentials(
						record.config,
						this.connectors.credentialForConnector(connectorId),
					)
					.then((check) => ({ ...check }));
			}
			case "connector.sendTest": {
				const connectorId = p.connectorId as ConnectorId;
				const record = this.runtime.requireConnector(connectorId);
				const conversation = p.externalConversationId as string;
				const enqueued = this.messenger.notify({
					botId: record.botId,
					connectorId,
					externalAccountId: (p.externalAccountId as string) ?? "operator",
					externalConversationId: conversation,
					text:
						(p.text as string | undefined) ??
						`Cline Gateway test message (${record.name})`,
					origin: "test",
					idempotencyKey: `test:${connectorId}:${conversation}:${String(
						p.idempotencyKey,
					)}`,
					actor,
				});
				return { outbound: enqueued.record };
			}
			case "connector.outbound":
				return {
					messages: this.runtime.listOutboundMessages({
						connectorId: p.connectorId as ConnectorId | undefined,
						botId: p.botId as BotId | undefined,
						state: p.state as never,
						limit: p.limit as number | undefined,
					}),
				};
			case "schedule.create":
				return this.runtime.createSchedule(actor, {
					botId: p.botId as BotId,
					name: p.name as string,
					prompt: p.prompt as string,
					notify: p.notify as never,
					intervalMs: p.intervalMs as number | undefined,
					at: p.at as number | undefined,
					maxAttempts: p.maxAttempts as number | undefined,
				});
			case "schedule.list":
				return {
					schedules: this.runtime.listSchedules(p.botId as BotId | undefined),
				};
			case "schedule.report":
				return {
					jobs: this.runtime.scheduleReport(p.scheduleId as ScheduleId),
				};
			default:
				throw new GatewayCallError(
					createGatewayError("not_found", `Unhandled method: ${method}`),
				);
		}
	}

	private handleSubscribe(
		connection: Connection,
		params: Record<string, unknown>,
	): unknown {
		const scope: GatewayEventScope = {
			...(params.sessionId ? { sessionId: params.sessionId as SessionId } : {}),
			...(params.runId ? { runId: params.runId as RunId } : {}),
		};
		let cursor: EventCursor | undefined;
		if (typeof params.cursor === "string") {
			cursor = decodeEventCursor(params.cursor);
		}
		const after = cursor
			? cursor.lastSequence
			: this.stores.events.lastSequence();
		connection.subscriptions.push({ scope, after });
		connection.schedulePump(this.stores.events);
		// Re-issue server requests still pending for this scope: a
		// reconnecting client neither loses nor implicitly answers them.
		for (const pending of this.runtime.approvals.pendingForScope(scope)) {
			connection.send(pending);
		}
		return { subscribed: true, replayFromSequence: after };
	}

	private handleServerResponse(connection: Connection, value: unknown): void {
		if (!connection.authenticated) {
			return;
		}
		const parsed = GatewayServerResponseSchema.safeParse(value);
		if (!parsed.success) {
			return;
		}
		this.runtime.approvals.respond(
			parsed.data.id,
			parsed.data.result,
			parsed.data.error,
		);
	}

	private deliverServerRequest(request: GatewayServerRequest): void {
		for (const connection of this.connections) {
			if (!connection.authenticated) {
				continue;
			}
			const interested =
				connection.subscriptions.length === 0
					? false
					: connection.subscriptions.some((subscription) =>
							scopeMatches(subscription.scope, request.scope),
						);
			if (interested) {
				connection.send(request);
			}
		}
	}
}

function checkAuth(
	expectedValue: string,
	offered: string | undefined,
): boolean {
	if (!offered) return false;
	const expected = Buffer.from(expectedValue, "utf8");
	const actual = Buffer.from(offered, "utf8");
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => {
		if (!server.listening) return resolve();
		server.close(() => resolve());
	});
}

function scopeMatches(
	subscription: GatewayEventScope,
	target: GatewayEventScope,
): boolean {
	if (subscription.runId) {
		return subscription.runId === target.runId;
	}
	if (subscription.sessionId) {
		return subscription.sessionId === target.sessionId;
	}
	if (subscription.botId) {
		return subscription.botId === target.botId;
	}
	return true;
}

function okResponse(id: string, result: unknown): GatewayResponse {
	return {
		version: GATEWAY_PROTOCOL_VERSION,
		id,
		result: result ?? null,
	};
}

function errorResponse(id: string, error: GatewayError): GatewayResponse {
	return { version: GATEWAY_PROTOCOL_VERSION, id, error };
}
