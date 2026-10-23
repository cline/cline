import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
	HubClientRegistration,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	HubTransportFrame,
	ITelemetryService,
} from "@cline/shared";
import {
	CURRENT_HUB_PROTOCOL_VERSION,
	captureSdkError,
	HUB_CLIENT_ID_IN_USE_ERROR_CODE,
	HUB_CLIENT_ID_MISMATCH_ERROR_CODE,
	HUB_COMMAND_SLOW_LOG_MS,
	HUB_INVALID_FRAME_ERROR_CODE,
	HUB_NOT_REGISTERED_ERROR_CODE,
	resolveHubCommandTimeoutMs,
} from "@cline/shared";
import type {
	HubCommandTransport,
	HubConnectionAuthority,
} from "./command-transport";
import { logHubMessage } from "./hub-server-logging";

const HUB_EVENT_REPLAY_PAGE_SIZE = 200;
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
	/**
	 * Transport-level liveness, used to decide whether a client id is still held.
	 * The Node wrapper reports the hub's heartbeat state, so a socket that stopped
	 * answering pings reads as dead before its `close` event lands. Absent on
	 * sockets that cannot tell, which are assumed alive.
	 */
	isAlive?(): boolean;
	/** Force this socket shut. Used to evict a dead holder of a client id. */
	close?(): void;
}

/**
 * Commands a connection may issue before `client.register` has bound an identity
 * to it.
 *
 * This is deliberately an allowlist rather than a denylist: almost every hub
 * command is authorized against *some* identity (a session's creator or
 * participants, a capability request's target client, a client record's owner),
 * and on an unregistered connection `envelope.clientId` is an unverified claim.
 * A denylist means every new command is dispatchable by an anonymous socket with
 * a forged `clientId` until somebody remembers to list it.
 *
 * `schedule.*` is the one non-registering caller the hub has: the CLI drives
 * schedules over a bare socket through `sendHubCommand`. Those commands are
 * hub-wide rather than client-scoped, so a connection identity adds nothing to
 * their authorization — the hub auth token is what gates them.
 *
 * Registered connections are still held to their bound identity on *every*
 * command, whether it appears here or not.
 */
function isPreRegistrationCommand(command: string): boolean {
	return command === "client.register" || command.startsWith("schedule.");
}

/**
 * A live socket↔identity binding. One per attached socket that completed
 * `client.register`; the adapter keeps at most one per client id so two
 * connections can never share (and therefore fight over) an identity.
 */
interface HubIdentityBinding {
	readonly socket: BrowserHubSocketLike;
	isClosed(): boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonStringFieldError(
	record: Record<string, unknown>,
	key: string,
	label: string,
): string | undefined {
	const value = record[key];
	return value === undefined || value === null || typeof value === "string"
		? undefined
		: `${label} has a non-string \`${key}\``;
}

/**
 * Validate the `payload` of a command frame against the fields the dispatcher
 * dereferences without a type guard.
 *
 * `requestedRegistrationClientId` calls `payload.clientId.trim()` before any
 * dispatch and `handleClientRegister` calls `payload.protocolVersion.trim()`, so
 * a payload carrying a non-string there throws inside the frame handler — the
 * frame is then dropped with no reply and the caller hangs until its command
 * timeout. Everything else reads the payload through `typeof` guards, so a
 * plain-object check is enough for the rest.
 */
function commandPayloadShapeError(
	envelope: Record<string, unknown>,
): string | undefined {
	const payload = envelope.payload;
	if (payload === undefined || payload === null) {
		return undefined;
	}
	if (!isPlainObject(payload)) {
		return "command envelope has a non-object `payload`";
	}
	if (envelope.command !== "client.register") {
		return undefined;
	}
	return (
		nonStringFieldError(payload, "clientId", "client.register payload") ??
		nonStringFieldError(payload, "protocolVersion", "client.register payload")
	);
}

/**
 * Validate a decoded frame against everything the dispatcher below dereferences.
 * Returns a reason string when the frame must be rejected, `undefined` when it is
 * safe to dispatch.
 *
 * A recognized `kind` is not enough: the command path reads
 * `envelope.command`/`requestId`/`clientId` while building its log context and
 * its reply, so a frame like `{"kind":"command"}` would throw inside the socket
 * listener (and, on the Node wrapper, surface as an unhandled rejection) if it
 * ever reached that code. Mirrors `frameShapeError` in `@cline/hub-client`, which
 * does the same job for the frames a client receives.
 *
 * @internal Exported for websocket frame-validation tests.
 */
export function hubServerFrameShapeError(value: unknown): string | undefined {
	if (!isPlainObject(value)) {
		return "frame is not an object";
	}
	switch (value.kind) {
		case "command": {
			const envelope = value.envelope;
			if (!isPlainObject(envelope)) {
				return "command frame has no object `envelope`";
			}
			if (
				typeof envelope.command !== "string" ||
				envelope.command.trim() === ""
			) {
				return "command envelope has no `command` name";
			}
			return (
				nonStringFieldError(envelope, "version", "command envelope") ??
				nonStringFieldError(envelope, "requestId", "command envelope") ??
				nonStringFieldError(envelope, "clientId", "command envelope") ??
				nonStringFieldError(envelope, "sessionId", "command envelope") ??
				commandPayloadShapeError(envelope)
			);
		}
		case "stream.subscribe":
		case "stream.unsubscribe": {
			if (typeof value.clientId !== "string" || value.clientId.trim() === "") {
				return `${value.kind} frame has no \`clientId\``;
			}
			return nonStringFieldError(value, "sessionId", `${value.kind} frame`);
		}
		case "reply":
		case "event":
			// The hub never acts on these; they are ignored without any field access,
			// so their shape cannot reach anything that could throw.
			return undefined;
		default:
			return "frame is missing a known `kind`";
	}
}

/**
 * Best-effort refusal for a frame that failed validation. Only a command frame
 * with a usable `requestId` can be answered — anything else has no request to
 * correlate a reply with, so the caller gets nothing but a hub log line.
 */
function invalidFrameReply(
	value: unknown,
	reason: string,
): HubReplyEnvelope | undefined {
	if (
		!isPlainObject(value) ||
		value.kind !== "command" ||
		!isPlainObject(value.envelope)
	) {
		return undefined;
	}
	const envelope = value.envelope;
	const requestId =
		typeof envelope.requestId === "string" ? envelope.requestId.trim() : "";
	if (!requestId) {
		return undefined;
	}
	return {
		// Never mirror the frame's own `version`: on this path it is unvalidated
		// attacker-controlled text, and the hub only ever speaks its own protocol
		// version anyway.
		version: CURRENT_HUB_PROTOCOL_VERSION,
		requestId,
		ok: false,
		error: {
			code: HUB_INVALID_FRAME_ERROR_CODE,
			message: `Rejected malformed command frame: ${reason}.`,
		},
	};
}

function commandLogContext(envelope: HubCommandEnvelope) {
	return {
		command: envelope.command,
		requestId: envelope.requestId,
		clientId: envelope.clientId,
		sessionId: envelope.sessionId,
	};
}

function commandErrorReply(
	envelope: HubCommandEnvelope,
	code: string,
	message: string,
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: false,
		error: { code, message },
	};
}

/** The clientId a `client.register` asks for, payload first (the client's own). */
function requestedRegistrationClientId(envelope: HubCommandEnvelope): string {
	const registration = envelope.payload as HubClientRegistration | undefined;
	return registration?.clientId?.trim() || (envelope.clientId?.trim() ?? "");
}

/** The clientId the hub actually registered, which it echoes in the reply. */
function registeredClientId(
	envelope: HubCommandEnvelope,
	reply: HubReplyEnvelope,
): string {
	const replied = reply.payload?.clientId;
	return typeof replied === "string" && replied.trim()
		? replied.trim()
		: requestedRegistrationClientId(envelope);
}

function registrationAuthority(
	envelope: HubCommandEnvelope,
	serverWorkspaceRoot?: string,
	allowRegisteredWorkspace = false,
): HubConnectionAuthority {
	const registration = (envelope.payload ??
		{}) as unknown as HubClientRegistration;
	const envelopeClientId = envelope.clientId?.trim();
	const clientId = registration.clientId?.trim() || envelopeClientId || "";
	if (envelopeClientId && clientId !== envelopeClientId) {
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
	return {
		clientId,
		workspaceContext: { workspaceRoot, cwd },
		...(allowRegisteredWorkspace ? { crossWorkspace: true } : {}),
	};
}

export class BrowserWebSocketHubAdapter {
	/**
	 * Live client id → the one connection that holds it. Single occupancy is what
	 * makes the identity binding worth anything: two sockets registered as the same
	 * client would share its session participation (so either could answer the
	 * other's approvals) and either one's disconnect would unregister the identity
	 * out from under the other.
	 */
	private readonly bindings = new Map<string, HubIdentityBinding>();

	constructor(
		private readonly transport: HubCommandTransport,
		private readonly telemetry?: ITelemetryService,
		private readonly workspaceRoot?: string,
	) {}

	/**
	 * Whether `clientId` may be claimed by `claimant`, releasing it first when the
	 * incumbent is gone.
	 *
	 * Uniqueness alone would break the ordinary reconnect: a mobile client that
	 * loses its socket re-registers the *same* id on a new one, so the rule is
	 * paired with liveness. An incumbent whose socket already closed, or which the
	 * heartbeat has given up on (half-open connection, `close` not yet delivered),
	 * loses the id and is evicted. Only a genuinely healthy incumbent wins.
	 */
	private claimClientId(
		clientId: string,
		claimant: HubIdentityBinding,
	): { ok: true } | { ok: false; reason: string } {
		const holder = this.bindings.get(clientId);
		if (holder && holder !== claimant) {
			if (!holder.isClosed() && holder.socket.isAlive?.() !== false) {
				return {
					ok: false,
					reason: `Client id ${clientId} is already registered on another live connection.`,
				};
			}
			try {
				holder.socket.close?.();
			} catch {
				// The incumbent is already unhealthy; taking the binding is enough.
			}
		}
		// Reserved, not merely checked: the register round trip is asynchronous, so
		// two connections racing the same id would both pass a bare check and both
		// register — leaving whichever lost the binding orphaned in `ctx.clients`,
		// since only the bound identity is unregistered on close. Released by
		// `dispatchRegistration` if the registration does not end up owning it.
		this.bindings.set(clientId, claimant);
		return { ok: true };
	}

	/** Drop a binding, but only while `owner` still holds it. */
	private releaseClientId(clientId: string, owner: HubIdentityBinding): void {
		if (this.bindings.get(clientId) === owner) {
			this.bindings.delete(clientId);
		}
	}

	/**
	 * Bridge one websocket to the hub transport.
	 *
	 * The connection is the identity boundary: `client.register` binds the
	 * registered clientId to this socket, and from then on every frame is either
	 * relabelled to that identity (when it names none) or refused. Handlers
	 * downstream can therefore treat `envelope.clientId` as authenticated for
	 * websocket traffic instead of self-declared.
	 */
	attach(
		socket: BrowserHubSocketLike,
		options: {
			allowRegisteredWorkspace?: boolean;
			pairedDevice?: HubConnectionAuthority["pairedDevice"];
		} = {},
	): () => void {
		const subscriptions = new Map<string, () => void>();
		/** Identity this connection registered, or undefined before `client.register`. */
		let boundClientId: string | undefined;
		let authority: HubConnectionAuthority | undefined;
		let closed = false;
		const binding: HubIdentityBinding = {
			socket,
			isClosed: () => closed,
		};
		/**
		 * Tail of this socket's registration chain. Frames are handled concurrently
		 * (`void handleFrame`), so two `client.register` frames would otherwise both
		 * pass the "not bound yet" check and register two identities — only one of
		 * which is bound, and only the bound one is unregistered on close. Every
		 * registration is serialized behind this, and every other frame waits for it
		 * so a command that races the handshake is judged against the bound identity
		 * rather than refused as unregistered.
		 */
		let registrationChain: Promise<void> = Promise.resolve();

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

		/**
		 * Enforce the socket↔identity binding for one command.
		 *
		 * Returns the envelope to dispatch (with the bound identity filled in when
		 * the caller omitted it) or the structured refusal to send back instead.
		 * A `client.register` may only ever name the identity this connection is
		 * already bound to: allowing a second identity would hand one socket two
		 * authorization contexts, which is the impersonation this binding exists to
		 * prevent.
		 */
		const bindEnvelopeIdentity = (
			envelope: HubCommandEnvelope,
		): { envelope: HubCommandEnvelope } | { reply: HubReplyEnvelope } => {
			const claimed = envelope.clientId?.trim() ?? "";
			if (envelope.command === "client.register") {
				const requested = requestedRegistrationClientId(envelope);
				if (boundClientId && requested !== boundClientId) {
					return {
						reply: commandErrorReply(
							envelope,
							HUB_CLIENT_ID_MISMATCH_ERROR_CODE,
							`This connection is registered as ${boundClientId}; it cannot also register as ${requested || "(anonymous)"}. Open a new connection instead.`,
						),
					};
				}
				if (!boundClientId && requested) {
					const claim = this.claimClientId(requested, binding);
					if (!claim.ok) {
						return {
							reply: commandErrorReply(
								envelope,
								HUB_CLIENT_ID_IN_USE_ERROR_CODE,
								claim.reason,
							),
						};
					}
				}
				return { envelope };
			}
			if (!boundClientId) {
				if (!isPreRegistrationCommand(envelope.command)) {
					return {
						reply: commandErrorReply(
							envelope,
							HUB_NOT_REGISTERED_ERROR_CODE,
							`${envelope.command} requires a registered connection; send client.register first.`,
						),
					};
				}
				return { envelope };
			}
			if (!claimed) {
				return { envelope: { ...envelope, clientId: boundClientId } };
			}
			if (claimed !== boundClientId) {
				return {
					reply: commandErrorReply(
						envelope,
						HUB_CLIENT_ID_MISMATCH_ERROR_CODE,
						`This connection is registered as ${boundClientId} and cannot act as ${claimed}.`,
					),
				};
			}
			return { envelope };
		};

		const runCommand = async (
			envelope: HubCommandEnvelope,
			commandAuthority: HubConnectionAuthority | null = authority ?? null,
			registrationOnSuccess?: HubConnectionAuthority,
		): Promise<void> => {
			const startedAt = performance.now();
			let settled = false;
			const context = commandLogContext(envelope);
			try {
				logHubMessage("info", "command.start", context);
				const slowTimer = setTimeout(() => {
					if (settled) return;
					logHubMessage("warn", "command.slow", {
						...context,
						elapsedMs: Math.round(performance.now() - startedAt),
					});
				}, HUB_COMMAND_SLOW_LOG_MS);
				const commandPromise = this.transport.command(
					envelope,
					commandAuthority,
				);
				commandPromise.then(
					(lateReply) => {
						if (!settled) return;
						logHubMessage(lateReply.ok ? "warn" : "error", "command.late_end", {
							...context,
							elapsedMs: Math.round(performance.now() - startedAt),
							ok: lateReply.ok,
							errorCode: lateReply.error?.code,
							errorMessage: lateReply.error?.message,
						});
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
					envelope.command,
					envelope.timeoutMs,
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
													`Hub command ${envelope.command} did not complete within ${timeoutMs}ms.`,
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
													envelope,
													"hub_command_timeout",
													`Hub command ${envelope.command} did not complete within ${timeoutMs}ms. Check hub-daemon.log for command.start/command.slow logs with requestId ${envelope.requestId}.`,
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
				if (envelope.command === "client.register" && reply.ok) {
					const clientId = registeredClientId(envelope, reply);
					if (clientId) {
						if (boundClientId && boundClientId !== clientId) {
							this.releaseClientId(boundClientId, binding);
						}
						boundClientId = clientId;
						this.bindings.set(clientId, binding);
						authority = registrationOnSuccess
							? { ...registrationOnSuccess, clientId }
							: (commandAuthority ?? { clientId });
					}
				} else if (envelope.command === "client.unregister" && reply.ok) {
					// The identity is gone, so the binding goes with it: this socket is
					// back to "unregistered" and may register a fresh identity.
					if (boundClientId && envelope.clientId?.trim() === boundClientId) {
						this.releaseClientId(boundClientId, binding);
						boundClientId = undefined;
						authority = undefined;
					}
				}
				sendFrame({
					kind: "reply",
					envelope: reply satisfies HubReplyEnvelope,
				});
			} catch (error) {
				logHubMessage("error", "command.error", { ...context, error });
				captureSdkError(this.telemetry, {
					component: "core",
					operation: "hub.websocket_command",
					error,
					severity: "error",
					handled: true,
					context,
				});
				sendFrame({
					kind: "reply",
					envelope: commandErrorReply(
						envelope,
						"command_failed",
						error instanceof Error ? error.message : "Unknown hub error",
					),
				});
			}
		};

		/**
		 * Whether a `stream.subscribe`/`stream.unsubscribe` frame may act on the
		 * clientId it names. Stream frames carry no `requestId`, so a refusal is a
		 * log line rather than a reply.
		 */
		const isStreamFrameAuthorized = (frame: {
			kind: "stream.subscribe" | "stream.unsubscribe";
			clientId: string;
		}): boolean => {
			if (!boundClientId) {
				logHubMessage("warn", "stream.refused", {
					kind: frame.kind,
					clientId: frame.clientId,
					errorCode: HUB_NOT_REGISTERED_ERROR_CODE,
				});
				return false;
			}
			if (frame.clientId.trim() !== boundClientId) {
				logHubMessage("warn", "stream.refused", {
					kind: frame.kind,
					clientId: frame.clientId,
					boundClientId,
					errorCode: HUB_CLIENT_ID_MISMATCH_ERROR_CODE,
				});
				return false;
			}
			return true;
		};

		/**
		 * Run one `client.register`. Kept apart from the generic command path so it
		 * can be serialized: the identity checks it performs (this socket is not
		 * already bound to another id, and no live connection holds the requested
		 * one) are only sound if no other registration is settling concurrently.
		 */
		const dispatchRegistration = async (
			envelope: HubCommandEnvelope,
		): Promise<void> => {
			let registration: HubConnectionAuthority;
			try {
				registration = registrationAuthority(
					envelope,
					this.workspaceRoot,
					options.allowRegisteredWorkspace,
				);
				if (options.pairedDevice) {
					registration = {
						...registration,
						pairedDevice: options.pairedDevice,
					};
				}
			} catch (error) {
				const reply = commandErrorReply(
					envelope,
					"invalid_client_registration",
					error instanceof Error
						? error.message
						: "Invalid client registration",
				);
				sendFrame({ kind: "reply", envelope: reply });
				return;
			}
			const wasBound = boundClientId !== undefined;
			const bound = bindEnvelopeIdentity(envelope);
			if ("reply" in bound) {
				logHubMessage("warn", "command.refused", {
					...commandLogContext(envelope),
					boundClientId,
					errorCode: bound.reply.error?.code,
				});
				sendFrame({ kind: "reply", envelope: bound.reply });
				return;
			}
			// `bindEnvelopeIdentity` reserved this id for us; hand it back unless the
			// registration actually ended up bound to it (refused, failed, or the hub
			// allocated a different one).
			const reserved = wasBound ? "" : requestedRegistrationClientId(envelope);
			try {
				// Registration itself is still untrusted; only a successful reply pins
				// the validated candidate as this socket's authority.
				await runCommand(bound.envelope, authority ?? null, registration);
			} finally {
				if (reserved && boundClientId !== reserved) {
					this.releaseClientId(reserved, binding);
				}
			}
		};

		const handleFrame = async (data: string): Promise<void> => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(data);
			} catch (error) {
				logHubMessage("error", "rejected malformed websocket frame", { error });
				return;
			}
			// Shape validation happens before any dispatch or log-context access, so a
			// recognized-but-broken frame can never throw out of this listener.
			const shapeError = hubServerFrameShapeError(parsed);
			if (shapeError) {
				logHubMessage("error", "rejected malformed websocket frame", {
					error: shapeError,
				});
				const refusal = invalidFrameReply(parsed, shapeError);
				if (refusal) {
					sendFrame({ kind: "reply", envelope: refusal });
				}
				return;
			}
			const frame = parsed as HubTransportFrame;
			if (
				frame.kind === "command" &&
				frame.envelope.command === "client.register"
			) {
				const registration = registrationChain.then(() =>
					dispatchRegistration(frame.envelope),
				);
				// Swallow on the shared tail only: `onMessage` still reports the
				// failure, but one broken registration must not poison the chain and
				// wedge every later frame on this socket.
				registrationChain = registration.then(
					() => undefined,
					() => undefined,
				);
				await registration;
				return;
			}
			// Everything else waits for an in-flight handshake so a command that
			// raced `client.register` is authorized against the bound identity.
			await registrationChain;
			switch (frame.kind) {
				case "command": {
					const bound = bindEnvelopeIdentity(frame.envelope);
					if ("reply" in bound) {
						logHubMessage("warn", "command.refused", {
							...commandLogContext(frame.envelope),
							boundClientId,
							errorCode: bound.reply.error?.code,
						});
						sendFrame({ kind: "reply", envelope: bound.reply });
						break;
					}
					await runCommand(bound.envelope);
					break;
				}
				case "stream.subscribe": {
					// Subscriptions are identity-scoped: the hub keys listeners by
					// clientId and scopes event delivery to what that client may see, so
					// a socket may only stream as the client it registered. An
					// unregistered socket has no identity to scope against, and letting
					// it name one would hand it whatever that client can see.
					if (!isStreamFrameAuthorized(frame)) {
						break;
					}
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
						const unsubscribe = await this.transport.subscribe(
							frame.clientId,
							onEvent,
							{ sessionId: frame.sessionId },
						);
						subscriptions.set(key, unsubscribe);
						break;
					}

					// Subscribe first and buffer live traffic while replay is delivered. The
					// sequence cursor closes the replay/live gap; event ids deduplicate
					// sequence-less pending-approval recovery events during that window.
					let replayDone = false;
					let lastDelivered = sinceSequence;
					const buffered: HubEventEnvelope[] = [];
					let deliveredEventIds: Set<string> | undefined = new Set<string>();
					const deliver = (envelope: HubEventEnvelope): void => {
						if (typeof envelope.sequence === "number") {
							if (envelope.sequence <= lastDelivered) return;
							lastDelivered = envelope.sequence;
						}
						if (envelope.eventId && deliveredEventIds) {
							if (deliveredEventIds.has(envelope.eventId)) return;
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
							const page = await this.transport.replayEventsAfter(
								lastDelivered,
								{
									sessionId: frame.sessionId,
									clientId: frame.clientId,
									limit: HUB_EVENT_REPLAY_PAGE_SIZE,
								},
							);
							if (page.length === 0) break;
							for (const envelope of page) deliver(envelope);
							if (lastDelivered <= pageCursor) break;
							pages += 1;
							await new Promise<void>((resolveYield) =>
								setTimeout(resolveYield, 0),
							);
						}
					} finally {
						replayDone = true;
						for (const envelope of buffered) deliver(envelope);
						buffered.length = 0;
						deliveredEventIds = undefined;
					}
					break;
				}
				case "stream.unsubscribe": {
					if (!isStreamFrameAuthorized(frame)) {
						break;
					}
					const key = `${frame.clientId}:${frame.sessionId ?? "*"}`;
					subscriptions.get(key)?.();
					subscriptions.delete(key);
					break;
				}
				case "reply":
				case "event":
					break;
			}
		};

		// Socket listeners must never see a rejected promise: on the Node wrapper the
		// return value is dropped, which would turn any escape into an unhandled
		// rejection (and, with `--unhandled-rejections=throw`, kill the hub process).
		const onMessage = (event: { data: string }): void => {
			const data =
				typeof event.data === "string" ? event.data : String(event.data);
			void handleFrame(data).catch((error) => {
				logHubMessage("error", "websocket frame handling failed", { error });
				captureSdkError(this.telemetry, {
					component: "core",
					operation: "hub.websocket_frame",
					error,
					severity: "error",
					handled: true,
				});
			});
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
			// Only the connection that still owns the binding may unregister it.
			// Otherwise a socket that failed to claim a live id (or lost it to a
			// reconnect) would evict the identity's real owner on its way out,
			// deleting the client record and detaching it from every session.
			if (boundClientId && this.bindings.get(boundClientId) === binding) {
				const clientId = boundClientId;
				const connectionAuthority = authority;
				boundClientId = undefined;
				authority = undefined;
				this.bindings.delete(clientId);
				void Promise.resolve(
					this.transport.command(
						{
							version: "v1",
							command: "client.unregister",
							clientId,
						},
						connectionAuthority ?? null,
					),
				).catch((error) => {
					logHubMessage("error", "client.unregister failed on close", {
						clientId,
						error,
					});
				});
			}
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onClose);
		};

		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onClose);

		return onClose;
	}
}
