import type {
	HubClientRegistration,
	HubEventEnvelope,
	HubReplyEnvelope,
	HubTransportFrame,
	ITelemetryService,
} from "@cline/shared";
import {
	captureSdkError,
	HUB_COMMAND_SLOW_LOG_MS,
	resolveHubCommandTimeoutMs,
	safeJsonParse,
} from "@cline/shared";
import type { HubCommandTransport } from "./command-transport";
import { logHubMessage } from "./hub-server-logging";

type HubCommandFrame = HubTransportFrame & { kind: "command" };

export interface BrowserHubSocketLike {
	send(data: string): void;
	/**
	 * Standard WebSocket readyState when the underlying socket exposes one
	 * (0 CONNECTING / 1 OPEN / 2 CLOSING / 3 CLOSED). Lets the adapter detect
	 * dead connections whose close event never fired instead of forwarding
	 * events into the void forever.
	 */
	readonly readyState?: number;
	addEventListener(
		type: "message",
		listener: (event: { data: string }) => void,
	): void;
	addEventListener(type: "close", listener: () => void): void;
	removeEventListener(
		type: "message",
		listener: (event: { data: string }) => void,
	): void;
	removeEventListener(type: "close", listener: () => void): void;
}

function commandLogContext(frame: HubCommandFrame) {
	return {
		command: frame.envelope.command,
		requestId: frame.envelope.requestId,
		clientId: frame.envelope.clientId,
		sessionId: frame.envelope.sessionId,
	};
}

function commandErrorReply(
	frame: HubCommandFrame,
	code: string,
	message: string,
): HubReplyEnvelope {
	return {
		version: frame.envelope.version,
		requestId: frame.envelope.requestId,
		ok: false,
		error: { code, message },
	};
}

export class BrowserWebSocketHubAdapter {
	constructor(
		private readonly transport: HubCommandTransport,
		private readonly telemetry?: ITelemetryService,
	) {}

	private connectionCounter = 0;

	/**
	 * The connection that currently owns each registered clientId's event
	 * delivery. A clientId re-registering from a NEW connection supersedes
	 * the previous one: the old connection's subscriptions for that clientId
	 * are torn down and its close-time unregister is disarmed. Without this,
	 * a client that reconnects (hub swap, transport recovery) while its old
	 * connection lingers accumulates one delivery path per connection and
	 * every streamed event fans out N times — rendering as duplicated
	 * assistant text in the CLI and desktop app.
	 */
	private readonly deliveryOwnerByClientId = new Map<
		string,
		{ connectionId: number; evict: () => void }
	>();

	attach(socket: BrowserHubSocketLike): () => void {
		const subscriptions = new Map<string, () => void>();
		const registeredClientIds = new Set<string>();
		const connectionId = ++this.connectionCounter;
		let closed = false;

		logHubMessage("info", "connection.open", { connectionId });

		const sendFrame = (frame: HubTransportFrame): void => {
			try {
				socket.send(JSON.stringify(frame));
			} catch (error) {
				console.error(
					`[hub] failed to send websocket frame: ${
						error instanceof Error
							? error.stack || error.message
							: String(error)
					}`,
				);
			}
		};

		/**
		 * Drop this connection's delivery state for a clientId: subscriptions
		 * are unsubscribed and the close-time unregister is disarmed. Called
		 * when a newer connection re-registers the same clientId.
		 */
		const evictClientDelivery = (clientId: string): void => {
			for (const [key, unsubscribe] of subscriptions) {
				if (key.startsWith(`${clientId}:`)) {
					unsubscribe();
					subscriptions.delete(key);
				}
			}
			registeredClientIds.delete(clientId);
		};

		const onEvent = (envelope: HubEventEnvelope): void => {
			if (typeof socket.readyState === "number" && socket.readyState > 1) {
				// The socket is closing/closed but its close event never fired
				// (crashed peer, half-open connection). Tear down instead of
				// forwarding events into the void forever.
				logHubMessage("warn", "connection.dead_socket_detected", {
					connectionId,
					readyState: socket.readyState,
				});
				onClose();
				return;
			}
			sendFrame({ kind: "event", envelope });
		};

		const onMessage = async (event: { data: string }): Promise<void> => {
			try {
				const frame = JSON.parse(event.data) as HubTransportFrame;
				switch (frame.kind) {
					case "command": {
						const startedAt = performance.now();
						let settled = false;
						const context = commandLogContext(frame);
						logHubMessage("info", "command.start", context);
						const slowTimer = setTimeout(() => {
							if (settled) return;
							logHubMessage("warn", "command.slow", {
								...context,
								elapsedMs: Math.round(performance.now() - startedAt),
							});
						}, HUB_COMMAND_SLOW_LOG_MS);
						const commandPromise = this.transport.command(frame.envelope);
						commandPromise.then(
							(lateReply) => {
								if (!settled) return;
								logHubMessage(
									lateReply.ok ? "warn" : "error",
									"command.late_end",
									{
										...context,
										elapsedMs: Math.round(performance.now() - startedAt),
										ok: lateReply.ok,
										errorCode: lateReply.error?.code,
										errorMessage: lateReply.error?.message,
									},
								);
							},
							(error) => {
								if (!settled) return;
								logHubMessage("error", "command.late_error", {
									...context,
									elapsedMs: Math.round(performance.now() - startedAt),
									error,
								});
							},
						);
						let timedOut = false;
						let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
						let reply: HubReplyEnvelope;
						const timeoutMs = resolveHubCommandTimeoutMs(
							frame.envelope.command,
							frame.envelope.timeoutMs,
						);
						try {
							reply =
								timeoutMs === null
									? await commandPromise
									: await Promise.race([
											commandPromise,
											new Promise<HubReplyEnvelope>((resolve) => {
												timeoutTimer = setTimeout(() => {
													timedOut = true;
													captureSdkError(this.telemetry, {
														component: "core",
														operation: "hub.command_timeout",
														error: new Error(
															`Hub command ${frame.envelope.command} did not complete within ${timeoutMs}ms.`,
														),
														severity: "error",
														handled: true,
														context: {
															...context,
															timeoutMs,
														},
													});
													resolve(
														commandErrorReply(
															frame,
															"hub_command_timeout",
															`Hub command ${frame.envelope.command} did not complete within ${timeoutMs}ms. Check hub-daemon.log for command.start/command.slow logs with requestId ${frame.envelope.requestId}.`,
														),
													);
												}, timeoutMs);
											}),
										]);
						} catch (error) {
							clearTimeout(slowTimer);
							if (timeoutTimer) clearTimeout(timeoutTimer);
							throw error;
						}
						settled = timedOut;
						clearTimeout(slowTimer);
						if (timeoutTimer) clearTimeout(timeoutTimer);
						const durationMs = Math.round(performance.now() - startedAt);
						if (timedOut) {
							logHubMessage("error", "command.timeout", {
								...context,
								durationMs,
								timeoutMs,
							});
						} else {
							logHubMessage(reply.ok ? "info" : "warn", "command.end", {
								...context,
								durationMs,
								ok: reply.ok,
								errorCode: reply.error?.code,
								errorMessage: reply.error?.message,
							});
						}
						if (frame.envelope.command === "client.register" && reply.ok) {
							const registration = (frame.envelope.payload ??
								{}) as unknown as HubClientRegistration;
							const clientId =
								registration.clientId?.trim() ||
								frame.envelope.clientId?.trim();
							if (clientId) {
								const owner = this.deliveryOwnerByClientId.get(clientId);
								if (owner && owner.connectionId !== connectionId) {
									// The clientId moved to this connection: tear down
									// the previous connection's delivery for it so events
									// are not fanned out once per historical connection.
									owner.evict();
									logHubMessage("warn", "client.superseded", {
										clientId,
										previousConnectionId: owner.connectionId,
										connectionId,
									});
								}
								this.deliveryOwnerByClientId.set(clientId, {
									connectionId,
									evict: () => evictClientDelivery(clientId),
								});
								registeredClientIds.add(clientId);
								logHubMessage("info", "client.registered", {
									clientId,
									clientType: registration.clientType,
									connectionId,
								});
							}
						} else if (
							frame.envelope.command === "client.unregister" &&
							reply.ok
						) {
							const clientId = frame.envelope.clientId?.trim();
							if (clientId) {
								registeredClientIds.delete(clientId);
								const owner = this.deliveryOwnerByClientId.get(clientId);
								if (owner?.connectionId === connectionId) {
									this.deliveryOwnerByClientId.delete(clientId);
								}
								logHubMessage("info", "client.unregistered", {
									clientId,
									connectionId,
								});
							}
						}
						sendFrame({
							kind: "reply",
							envelope: reply satisfies HubReplyEnvelope,
						});
						break;
					}
					case "stream.subscribe": {
						const key = `${frame.clientId}:${frame.sessionId ?? "*"}`;
						if (subscriptions.has(key)) {
							break;
						}
						const owner = frame.clientId
							? this.deliveryOwnerByClientId.get(frame.clientId)
							: undefined;
						if (owner && owner.connectionId !== connectionId) {
							// A newer connection owns this clientId's delivery; a
							// late subscribe from a superseded connection must not
							// re-create a second delivery path.
							logHubMessage("warn", "stream.subscribe.superseded", {
								clientId: frame.clientId,
								sessionId: frame.sessionId,
								connectionId,
								owningConnectionId: owner.connectionId,
							});
							break;
						}
						const unsubscribe = await this.transport.subscribe(
							frame.clientId,
							onEvent,
							{ sessionId: frame.sessionId },
						);
						subscriptions.set(key, unsubscribe);
						logHubMessage("info", "stream.subscribed", {
							clientId: frame.clientId,
							sessionId: frame.sessionId,
							connectionId,
						});
						break;
					}
					case "stream.unsubscribe": {
						const key = `${frame.clientId}:${frame.sessionId ?? "*"}`;
						subscriptions.get(key)?.();
						subscriptions.delete(key);
						logHubMessage("info", "stream.unsubscribed", {
							clientId: frame.clientId,
							sessionId: frame.sessionId,
							connectionId,
						});
						break;
					}
					case "reply":
					case "event":
						break;
				}
			} catch (error) {
				const parsed =
					typeof event.data === "string"
						? safeJsonParse<HubTransportFrame>(event.data)
						: undefined;
				if (!parsed || parsed.kind !== "command") {
					logHubMessage("error", "rejected malformed websocket frame", {
						error,
					});
					return;
				}
				logHubMessage("error", "command.error", {
					...commandLogContext(parsed),
					error,
				});
				captureSdkError(this.telemetry, {
					component: "core",
					operation: "hub.websocket_command",
					error,
					severity: "error",
					handled: true,
					context: commandLogContext(parsed),
				});
				sendFrame({
					kind: "reply",
					envelope: commandErrorReply(
						parsed,
						"command_failed",
						error instanceof Error ? error.message : "Unknown hub error",
					),
				});
			}
		};

		const onClose = (): void => {
			if (closed) {
				return;
			}
			closed = true;
			logHubMessage("info", "connection.closed", {
				connectionId,
				registeredClientIds: [...registeredClientIds],
			});
			for (const unsubscribe of subscriptions.values()) {
				unsubscribe();
			}
			subscriptions.clear();
			for (const clientId of registeredClientIds) {
				// Generation guard: if a newer connection re-registered this
				// clientId, unregistering here would clobber the live
				// registration. Only unregister what this connection still owns.
				const owner = this.deliveryOwnerByClientId.get(clientId);
				if (owner && owner.connectionId !== connectionId) {
					continue;
				}
				this.deliveryOwnerByClientId.delete(clientId);
				void this.transport.command({
					version: "v1",
					command: "client.unregister",
					clientId,
				});
			}
			registeredClientIds.clear();
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
		};

		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);

		return onClose;
	}
}
