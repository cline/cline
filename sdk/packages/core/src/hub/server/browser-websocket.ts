import { isAbsolute, relative, resolve, sep } from "node:path";
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
import type {
	HubCommandTransport,
	HubConnectionAuthority,
} from "./command-transport";
import { logHubMessage } from "./hub-server-logging";

type HubCommandFrame = HubTransportFrame & { kind: "command" };

const HUB_EVENT_REPLAY_PAGE_SIZE = 200;
/**
 * Hard ceiling on replay pages per subscribe. At the default page size this
 * covers the event log's full retention cap; a replay source that still has
 * more after this is misbehaving, and live delivery takes over from wherever
 * the cursor reached.
 */
const HUB_EVENT_REPLAY_MAX_PAGES = 1_000;

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

function registrationAuthority(
	frame: HubCommandFrame,
	serverWorkspaceRoot?: string,
	allowRegisteredWorkspace = false,
): HubConnectionAuthority {
	const registration = (frame.envelope.payload ??
		{}) as unknown as HubClientRegistration;
	const envelopeClientId = frame.envelope.clientId?.trim();
	const clientId = registration.clientId?.trim() || envelopeClientId;
	if (!clientId || (envelopeClientId && clientId !== envelopeClientId)) {
		throw new Error("Registration clientId must match the command connection");
	}
	const requestedRoot = registration.workspaceContext?.workspaceRoot?.trim();
	const authorizedRoot = allowRegisteredWorkspace
		? requestedRoot || serverWorkspaceRoot?.trim()
		: serverWorkspaceRoot?.trim();
	if (!authorizedRoot) return { clientId };
	const workspaceRoot = resolve(authorizedRoot);
	if (
		!allowRegisteredWorkspace &&
		requestedRoot &&
		resolve(requestedRoot) !== workspaceRoot
	) {
		throw new Error(
			"Registration workspace must match the Hub-authorized workspace",
		);
	}
	const cwd = resolve(
		registration.workspaceContext?.cwd?.trim() || workspaceRoot,
	);
	const relativeCwd = relative(workspaceRoot, cwd);
	if (
		relativeCwd === ".." ||
		relativeCwd.startsWith(`..${sep}`) ||
		isAbsolute(relativeCwd)
	) {
		throw new Error("Registration cwd must be inside its workspace");
	}
	return { clientId, workspaceContext: { workspaceRoot, cwd } };
}

export class BrowserWebSocketHubAdapter {
	constructor(
		private readonly transport: HubCommandTransport,
		private readonly telemetry?: ITelemetryService,
		private readonly workspaceRoot?: string,
	) {}

	attach(
		socket: BrowserHubSocketLike,
		options: { allowRegisteredWorkspace?: boolean } = {},
	): () => void {
		const subscriptions = new Map<string, () => void>();
		const registeredClientIds = new Set<string>();
		let authority: HubConnectionAuthority | undefined;
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
						let registration: HubConnectionAuthority | undefined;
						if (authority && frame.envelope.command === "client.register") {
							sendFrame({
								kind: "reply",
								envelope: commandErrorReply(
									frame,
									"client_already_registered",
									"This connection already owns a registered client.",
								),
							});
							break;
						}
						if (
							authority &&
							frame.envelope.clientId?.trim() !== authority.clientId
						) {
							sendFrame({
								kind: "reply",
								envelope: commandErrorReply(
									frame,
									"client_authority_mismatch",
									"Command clientId does not belong to this connection.",
								),
							});
							break;
						}
						if (frame.envelope.command === "client.register") {
							try {
								registration = registrationAuthority(
									frame,
									this.workspaceRoot,
									options.allowRegisteredWorkspace,
								);
							} catch (error) {
								sendFrame({
									kind: "reply",
									envelope: commandErrorReply(
										frame,
										"invalid_client_registration",
										error instanceof Error ? error.message : String(error),
									),
								});
								break;
							}
						}
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
						const commandPromise = this.transport.command(
							frame.envelope,
							authority ?? null,
						);
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
							if (registration) {
								registeredClientIds.add(registration.clientId);
								authority = registration;
							}
						} else if (
							frame.envelope.command === "client.unregister" &&
							reply.ok
						) {
							const clientId = frame.envelope.clientId?.trim();
							if (clientId) {
								registeredClientIds.delete(clientId);
								authority = undefined;
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
						const sinceSequence =
							typeof frame.sinceSequence === "number" &&
							Number.isFinite(frame.sinceSequence) &&
							frame.sinceSequence >= 0
								? Math.floor(frame.sinceSequence)
								: undefined;
						if (
							sinceSequence === undefined ||
							typeof this.transport.replayEventsAfter !== "function"
						) {
							// Live-only delivery: the legacy contract, byte-for-byte.
							const unsubscribe = await this.transport.subscribe(
								frame.clientId,
								onEvent,
								{ sessionId: frame.sessionId },
							);
							subscriptions.set(key, unsubscribe);
							break;
						}
						// Replay-then-live: subscribe first and buffer live events while
						// durable pages stream out, then flush the buffer past the last
						// replayed sequence — no gap, no duplicates, resumable by cursor.
						let replayDone = false;
						let lastDelivered = sinceSequence;
						const buffered: HubEventEnvelope[] = [];
						// A pending approval buffered from the live gate (re-issued by
						// subscribe() sequence-less, since it predates any durable-log
						// append) and its durable-log replay copy (sequence-stamped by
						// HubEventLogStore.append, which returns a new object rather than
						// mutating the original) share the same eventId. The sequence
						// cursor alone can't catch that: dedupe by eventId too, or the
						// buffer flush below re-delivers it after replay already did.
						// The set exists only for that replay/flush window — it is
						// dropped once the flush completes so it cannot grow for the
						// lifetime of the socket.
						let deliveredEventIds: Set<string> | undefined = new Set<string>();
						const deliver = (envelope: HubEventEnvelope): void => {
							if (typeof envelope.sequence === "number") {
								if (envelope.sequence <= lastDelivered) {
									return;
								}
								// Advance the cursor before any eventId dedupe: a skipped
								// duplicate must still move replay forward, or the next
								// page refetches it forever.
								lastDelivered = envelope.sequence;
							}
							if (envelope.eventId && deliveredEventIds) {
								if (deliveredEventIds.has(envelope.eventId)) {
									return;
								}
								deliveredEventIds.add(envelope.eventId);
							}
							onEvent(envelope);
						};
						const gate = (envelope: HubEventEnvelope): void => {
							if (!replayDone) {
								buffered.push(envelope);
								return;
							}
							deliver(envelope);
						};
						const unsubscribe = await this.transport.subscribe(
							frame.clientId,
							gate,
							{ sessionId: frame.sessionId },
						);
						subscriptions.set(key, unsubscribe);
						try {
							let pages = 0;
							while (!closed && pages < HUB_EVENT_REPLAY_MAX_PAGES) {
								const pageCursor = lastDelivered;
								const page = this.transport.replayEventsAfter(lastDelivered, {
									sessionId: frame.sessionId,
									limit: HUB_EVENT_REPLAY_PAGE_SIZE,
								});
								if (page.length === 0) {
									break;
								}
								for (const envelope of page) {
									deliver(envelope);
								}
								if (lastDelivered <= pageCursor) {
									// The cursor did not move, so the next fetch would return
									// this same page again. Stop instead of spinning.
									break;
								}
								pages += 1;
								// Yield between pages so replay never starves the socket.
								await new Promise<void>((resolveYield) =>
									setTimeout(resolveYield, 0),
								);
							}
						} finally {
							replayDone = true;
							for (const envelope of buffered) {
								deliver(envelope);
							}
							buffered.length = 0;
							// Replay/flush dedupe is over; from here the subscription is
							// live-only and must not accumulate per-event state.
							deliveredEventIds = undefined;
						}
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
