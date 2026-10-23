import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import {
	type ApprovalPolicy,
	decodeDeviceBeginFrame,
	decodePairAttestFrame,
	decodeSecureDataFrame,
	encodeDeviceOkFrame,
	encodeHandshakeErrorFrame,
	encodePairOkFrame,
	encodeSecureDataFrame,
	FRAME_HEADER_LENGTH,
	HUB_DEVICE_ERROR_FRAME,
	HUB_HANDSHAKE_MAX_WIRE_BYTES,
	HUB_PAIR_ERROR_FRAME,
	HubPairingError,
	hasDeviceSubprotocol,
	maxEncodedSecureDataFrameBytes,
	readPairSubprotocolOfferId,
	type SecureChannel,
} from "@cline/hub-pairing";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	HUB_CAPABILITIES,
	HUB_MAX_FRAME_BYTES,
	MAX_CLIENT_HUB_PROTOCOL_VERSION,
	MIN_CLIENT_HUB_PROTOCOL_VERSION,
} from "@cline/shared";
import { WebSocketServer } from "ws";
import corePackage from "../../../package.json";
import { rememberRecoverableLocalHubUrl, verifyHubConnection } from "../client";
import { hubHasLiveSessions, retireDiscoveredHub } from "../daemon";
import {
	clearHubDiscovery,
	clearHubDiscoveryIfOwned,
	createHubAuthToken,
	createHubServerUrl,
	type HubServerDiscoveryRecord,
	isManagedHubReusable,
	probeHubServer,
	readHubDiscovery,
	resolveHubBuildEpochMs,
	resolveHubBuildId,
	resolveHubOwnerContext,
	withHubStartupLock,
	writeHubDiscovery,
} from "../discovery";
import { resolveDefaultHubPort } from "../discovery/defaults";
import {
	HubInstanceLock,
	isHubLockHeldError,
	resolveHubInstanceLockPath,
} from "../discovery/instance-lock";
import { createFileHubPairingAuthority, terminableSocket } from "../pairing";
import { BrowserWebSocketHubAdapter } from "./browser-websocket";
import { createHandshakeGate, type HandshakeGate } from "./hub-handshake-gate";
import { logHubMessage } from "./hub-server-logging";
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
	close?(code?: number, reason?: string): void;
	readyState?: number;
};

type TrackedNodeWebSocket = NodeWebSocketLike & {
	isAlive?: boolean;
};

type PayloadAdjustableNodeWebSocket = NodeWebSocketLike & {
	_receiver?: { _maxPayload?: number };
};

type NodeUpgradeSocketLike = {
	destroy(error?: Error): void;
	write(chunk: string): boolean;
	end(): void;
};

const CHACHA20_POLY1305_TAG_BYTES = 16;
const HUB_SECURE_MAX_WIRE_BYTES = maxEncodedSecureDataFrameBytes(
	HUB_MAX_FRAME_BYTES + FRAME_HEADER_LENGTH + CHACHA20_POLY1305_TAG_BYTES,
);
const USES_BUN_WEBSOCKET_COMPAT =
	typeof (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun ===
	"string";

/**
 * Node `ws` fixes maxPayload when it creates a socket's receiver. Pairing
 * sockets therefore start at the unauthenticated handshake ceiling and are
 * widened only after Noise authenticates the peer. Bun's compatibility server
 * does not expose its receiver or enforce `maxPayload`; the handshake gate
 * still rejects more than the same 64 KiB before authentication there.
 */
function allowAuthenticatedPayloads(socket: NodeWebSocketLike): void {
	const receiver = (socket as PayloadAdjustableNodeWebSocket)._receiver;
	if (!receiver || typeof receiver._maxPayload !== "number") {
		if (USES_BUN_WEBSOCKET_COMPAT) return;
		throw new Error(
			"Unable to raise the authenticated websocket payload limit",
		);
	}
	receiver._maxPayload = HUB_SECURE_MAX_WIRE_BYTES;
}

interface PairedSocketAuthority {
	deviceId: string;
	approvalPolicy: ApprovalPolicy;
	channel: SecureChannel;
}

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

/**
 * Adapt a `ws` socket to the browser-ish surface {@link BrowserWebSocketHubAdapter}
 * expects.
 *
 * `ws` ignores whatever a listener returns, so anything asynchronous escaping the
 * adapter would become an unhandled rejection — fatal to the hub process under
 * `--unhandled-rejections=throw`. The adapter already contains its own failures;
 * this layer contains them again so no future listener can take the process down
 * from here.
 *
 * @internal Exported for websocket wrapper tests.
 */
export function wrapWsSocket(
	socket: NodeWebSocketLike,
	/**
	 * Supplied for a socket that had to complete a handshake before it counted as
	 * authenticated. Its `message` listener is already installed, so taking frames
	 * from the gate is the only way to see them once — and the only way to see the
	 * ones that arrived while the handshake was still running.
	 */
	gate?: HandshakeGate,
	secureChannel?: SecureChannel,
) {
	return {
		send(data: string): void {
			try {
				socket.send(
					secureChannel
						? encodeSecureDataFrame(
								secureChannel.encryptBytes(new TextEncoder().encode(data)),
							)
						: data,
				);
			} catch (error) {
				secureChannel?.close();
				socket.terminate?.();
				throw error;
			}
		},
		/**
		 * Heartbeat liveness, used when another connection wants this socket's client
		 * id. `isAlive` is cleared before every ping and set again on the pong, so
		 * `false` means "already missed a heartbeat and is queued for termination" —
		 * exactly the half-open case a reconnecting client must be able to take over
		 * without waiting for the sweep.
		 */
		isAlive(): boolean {
			return (socket as TrackedNodeWebSocket).isAlive !== false;
		},
		close(): void {
			socket.terminate?.();
		},
		addEventListener(
			type: "message" | "close",
			listener: (...args: never[]) => void,
		): void {
			if (type === "message") {
				const deliver = (wireText: string): void => {
					if (
						!secureChannel &&
						Buffer.byteLength(wireText) > HUB_MAX_FRAME_BYTES
					) {
						try {
							socket.close?.(1009, "message too big");
						} catch {
							socket.terminate?.();
						}
						return;
					}
					try {
						const text = secureChannel
							? new TextDecoder().decode(
									secureChannel.decryptBytes(
										decodeSecureDataFrame(wireText).data,
									),
								)
							: wireText;
						const result = (listener as (event: { data: string }) => unknown)({
							data: text,
						});
						void Promise.resolve(result).catch(logSocketListenerFailure);
					} catch (error) {
						logSocketListenerFailure(error);
						secureChannel?.close();
						socket.terminate?.();
					}
				};
				if (gate) {
					gate.pipe(deliver);
					return;
				}
				socket.on("message", (data: unknown) => {
					let text: string;
					try {
						text = decodeSocketData(data);
					} catch (error) {
						logSocketListenerFailure(error);
						return;
					}
					deliver(text);
				});
				return;
			}
			socket.on("close", () => {
				secureChannel?.close();
				(listener as () => void)();
			});
		},
		removeEventListener(): void {},
	};
}

function logSocketListenerFailure(error: unknown): void {
	logHubMessage("error", "websocket message listener failed", {
		error:
			error instanceof Error ? error.stack || error.message : String(error),
	});
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
/**
 * How long a socket may sit upgraded-but-unauthenticated waiting to send its
 * handshake frame. Generous enough for a phone on a slow network, short enough
 * that opening sockets is not a way to hold hub resources without a credential.
 */
const HUB_HANDSHAKE_TIMEOUT_MS = 15_000;
const HUB_STARTUP_ROLLBACK_TIMEOUT_MS = 2_000;
/** How long ensure waits for a retiring predecessor's endpoint and lock. */
const ENSURE_RETIRE_WAIT_MS = 3_000;
const ENSURE_RETIRE_POLL_MS = 100;

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

/**
 * What the phone shows when the hub refuses a handshake.
 *
 * Keyed off the machine-readable `code` so the app never string-matches, and
 * deliberately vague about the cryptographic failures: an unauthenticated peer
 * learns that it was refused, not which check refused it.
 *
 * @internal Exported for websocket auth tests.
 */
export function refusalMessage(code: string): string {
	switch (code) {
		case "offer_expired":
			return "That pairing code has expired. Run /handoff on your computer for a fresh one.";
		case "offer_consumed":
			return "That pairing code has already been used. Run /handoff on your computer for a fresh one.";
		case "offer_invalid":
			return "This machine has no pairing code waiting. Run /handoff on your computer, then scan again.";
		case "device_revoked":
			return "This device was removed from that computer. Run /handoff on it to pair again.";
		case "device_unknown":
			return "That computer does not recognise this device. Run /handoff on it to pair again.";
		default:
			return "The secure handshake failed. Run /handoff on your computer and try again.";
	}
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
	const buildEpochMs = resolveHubBuildEpochMs();
	const authToken = createHubAuthToken();
	// Acquire singleton ownership before constructing any durable stores or
	// listeners. Pairing remains an additive authentication path below.
	const instanceLock = HubInstanceLock.acquire(
		resolveHubInstanceLockPath(owner.discoveryPath),
	);
	if (!instanceLock.held) {
		logHubMessage("warn", "instance_lock.unavailable", {
			lockFile: instanceLock.lockFile,
		});
	}
	// Additive, never a replacement: the token path below is unchanged, because the
	// CLI, desktop app, cline-hub dashboard and the manual-entry form all use it.
	const pairingAuthority =
		options.pairing === false
			? undefined
			: (options.pairing ??
				createFileHubPairingAuthority(
					options.pairingDir ? { pairingDir: options.pairingDir } : {},
				));
	// Trust model is chosen here, from the interface the hub is actually reachable
	// on, and never left to a default. A loopback hub's auth token is only readable
	// by processes running as the user who started it, so every authenticated
	// connection is that user: the CLI, desktop app, dashboard and local mobile
	// bridge attach to and observe each other's sessions. A hub bound anywhere else
	// gets the conservative model, where "has the token" proves nothing about who
	// is holding it.
	let transport: HubServerTransport;
	try {
		transport = new HubServerTransport({
			...options,
			owner,
			sessionTrustModel:
				options.sessionTrustModel ??
				(isLocalHubHostName(host) ? "loopback-single-owner" : "session-scoped"),
		});
		await transport.start();
	} catch (error) {
		instanceLock.release();
		throw error;
	}
	const hubId = transport.getHubId();
	const adapter = new BrowserWebSocketHubAdapter(
		new NativeHubTransportAdapter(transport),
		options.telemetry,
		options.workspaceRoot,
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
		buildEpochMs,
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

		const closeWebSocketServer = (webSocketServer: WebSocketServer) =>
			new Promise<void>((resolve, reject) => {
				webSocketServer.close((error?: Error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		const webSocketClosed = Promise.all([
			closeWebSocketServer(wss),
			closeWebSocketServer(handshakeWss),
		]).then(() => undefined);
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
		// Releases the device-store watcher, which otherwise keeps the loop alive.
		const pairingClosed = Promise.resolve().then(() =>
			pairingAuthority?.close(),
		);
		const discoveryRetired = transportStopped.then(async () => {
			await clearHubDiscoveryIfOwned(owner.discoveryPath, hubId);
		});
		const closed = (async () => {
			const closeResults = await Promise.allSettled([
				webSocketClosed,
				listenerClosed,
				transportStopped,
				pairingClosed,
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
			// Release singleton ownership last: the successor may take the lock
			// only once the endpoint, transport, and discovery are all retired.
			instanceLock.release();
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
				buildEpochMs: versionPayload.buildEpochMs,
				draining: transport.isDraining(),
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
		if (requestUrl.pathname === "/drain" && req.method === "POST") {
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
			const draining = requestUrl.searchParams.get("off") === null;
			void transport
				.handleCommand({
					version: CURRENT_HUB_PROTOCOL_VERSION,
					command: "hub.drain",
					payload: {
						draining,
						reason:
							requestUrl.searchParams.get("reason") ??
							"authenticated HTTP drain request",
					},
				})
				.then(
					(reply) => {
						res.statusCode = reply.ok ? 200 : 500;
						res.setHeader("content-type", "application/json");
						res.end(JSON.stringify(reply.payload ?? { ok: reply.ok }));
					},
					() => {
						res.statusCode = 500;
						res.end("Drain failed");
					},
				);
			return;
		}
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
			// This response races the teardown it triggers: shutdown ends in
			// process.exit(), which does not flush pending socket writes. Scheduling
			// teardown on a microtask ran it before the event loop ever reached its
			// write phase, so the accepted 202 could be lost and the caller saw a
			// socket hang up. Unix hid this because uv_try_write lands small loopback
			// writes in the kernel synchronously; Windows has no such fast path and
			// lost the race regularly.
			let teardownStarted = false;
			const startTeardown = (): void => {
				if (teardownStarted) {
					return;
				}
				teardownStarted = true;
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
			};
			res.statusCode = 202;
			res.setHeader("content-type", "application/json");
			// Ask for a clean close so the client gets a FIN after the body rather
			// than an abort from the imminent exit.
			res.setHeader("connection", "close");
			// A caller that vanishes mid-write must never strand the daemon: the
			// write callback can then go unfired, so a timer starts the same
			// (idempotent) teardown regardless. The request was already accepted.
			const teardownFallback = setTimeout(startTeardown, 1_000);
			teardownFallback.unref?.();
			res.end(JSON.stringify({ ok: true }), () => {
				// `end`'s callback fires once the body has been handed to the socket;
				// setImmediate then yields a loop turn so the write actually drains.
				setImmediate(() => {
					clearTimeout(teardownFallback);
					startTeardown();
				});
			});
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
	});
	const wss = new WebSocketServer({
		noServer: true,
		// A sealed text envelope expands the 8 MiB Hub frame through AEAD + base64.
		// Plain sockets are still checked against HUB_MAX_FRAME_BYTES in the wrapper.
		maxPayload: HUB_SECURE_MAX_WIRE_BYTES,
	});
	const handshakeWss = new WebSocketServer({
		noServer: true,
		// This receiver exists before Noise authentication, so the parser itself —
		// not a later message callback — owns the pre-authentication memory bound.
		maxPayload: HUB_HANDSHAKE_MAX_WIRE_BYTES,
	});
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
		const requestedProtocols = request.headers["sec-websocket-protocol"];
		const isTokenAuthorized = isValidHubAuthToken(
			readWebSocketAuthToken(requestedProtocols),
			authToken,
		);
		const isAuthorized =
			isTokenAuthorized ||
			(isLocalHubHostName(host) && isLocalHubOrigin(request.headers.origin));
		// The second authentication path: a socket that will prove itself with a
		// Noise handshake once it is open. It is NOT authorized yet — it is only
		// allowed to *try* — which is why it is attached behind a gate below.
		const pairingOfferId = pairingAuthority
			? readPairSubprotocolOfferId(requestedProtocols)
			: undefined;
		const wantsDeviceSession = pairingAuthority
			? hasDeviceSubprotocol(requestedProtocols)
			: false;
		const wantsHandshake = Boolean(pairingOfferId) || wantsDeviceSession;
		if (!isAuthorized && !pairingOfferId && !wantsDeviceSession) {
			rejectUnauthorizedUpgradeSocket(socket);
			return;
		}
		try {
			const upgradeServer = wantsHandshake ? handshakeWss : wss;
			upgradeServer.handleUpgrade(
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
					const authenticate = (
						gate?: HandshakeGate,
						paired?: PairedSocketAuthority,
					): (() => void) => {
						const detach = adapter.attach(
							wrapWsSocket(websocket, gate, paired?.channel),
							{
								// Device handshakes establish their own scoped identity. Only a
								// socket authenticated directly with the hub token may register a
								// workspace underneath the server-owned workspace root.
								allowRegisteredWorkspace: isTokenAuthorized && !gate,
								...(paired
									? {
											pairedDevice: {
												deviceId: paired.deviceId,
												approvalPolicy: paired.approvalPolicy,
											},
										}
									: {}),
							},
						);
						cleanup.add(detach);
						return detach;
					};
					// A socket that asked to prove itself must prove itself. The
					// `isAuthorized` shortcuts — a valid token, or merely arriving from a
					// loopback origin — are for sockets that made no such request; letting
					// one win here attaches a device to the plain JSON transport with its
					// Noise handshake never run, and its first frame then dies as an
					// unknown `kind`. React Native sets `Origin` from the socket URL, so
					// every phone pairing with a loopback hub lands in exactly that case.
					if (isAuthorized && !wantsHandshake) {
						const detach = authenticate();
						websocket.once("close", () => {
							sockets.delete(tracked);
							detach();
							cleanup.delete(detach);
						});
						return;
					}
					void runHandshakeAuthentication({
						websocket,
						tracked,
						authenticate,
						...(pairingOfferId ? { offerId: pairingOfferId } : {}),
					});
				},
			);
		} catch {
			rejectUpgradeSocket(socket);
		}
	});

	/**
	 * Drives the pairing or device-session handshake on an upgraded-but-unproven
	 * socket, then attaches it to the protocol adapter exactly as an
	 * authenticated-at-upgrade socket would have been.
	 *
	 * The handshake authenticates the peer and yields the channel used to seal
	 * every hub frame that follows it.
	 */
	async function runHandshakeAuthentication(input: {
		websocket: NodeWebSocketLike;
		tracked: TrackedNodeWebSocket;
		authenticate: (
			gate?: HandshakeGate,
			paired?: PairedSocketAuthority,
		) => () => void;
		offerId?: string;
	}): Promise<void> {
		const { websocket, tracked, authenticate, offerId } = input;
		const errorFrameType = offerId
			? HUB_PAIR_ERROR_FRAME
			: HUB_DEVICE_ERROR_FRAME;
		const closeSocket = (): void => {
			try {
				// 1008 "policy violation": the socket was fine, the credential was not.
				websocket.close?.(1008, "handshake refused");
			} catch {
				// fall through to terminate
			}
			try {
				websocket.terminate?.();
			} catch {
				// already gone
			}
			sockets.delete(tracked);
		};
		const gate = createHandshakeGate(websocket, decodeSocketData, closeSocket);
		let released: (() => void) | undefined;
		let detach: (() => void) | undefined;
		let socketClosed = false;
		websocket.once("close", () => {
			socketClosed = true;
			sockets.delete(tracked);
			gate.closed();
			released?.();
			detach?.();
			if (detach) cleanup.delete(detach);
		});
		let paired: PairedSocketAuthority | undefined;
		try {
			const frame = await gate.firstFrame(HUB_HANDSHAKE_TIMEOUT_MS);
			const authority = pairingAuthority;
			if (!authority) {
				throw new HubPairingError(
					"offer_invalid",
					"This hub does not accept paired devices.",
				);
			}
			const bind = terminableSocket({
				close: closeSocket,
				isClosed: () => !sockets.has(tracked),
			});
			if (offerId) {
				const attest = decodePairAttestFrame(frame);
				if (attest.offerId !== offerId) {
					// The subprotocol and the frame must name the same offer; otherwise the
					// hub would look one offer up and complete a different one.
					throw new HubPairingError(
						"offer_invalid",
						"Pairing frame does not match the offer this socket asked for.",
					);
				}
				const accepted = await authority.pair({
					offerId,
					message: attest.message,
					bind,
				});
				released = accepted.release;
				if (socketClosed) throw new Error("handshake_socket_closed");
				paired = {
					deviceId: accepted.deviceId,
					approvalPolicy: accepted.approvalPolicy,
					channel: accepted.channel,
				};
				websocket.send(
					encodePairOkFrame({
						offerId,
						message: accepted.response,
						deviceId: accepted.deviceId,
						hubName: accepted.hubName,
						hubPublicKey: accepted.hubPublicKey,
					}),
				);
				logHubMessage("info", "paired a device over the hub socket", {
					deviceId: accepted.deviceId,
					fingerprint: accepted.fingerprint,
				});
			} else {
				const begin = decodeDeviceBeginFrame(frame);
				const accepted = await authority.openDeviceSession({
					message: begin.message,
					bind,
				});
				released = accepted.release;
				if (socketClosed) throw new Error("handshake_socket_closed");
				paired = {
					deviceId: accepted.deviceId,
					approvalPolicy: accepted.approvalPolicy,
					channel: accepted.channel,
				};
				websocket.send(
					encodeDeviceOkFrame({
						message: accepted.response,
						deviceId: accepted.deviceId,
					}),
				);
			}
			allowAuthenticatedPayloads(websocket);
			detach = authenticate(gate, paired);
		} catch (error) {
			gate.abandon();
			released?.();
			const code =
				error instanceof HubPairingError ? error.code : "handshake_failed";
			logHubMessage("warn", "refused a pairing handshake", {
				code,
				...(offerId ? { offerId } : {}),
			});
			try {
				websocket.send(
					encodeHandshakeErrorFrame({
						type: errorFrameType,
						code,
						// Opaque on purpose for the crypto failures: which of "wrong secret",
						// "unknown device" and "tampered message" it was is not something an
						// unauthenticated peer gets to learn. The `code` is enough for the
						// app to show the right recovery.
						message: refusalMessage(code),
					}),
				);
			} catch {
				// The socket may already be gone; closing below is enough.
			}
			closeSocket();
		}
	}

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
		instanceLock.release();
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
			buildEpochMs,
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
				isManagedHubReusable(healthy) &&
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

			// A live hub that cannot be reused must be retired before a
			// successor can exist: singleton ownership is lock-enforced, so
			// starting a replacement while it lives would (correctly) fail
			// with the instance lock held. Retirement follows the same rules
			// as the detached-daemon ensure path (retireDiscoveredHub): never
			// ambush a hub that is still serving sessions, drain before the
			// shutdown request, and clear discovery only once the hub is
			// actually gone — clearing the record of a survivor would leave a
			// live daemon undiscoverable.
			if (healthy?.url) {
				const retirementRecord = {
					url: healthy.url,
					authToken: discovered.authToken,
					pid: healthy.pid ?? discovered.pid,
				};
				if (await hubHasLiveSessions(retirementRecord)) {
					// Busy: attach to the older hub instead of replacing it,
					// mirroring the daemon's deferred_busy handling. If it
					// cannot be attached either, leave it running — starting
					// below surfaces the instance-lock conflict instead of
					// tearing down live sessions.
					if (
						await verifyHubConnection(healthy.url, {
							authToken: discovered.authToken,
						})
					) {
						return rememberIfManaged({
							url: healthy.url,
							authToken: discovered.authToken,
							action: "reuse",
						});
					}
				} else {
					await retireDiscoveredHub(retirementRecord, owner.discoveryPath);
				}
			} else {
				// A discovered endpoint that cannot even be probed is stale.
				await clearHubDiscovery(owner.discoveryPath);
			}
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

		// The predecessor's lock release trails its HTTP close slightly, so a
		// lock-held failure inside the wait window retries instead of failing.
		const lockDeadline = Date.now() + ENSURE_RETIRE_WAIT_MS;
		for (;;) {
			try {
				return await start(options);
			} catch (error) {
				if (isHubLockHeldError(error) && Date.now() < lockDeadline) {
					await new Promise((resolve) =>
						setTimeout(resolve, ENSURE_RETIRE_POLL_MS),
					);
					continue;
				}
				if (!options.allowPortFallback || !isAddressInUseError(error)) {
					throw error;
				}
				return await start({ ...options, port: 0 });
			}
		}
	});
}
