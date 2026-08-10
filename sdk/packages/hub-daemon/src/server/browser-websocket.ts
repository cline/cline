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

	attach(socket: BrowserHubSocketLike): () => void {
		const subscriptions = new Map<string, () => void>();
		const registeredClientIds = new Set<string>();
		let closed = false;

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

		const onEvent = (envelope: HubEventEnvelope): void => {
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
								registeredClientIds.add(clientId);
							}
						} else if (
							frame.envelope.command === "client.unregister" &&
							reply.ok
						) {
							const clientId = frame.envelope.clientId?.trim();
							if (clientId) {
								registeredClientIds.delete(clientId);
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
						const unsubscribe = await this.transport.subscribe(
							frame.clientId,
							onEvent,
							{ sessionId: frame.sessionId },
						);
						subscriptions.set(key, unsubscribe);
						break;
					}
					case "stream.unsubscribe": {
						const key = `${frame.clientId}:${frame.sessionId ?? "*"}`;
						subscriptions.get(key)?.();
						subscriptions.delete(key);
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
			for (const unsubscribe of subscriptions.values()) {
				unsubscribe();
			}
			subscriptions.clear();
			for (const clientId of registeredClientIds) {
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
