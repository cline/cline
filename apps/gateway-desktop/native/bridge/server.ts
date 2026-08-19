/**
 * The loopback bridge server between the broker and the webview.
 *
 * WebSocket on 127.0.0.1 only. Every connection must authenticate with
 * the per-launch bridge secret as its FIRST frame (never in the URL);
 * everything else is the closed command schema from `shared/bridge.ts`.
 * Oversized frames close the connection; invalid or unknown commands
 * are rejected with typed errors.
 */

import { timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
	BRIDGE_PROTOCOL_VERSION,
	type BrokerFrame,
	MAX_BRIDGE_FRAME_BYTES,
	parseWebviewFrame,
} from "../../shared/bridge";
import { desktopError, type PublicDesktopError } from "../../shared/errors";
import type { DesktopBroker } from "../gateway/broker";
import type { Logger } from "../logging";

export interface BridgeServerOptions {
	broker: DesktopBroker;
	logger: Logger;
	/** Per-launch secret from the shell. Never logged. */
	secrets: readonly string[];
	/** 0 = ephemeral. Dev mode uses the fixed dev port. */
	port?: number;
}

export interface BridgeServer {
	port(): number;
	connectionCount(): number;
	close(): Promise<void>;
}

function secretMatches(offered: string, secrets: readonly string[]): boolean {
	const offeredBuffer = Buffer.from(offered, "utf8");
	for (const secret of secrets) {
		const expected = Buffer.from(secret, "utf8");
		if (
			expected.length === offeredBuffer.length &&
			timingSafeEqual(expected, offeredBuffer)
		) {
			return true;
		}
	}
	return false;
}

export function startBridgeServer(
	options: BridgeServerOptions,
): Promise<BridgeServer> {
	const { broker, logger } = options;
	const server = new WebSocketServer({
		host: "127.0.0.1",
		port: options.port ?? 0,
		maxPayload: MAX_BRIDGE_FRAME_BYTES,
	});

	const authenticated = new Set<WebSocket>();

	const send = (socket: WebSocket, frame: BrokerFrame) => {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(frame));
		}
	};

	const unsubscribe = broker.onProjection((frame) => {
		for (const socket of authenticated) {
			if (frame.kind === "replace") {
				send(socket, {
					v: BRIDGE_PROTOCOL_VERSION,
					type: "projection.replace",
					projection: frame.projection,
				});
			} else {
				send(socket, {
					v: BRIDGE_PROTOCOL_VERSION,
					type: "projection.patch",
					baseRevision: frame.baseRevision,
					revision: frame.revision,
					patch: frame.patch,
				});
			}
		}
	});

	server.on("connection", (socket) => {
		let isAuthenticated = false;

		socket.on("message", (raw, isBinary) => {
			if (isBinary) {
				socket.close(1003, "binary frames are not supported");
				return;
			}
			const parsed = parseWebviewFrame(
				Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer),
			);
			if (parsed.kind === "invalid") {
				if (!isAuthenticated) {
					socket.close(4400, "invalid frame before authentication");
					return;
				}
				logger.warn("bridge.invalidFrame", { reason: parsed.reason });
				send(socket, {
					v: BRIDGE_PROTOCOL_VERSION,
					type: "command.result",
					id: "invalid",
					ok: false,
					error: desktopError("invalid_command", parsed.reason),
				});
				return;
			}
			if (parsed.kind === "authenticate") {
				if (isAuthenticated) {
					return;
				}
				if (!secretMatches(parsed.frame.secret, options.secrets)) {
					logger.warn("bridge.authRejected", {});
					socket.close(4401, "invalid bridge secret");
					return;
				}
				isAuthenticated = true;
				authenticated.add(socket);
				send(socket, { v: BRIDGE_PROTOCOL_VERSION, type: "authenticated" });
				// Every new webview starts from a full replace.
				send(socket, {
					v: BRIDGE_PROTOCOL_VERSION,
					type: "projection.replace",
					projection: broker.projectionSnapshot,
				});
				return;
			}
			// Command frame.
			if (!isAuthenticated) {
				socket.close(4401, "authenticate first");
				return;
			}
			const { id, payload } = parsed.frame;
			void (async () => {
				try {
					const result = await broker.execute(payload);
					send(socket, {
						v: BRIDGE_PROTOCOL_VERSION,
						type: "command.result",
						id,
						ok: true,
						result,
					});
					// `app.initialize` also resyncs this connection wholesale.
					if (payload.command === "app.initialize") {
						send(socket, {
							v: BRIDGE_PROTOCOL_VERSION,
							type: "projection.replace",
							projection: broker.projectionSnapshot,
						});
					}
				} catch (error) {
					const publicError = isPublicDesktopError(error)
						? error
						: desktopError(
								"desktop_internal",
								error instanceof Error ? error.message : String(error),
							);
					send(socket, {
						v: BRIDGE_PROTOCOL_VERSION,
						type: "command.result",
						id,
						ok: false,
						error: publicError,
					});
				}
			})();
		});

		socket.on("close", () => {
			authenticated.delete(socket);
		});
		socket.on("error", () => {
			authenticated.delete(socket);
			socket.terminate();
		});
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.once("listening", () => {
			server.off("error", reject);
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("bridge server bound to a non-TCP address"));
				return;
			}
			logger.info("bridge.listening", { port: address.port });
			resolve({
				port: () => address.port,
				connectionCount: () => authenticated.size,
				close: () => {
					unsubscribe();
					for (const socket of authenticated) {
						socket.close(1001, "broker shutting down");
					}
					authenticated.clear();
					return new Promise<void>((resolveClose) => {
						server.close(() => resolveClose());
					});
				},
			});
		});
	});
}

function isPublicDesktopError(value: unknown): value is PublicDesktopError {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { code?: unknown }).code === "string" &&
		typeof (value as { message?: unknown }).message === "string" &&
		typeof (value as { retryable?: unknown }).retryable === "boolean"
	);
}
