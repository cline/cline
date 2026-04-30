import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import { verifyHubConnection } from "../client";
import {
	clearHubDiscovery,
	createHubAuthToken,
	createHubServerUrl,
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
import { NativeHubTransportAdapter } from "./native-transport";
import { HubServerTransport } from "./transport";
import type {
	EnsuredHubWebSocketServerResult,
	EnsureHubWebSocketServerOptions,
	HubWebSocketServer,
	HubWebSocketServerOptions,
} from "./types";

export { truncateNotificationBody } from "./helpers";
export { HubServerTransport } from "./transport";
export type {
	EnsuredHubWebSocketServerResult,
	EnsureHubWebSocketServerOptions,
	HubWebSocketServer,
	HubWebSocketServerOptions,
} from "./types";

type NodeWebSocketLike = {
	send(data: string): void;
	on(event: "message", listener: (data: unknown) => void): void;
	on(event: "close", listener: () => void): void;
	once(event: "close", listener: () => void): void;
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

const SHARED_SERVERS = new Map<string, Promise<HubWebSocketServer>>();
const HUB_AUTH_PROTOCOL_PREFIX = "cline-hub-auth.";

function parseHeaderValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value.join(",") : (value ?? "");
}

function readBearerToken(value: string | string[] | undefined): string | null {
	const header = parseHeaderValue(value).trim();
	const match = /^Bearer\s+(.+)$/i.exec(header);
	return match?.[1]?.trim() || null;
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

export async function startHubWebSocketServer(
	options: HubWebSocketServerOptions,
): Promise<HubWebSocketServer> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const host = options.host ?? "127.0.0.1";
	const pathname = options.pathname ?? "/hub";
	const requestedPort = options.port ?? resolveDefaultHubPort();
	let port = requestedPort;
	let url = createHubServerUrl(host, requestedPort, pathname);
	const buildId = resolveHubBuildId();
	const authToken = createHubAuthToken();
	const transport = new HubServerTransport(options);
	await transport.start();
	const adapter = new BrowserWebSocketHubAdapter(
		new NativeHubTransportAdapter(transport),
	);
	const cleanup = new Set<() => void>();
	const startedAt = new Date().toISOString();
	const versionPayload = {
		protocolVersion: "v1",
		buildId,
		pid: process.pid,
		startedAt,
	} as const;
	let closePromise: Promise<void> | undefined;

	const closeServer = async (): Promise<void> => {
		if (closePromise) {
			return closePromise;
		}
		closePromise = (async () => {
			for (const detach of cleanup) {
				detach();
			}
			cleanup.clear();
			await new Promise<void>((resolve, reject) => {
				wss.close((error?: Error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			await transport.stop();
			const current = await readHubDiscovery(owner.discoveryPath);
			if (current?.url === url) {
				await clearHubDiscovery(owner.discoveryPath);
			}
		})();
		return closePromise;
	};

	const server = http.createServer((req, res) => {
		if ((req.url ?? "/") === "/health") {
			const body = JSON.stringify({
				hubId: transport.getHubId(),
				...versionPayload,
				authToken: "",
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
				void closeServer();
			});
			return;
		}
		res.statusCode = 404;
		res.end("Not found");
	});
	const wss = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
		if (requestUrl.pathname !== pathname) {
			socket.destroy();
			return;
		}
		if (
			!isValidHubAuthToken(
				readWebSocketAuthToken(request.headers["sec-websocket-protocol"]),
				authToken,
			)
		) {
			rejectUnauthorizedUpgradeSocket(socket);
			return;
		}
		try {
			wss.handleUpgrade(
				request,
				socket,
				head,
				(websocket: NodeWebSocketLike) => {
					const detach = adapter.attach(wrapWsSocket(websocket));
					cleanup.add(detach);
					websocket.once("close", () => {
						detach();
						cleanup.delete(detach);
					});
				},
			);
		} catch {
			rejectUpgradeSocket(socket);
		}
	});

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

	await writeHubDiscovery(owner.discoveryPath, {
		hubId: transport.getHubId(),
		protocolVersion: "v1",
		buildId,
		authToken,
		host,
		port,
		url,
		pid: process.pid,
		startedAt,
		updatedAt: startedAt,
	});

	return {
		host,
		port,
		url,
		authToken,
		close: closeServer,
	};
}

export async function ensureHubWebSocketServer(
	options: EnsureHubWebSocketServerOptions,
): Promise<EnsuredHubWebSocketServerResult> {
	const owner = options.owner ?? resolveHubOwnerContext();
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? resolveDefaultHubPort();
	const pathname = options.pathname ?? "/hub";
	const expectedUrl = createHubServerUrl(host, port, pathname);
	const sharedKey = owner.discoveryPath;
	const existing = SHARED_SERVERS.get(sharedKey);
	if (existing) {
		const server = await existing;
		if (server.url === expectedUrl) {
			return {
				server,
				url: server.url,
				authToken: server.authToken,
				action: "reuse",
			};
		}
	}

	return await withHubStartupLock(owner.discoveryPath, async () => {
		const discovered = await readHubDiscovery(owner.discoveryPath);
		const canReuseDiscovered =
			discovered?.url &&
			(discovered.url === expectedUrl || options.allowPortFallback === true);
		if (canReuseDiscovered) {
			const healthy = await probeHubServer(discovered.url);
			if (
				healthy?.url &&
				(await verifyHubConnection(healthy.url, {
					authToken: discovered.authToken,
				}))
			) {
				return {
					url: healthy.url,
					authToken: discovered.authToken,
					action: "reuse",
				};
			}
		}

		const expected = await probeHubServer(expectedUrl);
		if (expected?.url || discovered?.url) {
			await clearHubDiscovery(owner.discoveryPath);
		}

		const start = async (
			startOptions: HubWebSocketServerOptions,
		): Promise<EnsuredHubWebSocketServerResult> => {
			const serverPromise = startHubWebSocketServer({ ...startOptions, owner });
			SHARED_SERVERS.set(sharedKey, serverPromise);
			try {
				const server = await serverPromise;
				return {
					server,
					url: server.url,
					authToken: server.authToken,
					action: "started",
				};
			} catch (error) {
				SHARED_SERVERS.delete(sharedKey);
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
