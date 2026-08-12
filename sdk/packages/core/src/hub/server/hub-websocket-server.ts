import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_CAPABILITIES,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import { WebSocketServer } from "ws";
import corePackage from "../../../package.json";
import { rememberRecoverableLocalHubUrl, verifyHubConnection } from "../client";
import {
	clearHubDiscovery,
	clearHubDiscoveryIfOwned,
	createHubAuthToken,
	createHubServerUrl,
	getManagedHubCompatibility,
	type HubServerDiscoveryRecord,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildId,
	resolveHubOwnerContext,
	withHubStartupLock,
	writeHubDiscovery,
} from "../discovery";
import { resolveDefaultHubPort } from "../discovery/defaults";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";
import type {
	EnsuredHubWebSocketServerResult,
	EnsureHubWebSocketServerOptions,
	HubWebSocketServer,
	HubWebSocketServerClose,
	HubWebSocketServerOptions,
} from "./hub-server-options";
import { HubServerTransport } from "./hub-server-transport";
import { NativeHubTransportAdapter } from "./native-transport";

export { truncateNotificationBody } from "./hub-notifications";
export type {
	EnsuredHubWebSocketServerResult,
	EnsureHubWebSocketServerOptions,
	HubWebSocketServer,
	HubWebSocketServerClose,
	HubWebSocketServerOptions,
} from "./hub-server-options";
export { HubServerTransport } from "./hub-server-transport";

type NodeWebSocketLike = {
	send(data: string): void;
	on(event: "message", listener: (data: unknown) => void): void;
	on(event: "close", listener: () => void): void;
	on(event: "pong", listener: () => void): void;
	once(event: "close", listener: () => void): void;
	ping?(): void;
	terminate?(): void;
};

type TrackedNodeWebSocket = NodeWebSocketLike & {
	isAlive?: boolean;
};

type NodeUpgradeSocketLike = {
	destroy(error?: Error): void;
	write(chunk: string): boolean;
	end(): void;
};

function decodeSocketData(data: unknown): string {
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof Uint8Array) {
		return Buffer.from(data).toString();
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString();
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((chunk) => Buffer.from(chunk))).toString();
	}
	return String(data);
}

function wrapWsSocket(socket: NodeWebSocketLike) {
	return {
		send(data: string): void {
			socket.send(data);
		},
		addEventListener(
			type: "message" | "close",
			listener: (...args: never[]) => void,
		): void {
			if (type === "message") {
				socket.on("message", (data: unknown) => {
					(listener as (event: { data: string }) => void)({
						data: decodeSocketData(data),
					});
				});
				return;
			}
			socket.on("close", listener as () => void);
		},
		removeEventListener(): void {},
	};
}

function rejectUpgradeSocket(socket: NodeUpgradeSocketLike): void {
	try {
		socket.write(
			"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

function rejectUnauthorizedUpgradeSocket(socket: NodeUpgradeSocketLike): void {
	try {
		socket.write(
			"HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

function rejectStartingUpgradeSocket(socket: NodeUpgradeSocketLike): void {
	try {
		socket.write(
			"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
		);
		socket.end();
	} catch {
		socket.destroy();
	}
}

function isValidHubAuthToken(
	candidate: string | null,
	expected: string,
): boolean {
	if (!candidate || !expected) {
		return false;
	}
	const candidateBuffer = Buffer.from(candidate, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	return (
		candidateBuffer.length === expectedBuffer.length &&
		timingSafeEqual(candidateBuffer, expectedBuffer)
	);
}

function formatHubStartupError(
	error: unknown,
	context: {
		host: string;
		port: number;
		pathname: string;
	},
): Error {
	const code =
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
			? (error as { code: string }).code
			: undefined;
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown startup error";
	const details = `Failed to start hub server on ${context.host}:${context.port}${context.pathname}: ${message}`;
	const wrapped = new Error(code ? `${details} (${code})` : details);
	if (code) {
		(error as Error & { code?: string }).code = code;
		(wrapped as Error & { code?: string }).code = code;
	}
	if (error instanceof Error && error.stack) {
		wrapped.stack = `${wrapped.name}: ${wrapped.message}\nCaused by: ${error.stack}`;
	}
	return wrapped;
}

function isAddressInUseError(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as Error & { code?: string }).code === "EADDRINUSE"
	);
}

function hubUrlMatchesEndpoint(
	url: string,
	host: string,
	port: number,
	pathname: string,
): boolean {
	try {
		const actual = new URL(url);
		const expected = new URL(
			createHubServerUrl(host, port === 0 ? 1 : port, pathname),
		);
		return (
			actual.protocol === expected.protocol &&
			actual.hostname === expected.hostname &&
			actual.pathname === expected.pathname &&
			(port === 0 || actual.port === expected.port)
		);
	} catch {
		return false;
	}
}

function createHubEndpointConflictError(
	ownerId: string,
	runningUrl: string,
	requestedUrl: string,
): Error {
	return new Error(
		`Hub owner ${ownerId} is already running at ${runningUrl}; refusing a second endpoint at ${requestedUrl}`,
	);
}

interface SharedHubServerEntry {
	promise: Promise<HubWebSocketServer>;
	server?: HubWebSocketServer;
	state: "starting" | "open" | "closing";
}

const SHARED_SERVERS = new Map<string, SharedHubServerEntry>();
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";
const HUB_SOCKET_HEARTBEAT_INTERVAL_MS = 30_000;
const HUB_STARTUP_ROLLBACK_TIMEOUT_MS = 2_000;

async function settlesWithin(
	promise: Promise<unknown>,
	timeoutMs: number,
): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			new Promise<boolean>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

function parseHeaderValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value.join(",") : (value ?? "");
}

function isAuthHeaderWhitespace(code: number): boolean {
	return code === 0x20 || code === 0x09;
}

export function readBearerToken(
	value: string | string[] | undefined,
): string | null {
	const header = parseHeaderValue(value).trim();
	const bearerScheme = "bearer";
	if (
		header.length <= bearerScheme.length ||
		header.slice(0, bearerScheme.length).toLowerCase() !== bearerScheme ||
		!isAuthHeaderWhitespace(header.charCodeAt(bearerScheme.length))
	) {
		return null;
	}

	let tokenStart = bearerScheme.length + 1;
	while (
		tokenStart < header.length &&
		isAuthHeaderWhitespace(header.charCodeAt(tokenStart))
	) {
		tokenStart += 1;
	}

	return header.slice(tokenStart).trim() || null;
}

function readWebSocketAuthToken(
	value: string | string[] | undefined,
): string | null {
	for (const protocol of parseHeaderValue(value).split(",")) {
		const trimmed = protocol.trim();
		if (trimmed.startsWith(HUB_AUTH_PROTOCOL_PREFIX)) {
			return trimmed.slice(HUB_AUTH_PROTOCOL_PREFIX.length).trim() || null;
		}
	}
	return null;
}

/** @internal Exported for websocket auth tests. */
export function isLocalHubHostName(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1" ||
		normalized === "[::1]"
	);
}

/** @internal Exported for websocket auth tests. */
export function isLocalHubOrigin(
	value: string | string[] | undefined,
): boolean {
	const raw = parseHeaderValue(value).trim();
	if (!raw) {
		return false;
	}
	try {
		return isLocalHubHostName(new URL(raw).hostname);
	} catch {
		return false;
	}
}

export async function startHubWebSocketServer(
	options: HubWebSocketServerOptions,
): Promise<HubWebSocketServer> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const host = options.host ?? "127.0.0.1";
	const pathname = options.pathname ?? "/hub";
	const configuredPort = options.port ?? resolveDefaultHubPort();
	const requestedPort = configuredPort;
	let port = requestedPort;
	let url = createHubServerUrl(host, requestedPort, pathname);
	const buildId = resolveHubBuildId();
	const authToken = createHubAuthToken();
	const transport = new HubServerTransport(options);
	await transport.start();
	const hubId = transport.getHubId();
	const adapter = new BrowserWebSocketHubAdapter(
		new NativeHubTransportAdapter(transport),
		options.telemetry,
	);
	const cleanup = new Set<() => void>();
	const startedAt = new Date().toISOString();
	const versionPayload = {
		protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
		minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
		maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
		capabilities: HUB_CAPABILITIES,
		coreVersion: corePackage.version,
		buildId,
		pid: process.pid,
		startedAt,
	} as const;
	const sockets = new Set<TrackedNodeWebSocket>();
	let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	let closeHandle: HubWebSocketServerClose | undefined;
	let exposedServer: HubWebSocketServer | undefined;
	let published = false;

	const beginClose = (): HubWebSocketServerClose => {
		if (closeHandle) {
			return closeHandle;
		}
		if (exposedServer) {
			const shared = SHARED_SERVERS.get(owner.discoveryPath);
			if (shared?.server === exposedServer) {
				shared.state = "closing";
			}
		}
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}

		const webSocketClosed = new Promise<void>((resolve, reject) => {
			wss.close((error?: Error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
		const listenerClosed = new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
		const transportStopped = Promise.resolve().then(() => transport.stop());
		const discoveryRetired = transportStopped.then(async () => {
			await clearHubDiscoveryIfOwned(owner.discoveryPath, hubId);
		});
		const closed = (async () => {
			const closeResults = await Promise.allSettled([
				webSocketClosed,
				listenerClosed,
				transportStopped,
				discoveryRetired,
			]);
			const closeErrors = closeResults.flatMap((result) =>
				result.status === "rejected" ? [result.reason] : [],
			);
			if (closeErrors.length > 0) {
				throw new AggregateError(closeErrors, "hub server close failed");
			}
		})().finally(() => {
			const shared = SHARED_SERVERS.get(owner.discoveryPath);
			if (shared?.server === exposedServer) {
				SHARED_SERVERS.delete(owner.discoveryPath);
			}
		});
		closeHandle = { transportStopped, closed };

		// Terminate sockets and detach handlers only after the memo handle is
		// assigned. websocket.terminate() fires close events whose microtask
		// continuations can re-enter beginClose() (e.g. the daemon coordinator's
		// deferred cleanup reaching server.beginClose()); entering before the
		// handle exists built a second set of close operations whose wss/listener
		// closes rejected with "Server is not running", spuriously failing the
		// close aggregate.
		for (const websocket of sockets) {
			websocket.terminate?.();
		}
		sockets.clear();
		for (const detach of cleanup) {
			detach();
		}
		cleanup.clear();

		return closeHandle;
	};
	const closeServer = (): Promise<void> => beginClose().closed;

	const server = http.createServer((req, res) => {
		if (!published) {
			res.statusCode = 503;
			res.end("Starting");
			return;
		}
		if ((req.url ?? "/") === "/health") {
			const body = JSON.stringify({
				ok: true,
				protocolVersion: versionPayload.protocolVersion,
				minClientProtocolVersion: versionPayload.minClientProtocolVersion,
				maxClientProtocolVersion: versionPayload.maxClientProtocolVersion,
				coreVersion: versionPayload.coreVersion,
				buildId: versionPayload.buildId,
				host,
				port,
				url,
			});
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(body);
			return;
		}
		if ((req.url ?? "/") === "/status") {
			if (
				!isValidHubAuthToken(
					readBearerToken(req.headers.authorization),
					authToken,
				)
			) {
				res.statusCode = 401;
				res.end("Unauthorized");
				return;
			}
			const body = JSON.stringify({
				hubId,
				...versionPayload,
				authToken,
				host,
				port,
				url,
				updatedAt: new Date().toISOString(),
			} satisfies HubServerDiscoveryRecord);
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(body);
			return;
		}
		if ((req.url ?? "/") === "/version") {
			res.statusCode = 200;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(versionPayload));
			return;
		}
		const requestUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
		if (requestUrl.pathname === "/shutdown" && req.method === "POST") {
			if (
				!isValidHubAuthToken(
					readBearerToken(req.headers.authorization),
					authToken,
				)
			) {
				res.statusCode = 401;
				res.end("Unauthorized");
				return;
			}
			res.statusCode = 202;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify({ ok: true }));
			queueMicrotask(() => {
				try {
					void Promise.resolve(options.onShutdownRequested?.()).catch(
						() => undefined,
					);
				} catch {
					// The accepted request still closes the server if owner
					// notification fails.
				} finally {
					// Closing is memoized, so the daemon coordinator and this
					// safety path converge on the same teardown operation. Close
					// failures are observed and reported by the owner's own await
					// on the same memoized promise; an unobserved rejection here
					// must not take the daemon's unhandledRejection fatal path.
					closeServer().catch(() => undefined);
				}
			});
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
	});
	const wss = new WebSocketServer({ noServer: true });
	heartbeatTimer = setInterval(() => {
		for (const websocket of sockets) {
			if (websocket.isAlive === false) {
				try {
					websocket.terminate?.();
				} catch {
					// The socket is already unhealthy; cleanup below is sufficient.
				}
				sockets.delete(websocket);
				continue;
			}
			websocket.isAlive = false;
			try {
				websocket.ping?.();
			} catch {
				try {
					websocket.terminate?.();
				} catch {
					// best-effort termination
				}
				sockets.delete(websocket);
			}
		}
	}, HUB_SOCKET_HEARTBEAT_INTERVAL_MS);

	server.on("upgrade", (request, socket, head) => {
		if (!published) {
			rejectStartingUpgradeSocket(socket);
			return;
		}
		const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
		if (requestUrl.pathname !== pathname) {
			socket.destroy();
			return;
		}
		const isAuthorized =
			isValidHubAuthToken(
				readWebSocketAuthToken(request.headers["sec-websocket-protocol"]),
				authToken,
			) ||
			(isLocalHubHostName(host) && isLocalHubOrigin(request.headers.origin));
		if (!isAuthorized) {
			rejectUnauthorizedUpgradeSocket(socket);
			return;
		}
		try {
			wss.handleUpgrade(
				request,
				socket,
				head,
				(websocket: NodeWebSocketLike) => {
					const tracked = websocket as TrackedNodeWebSocket;
					tracked.isAlive = true;
					tracked.on("pong", () => {
						tracked.isAlive = true;
					});
					sockets.add(tracked);
					const detach = adapter.attach(wrapWsSocket(websocket));
					cleanup.add(detach);
					websocket.once("close", () => {
						sockets.delete(tracked);
						detach();
						cleanup.delete(detach);
					});
				},
			);
		} catch {
			rejectUpgradeSocket(socket);
		}
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", (error) => {
				reject(
					formatHubStartupError(error, {
						host,
						port: requestedPort,
						pathname,
					}),
				);
			});
			server.listen(requestedPort, host, () => {
				const address = server.address();
				if (!address || typeof address === "string") {
					reject(
						formatHubStartupError(new Error("Failed to resolve hub port"), {
							host,
							port: requestedPort,
							pathname,
						}),
					);
					return;
				}
				port = address.port;
				url = createHubServerUrl(host, port, pathname);
				resolve();
			});
		});
	} catch (error) {
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}
		await settlesWithin(
			Promise.resolve().then(() => transport.stop()),
			HUB_STARTUP_ROLLBACK_TIMEOUT_MS,
		);
		throw error;
	}

	try {
		await writeHubDiscovery(owner.discoveryPath, {
			hubId,
			protocolVersion: CURRENT_HUB_PROTOCOL_VERSION,
			minClientProtocolVersion: MIN_CLIENT_HUB_PROTOCOL_VERSION,
			maxClientProtocolVersion: MAX_CLIENT_HUB_PROTOCOL_VERSION,
			capabilities: [...versionPayload.capabilities],
			coreVersion: corePackage.version,
			buildId,
			authToken,
			host,
			port,
			url,
			pid: process.pid,
			startedAt,
			updatedAt: startedAt,
		});
		published = true;
	} catch (error) {
		// Listening without a published auth token creates an undiscoverable
		// daemon that still owns the endpoint. Start full rollback immediately,
		// but do not let Bun's WebSocket/http close bug prevent startup from
		// rejecting into the daemon's fatal-exit path.
		const rollbackSettled = await settlesWithin(
			beginClose().closed,
			HUB_STARTUP_ROLLBACK_TIMEOUT_MS,
		);
		if (!rollbackSettled) {
			try {
				server.closeAllConnections();
				server.unref();
			} catch {
				// The original publication error remains authoritative. The owning
				// daemon will take its fatal process-exit path after this rejects.
			}
		}
		throw error;
	}

	exposedServer = {
		host,
		port,
		url,
		authToken,
		beginClose,
		close: closeServer,
	};
	return exposedServer;
}

export async function ensureHubWebSocketServer(
	options: EnsureHubWebSocketServerOptions,
): Promise<EnsuredHubWebSocketServerResult> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const hasExplicitEndpoint =
		options.host !== undefined ||
		options.port !== undefined ||
		options.pathname !== undefined ||
		!!process.env.CLINE_HUB_PORT?.trim();
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? resolveDefaultHubPort();
	const pathname = options.pathname ?? "/hub";
	const expectedUrl = createHubServerUrl(host, port, pathname);
	const sharedKey = owner.discoveryPath;
	const rememberIfManaged = <T extends EnsuredHubWebSocketServerResult>(
		result: T,
	): T => {
		if (!hasExplicitEndpoint) {
			rememberRecoverableLocalHubUrl(result.url, result.authToken);
		}
		return result;
	};
	const existing = SHARED_SERVERS.get(sharedKey);
	if (existing) {
		const server = await existing.promise;
		if (existing.state === "closing") {
			// Runtime teardown alone does not release the HTTP endpoint. Keep the
			// closing generation authoritative until its listener is also closed so
			// a same-port replacement cannot race into EADDRINUSE or fallback. The
			// aggregate rejects only after every close operation has settled, so a
			// cleanup error is reported to close callers without blocking recovery.
			await server.beginClose().closed.catch(() => undefined);
			if (SHARED_SERVERS.get(sharedKey) === existing) {
				SHARED_SERVERS.delete(sharedKey);
			}
		} else if (
			hubUrlMatchesEndpoint(server.url, host, port, pathname) ||
			options.allowPortFallback === true
		) {
			return rememberIfManaged({
				server,
				url: server.url,
				authToken: server.authToken,
				action: "reuse",
			});
		} else {
			throw createHubEndpointConflictError(
				owner.ownerId,
				server.url,
				expectedUrl,
			);
		}
	}

	return await withHubStartupLock(owner.discoveryPath, async () => {
		const discovered = await readHubDiscovery(owner.discoveryPath);
		if (discovered?.url) {
			const healthy = await probeHubServer(discovered.url, {
				authToken: discovered.authToken,
			});
			if (
				healthy?.url &&
				getManagedHubCompatibility(healthy, resolveHubBuildId()).compatible &&
				(await verifyHubConnection(healthy.url, {
					authToken: discovered.authToken,
				}))
			) {
				if (
					hubUrlMatchesEndpoint(discovered.url, host, port, pathname) ||
					options.allowPortFallback === true
				) {
					return rememberIfManaged({
						url: healthy.url,
						authToken: discovered.authToken,
						action: "reuse",
					});
				}
				throw createHubEndpointConflictError(
					owner.ownerId,
					discovered.url,
					expectedUrl,
				);
			}

			// A discovered endpoint that cannot be authenticated/verified is stale.
			await clearHubDiscovery(owner.discoveryPath);
		}

		const start = async (
			startOptions: HubWebSocketServerOptions,
		): Promise<EnsuredHubWebSocketServerResult> => {
			const serverPromise = startHubWebSocketServer({ ...startOptions, owner });
			const sharedEntry: SharedHubServerEntry = {
				promise: serverPromise,
				state: "starting",
			};
			SHARED_SERVERS.set(sharedKey, sharedEntry);
			try {
				const server = await serverPromise;
				sharedEntry.server = server;
				sharedEntry.state = "open";
				return rememberIfManaged({
					server,
					url: server.url,
					authToken: server.authToken,
					action: "started",
				});
			} catch (error) {
				if (SHARED_SERVERS.get(sharedKey) === sharedEntry) {
					SHARED_SERVERS.delete(sharedKey);
				}
				throw error;
			}
		};

		try {
			return await start(options);
		} catch (error) {
			if (!options.allowPortFallback || !isAddressInUseError(error)) {
				throw error;
			}
			return await start({ ...options, port: 0 });
		}
	});
}
