import type {
	AgentExtension,
	AgentTool,
	HubClientRecord,
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
	SessionRecord as HubSessionRecord,
	ITelemetryService,
	JsonValue,
	PendingApprovalInfo,
	SessionParticipant,
} from "@cline/shared";
import { createSessionId } from "@cline/shared";
import type {
	CommandExecutionRuntimeService,
	ModelCatalogRuntimeService,
	PendingPromptsRuntimeService,
	RuntimeHost,
	SessionConnectionRuntimeService,
	SessionUsageRuntimeService,
} from "../../../runtime/host/runtime-host";
import type { SessionHistorySearchService } from "../../../session/search";
import {
	type CoreSessionSnapshot,
	createCoreSessionSnapshot,
} from "../../../session/session-snapshot";
import {
	type HubSessionState,
	toHubSessionRecord,
} from "../hub-session-records";

/**
 * In-memory record of a tool approval the hub is waiting on. Carries the full
 * request (not just the routing id) so `approval.list_pending` can rebuild what
 * `approval.requested` published for clients that connected too late to see it.
 */
export type PendingApproval = Omit<PendingApprovalInfo, "inputJson"> & {
	/** Raw tool input; serialized to `inputJson` at the wire boundary. */
	input: unknown;
	/** Epoch ms after which the hub auto-denies; always set on this path. */
	expiresAt: number;
	/**
	 * Timer that fires the auto-deny. Cleared by every removal path (respond,
	 * cancel, expiry, hub shutdown) so an abandoned approval cannot keep a timer —
	 * or the parked promise it resolves — alive.
	 */
	expiryTimer?: ReturnType<typeof setTimeout>;
	resolve: (result: { approved: boolean; reason?: string }) => void;
	/**
	 * The `approval.requested` event as originally published. Pending
	 * approvals survive client disconnects, so a (re)subscribing client is
	 * re-issued this event instead of being left with a silently parked turn.
	 */
	requestedEvent?: HubEventEnvelope;
};

export type PendingCapabilityRequest = {
	sessionId: string;
	targetClientId: string;
	capabilityName: string;
	onProgress?: (payload: Record<string, unknown>) => void;
	resolve: (result: {
		ok: boolean;
		payload?: Record<string, unknown>;
		error?: string;
	}) => void;
};

/**
 * Shared mutable state and helpers passed to every command-handler module.
 * The transport class owns the maps; handlers get a stable read/write surface.
 */
/**
 * How much a connection that got past the hub's auth token is trusted with other
 * clients' sessions.
 *
 * - `"session-scoped"` — the conservative rule, and the default whenever nobody
 *   says otherwise. A client reaches a session only by creating it, by being
 *   enrolled in `attachAllowlist`, or through an injected {@link HubAttachAuthorizer}.
 *   Session events are delivered the same way. This is the only correct model for
 *   a hub reachable beyond loopback (a relayed hub, a hub bound to `0.0.0.0`),
 *   where "holds the auth token" does not imply "is the machine owner".
 *
 * - `"loopback-single-owner"` — the documented single-trust model for a hub bound
 *   to a loopback interface. There, the auth token is readable only by processes
 *   running as the user who started the hub, so every authenticated connection
 *   *is* the machine owner: the CLI, the desktop app, the dashboard and the local
 *   mobile bridge are all the same person, and the hub lets them attach to and
 *   observe each other's sessions. Command-level and event-level trust are
 *   deliberately the same decision here — scoping events while leaving attach
 *   open would only mean an attacker calls `session.attach` first.
 *
 * `startHubWebSocketServer` picks the model explicitly from its bind host and
 * never selects `loopback-single-owner` for a non-loopback one.
 */
export type HubSessionTrustModel = "session-scoped" | "loopback-single-owner";

/** What an attach authorizer is told about one `session.attach` attempt. */
export interface HubAttachAuthorizationRequest {
	sessionId: string;
	/** Authenticated identity of the caller; `""` when it named none. */
	clientId: string;
	/** The caller's registration record, when it registered. */
	client: HubClientRecord | undefined;
	/** Whether the hub already records the caller as creator or participant. */
	related: boolean;
	/** Identities the hub operator enrolled for cross-client attach. */
	allowedClientIds: ReadonlySet<string>;
	trustModel: HubSessionTrustModel;
}

/**
 * Authorization seam for `session.attach`.
 *
 * Attach is what turns a client into a session participant, which is what every
 * other session ACL keys off — so it cannot itself be a free upgrade. The hub
 * ships {@link defaultAuthorizeAttach}; a pairing or relay layer that knows about
 * device identities supplies its own without this module needing to know that
 * layer exists.
 */
export type HubAttachAuthorizer = (
	request: HubAttachAuthorizationRequest,
) => boolean | Promise<boolean>;

/**
 * The conservative rule: creator, enrolled identity, or an explicitly
 * single-trust hub. Never an anonymous caller.
 */
export function defaultAuthorizeAttach(
	request: HubAttachAuthorizationRequest,
): boolean {
	if (!request.clientId) {
		return false;
	}
	return (
		request.related ||
		request.allowedClientIds.has(request.clientId) ||
		request.trustModel === "loopback-single-owner"
	);
}

/**
 * Events that describe the hub itself rather than one session, and are therefore
 * delivered to every subscriber.
 *
 * Enumerated on purpose: the alternative — treating "no sessionId" as public —
 * silently publishes each new event type to everyone until somebody notices. An
 * event that carries a `sessionId` is *never* global, whatever its name, so the
 * session-scoped `ui.notify` projected from a run stays scoped while the hub-wide
 * one does not.
 */
const GLOBAL_HUB_EVENTS: ReadonlySet<HubEventEnvelope["event"]> = new Set([
	"hub.client.registered",
	"hub.client.disconnected",
	"hub.client.updated",
	"settings.changed",
	"schedule.created",
	"schedule.updated",
	"schedule.deleted",
	"schedule.triggered",
	"schedule.execution_completed",
	"schedule.execution_failed",
	"ui.notify",
	"ui.show_window",
	// Hub-mesh lifecycle: which peers/spokes exist, not what they are running.
	"peer.registered",
	"peer.session_attached",
	"peer.session_detached",
	"spoke.started",
	"spoke.failed",
	"spoke.stopped",
]);

const WORKSPACE_TASK_EVENTS: ReadonlySet<HubEventEnvelope["event"]> = new Set([
	"task.created",
	"task.updated",
	"task.deleted",
	"task.automation.updated",
]);

function canClientObserveWorkspaceTaskEvent(
	ctx: HubTransportContext,
	clientId: string,
	event: HubEventEnvelope,
): boolean {
	const client = ctx.clients.get(clientId);
	if (!client) return false;
	const task = event.payload?.task;
	if (!task || typeof task !== "object" || Array.isArray(task)) return false;
	const workspaceRoot = (task as Record<string, unknown>).workspaceRoot;
	// Global tasks are deliberately visible to registered clients; workspace
	// tasks must stay inside the workspace authority captured at registration.
	return (
		workspaceRoot === undefined ||
		workspaceRoot === null ||
		(typeof workspaceRoot === "string" &&
			workspaceRoot === client.workspaceContext?.workspaceRoot)
	);
}

/**
 * Whether `clientId` may be handed `event`.
 *
 * Deny by default. The hub keys listeners by clientId but used to fan every event
 * to every listener regardless, which made the subscription the whole ACL: one
 * connection saw every session's `approval.requested` (tool inputs included),
 * snapshots and transcripts. Session-keyed events now go only to that session's
 * creator and participants, and everything else must be an enumerated hub
 * lifecycle event.
 */
export function canClientObserveEvent(
	ctx: HubTransportContext,
	clientId: string,
	event: HubEventEnvelope,
): boolean {
	if (!event.sessionId) {
		if (WORKSPACE_TASK_EVENTS.has(event.event)) {
			return canClientObserveWorkspaceTaskEvent(ctx, clientId, event);
		}
		return GLOBAL_HUB_EVENTS.has(event.event);
	}
	if (!clientId) {
		return false;
	}
	return (
		isClientRelatedToSession(ctx, event.sessionId, clientId) ||
		ctx.sessionTrustModel === "loopback-single-owner"
	);
}

export interface HubTransportContext {
	readonly sessionSearch: SessionHistorySearchService;
	readonly clients: Map<string, HubClientRecord>;
	readonly sessionState: Map<string, HubSessionState>;
	readonly pendingApprovals: Map<string, PendingApproval>;
	readonly pendingCapabilityRequests: Map<string, PendingCapabilityRequest>;
	readonly suppressNextTerminalEventBySession: Map<string, string>;
	/**
	 * Lifetime of a pending tool approval before it auto-denies. Falls back to
	 * `DEFAULT_HUB_APPROVAL_TIMEOUT_MS` when unset or not a positive number.
	 */
	readonly approvalTimeoutMs?: number;
	/** See {@link HubSessionTrustModel}. Conservative unless set explicitly. */
	readonly sessionTrustModel: HubSessionTrustModel;
	/** Identities enrolled for cross-client `session.attach`. */
	readonly attachAllowlist: ReadonlySet<string>;
	/** See {@link HubAttachAuthorizer}. */
	readonly authorizeAttach: HubAttachAuthorizer;
	/**
	 * Count of RPC-driven turns (`run.start` / session input commands)
	 * currently awaiting `sessionHost.runTurn` per session. While > 0 the
	 * awaiting handler publishes the authoritative terminal run event, so the
	 * session-event projector must not publish its own `run.failed` for
	 * agent-level error events emitted during that turn. Turns drained from
	 * the pending-prompt queue run with no awaiting RPC handler (count 0), so
	 * the projector is their only failure reporter.
	 */
	readonly activeRpcTurnCountBySession: Map<string, number>;
	readonly telemetry?: ITelemetryService;
	/** Hub-owned tools injected into every local session runtime. */
	readonly sessionTools?: readonly AgentTool[];
	/** Hub-owned extensions injected into every local session runtime. */
	readonly sessionExtensions?: readonly AgentExtension[];
	readonly sessionHost: RuntimeHost &
		Partial<
			CommandExecutionRuntimeService &
				PendingPromptsRuntimeService &
				SessionUsageRuntimeService &
				SessionConnectionRuntimeService &
				ModelCatalogRuntimeService
		>;
	/**
	 * While draining, new mutating work (session.create, run.*) is refused
	 * with the retryable `hub_draining` error so the Hub can be replaced at a
	 * boundary an operator chose instead of being ambushed mid-turn.
	 * Optional: absent contexts (test fixtures) are never draining.
	 */
	isDraining?(): boolean;
	publish(event: HubEventEnvelope): void;
	buildEvent(
		event: HubEventEnvelope["event"],
		payload?: Record<string, unknown>,
		sessionId?: string,
	): HubEventEnvelope;
	requestCapability(
		sessionId: string,
		capabilityName: string,
		payload: Record<string, unknown>,
		targetClientId: string,
		onProgress?: (payload: Record<string, unknown>) => void,
	): Promise<Record<string, unknown> | undefined>;
}

type EnvelopeRef = Pick<HubCommandEnvelope, "version" | "requestId">;

export function okReply(
	envelope: EnvelopeRef,
	payload?: HubReplyEnvelope["payload"],
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: true,
		...(payload !== undefined ? { payload } : {}),
	};
}

export function errorReply(
	envelope: EnvelopeRef,
	code: string,
	message: string,
	details?: Record<string, unknown>,
): HubReplyEnvelope {
	return {
		version: envelope.version,
		requestId: envelope.requestId,
		ok: false,
		error: { code, message, ...(details !== undefined ? { details } : {}) },
	};
}

/** Returns the value when it's a plain object, or undefined otherwise. */
export function asPlainRecord(
	value: unknown,
): Record<string, JsonValue | undefined> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, JsonValue | undefined>)
		: undefined;
}

/**
 * Pulls the session id from the envelope. Handlers accept either
 * `payload.sessionId` (top-level command argument) or `envelope.sessionId`
 * (envelope-level addressing). Returns "" when neither is present so handlers
 * can branch on truthiness.
 */
export function extractSessionId(envelope: HubCommandEnvelope): string {
	if (typeof envelope.payload?.sessionId === "string") {
		return envelope.payload.sessionId.trim();
	}
	return envelope.sessionId?.trim() ?? "";
}

/** The client id an envelope claims, or `""` when it named none. */
export function extractClientId(envelope: HubCommandEnvelope): string {
	return envelope.clientId?.trim() ?? "";
}

/**
 * Identity used to own a session created by a caller that named no `clientId`.
 *
 * The literal `"hub-client"` used to fill that gap, which made every such session
 * owned by a name anybody could simply register as — and creator is an
 * authorization fact. This is generated once per hub process, so an anonymous
 * in-process caller still gets a stable owner while nothing off the wire can
 * claim it.
 */
export const ANONYMOUS_HUB_CLIENT_ID = createSessionId("anon_");

/**
 * Identity to attribute a mutation to: the caller's own id, or this process's
 * unguessable anonymous identity. Only for commands that may legitimately arrive
 * without one (in-process adapters, unit fixtures) — authorization decisions must
 * use {@link extractClientId} and refuse an empty result instead.
 */
export function resolveActorClientId(envelope: HubCommandEnvelope): string {
	return extractClientId(envelope) || ANONYMOUS_HUB_CLIENT_ID;
}

/**
 * Whether `clientId` may act on `sessionId`.
 *
 * "Related" means the hub recorded the client as the session's creator
 * (`session.create` / `session.restore`) or as a participant (`session.attach`).
 * Both live in `ctx.sessionState`, which is also the only place the hub knows
 * about client↔session relationships at all.
 *
 * Deny by default, with no escape hatch: an unnamed caller, a session the hub has
 * no state for, and a session whose state records neither a creator nor any
 * participant are all refused. A session that cannot be attributed to anybody is
 * not an invitation — the previous "stays open to any caller" fallback was
 * reachable on purpose by waiting for the last participant to disconnect, since
 * `detachClientFromSessions` drops the whole state at that point.
 *
 * Losing the state is not a dead end: `session.attach` rebuilds the participant
 * record from nothing (`ensureSessionParticipant` creates the state when it is
 * missing), so a client that wants back in asks for access explicitly instead of
 * inheriting it. Every hub client attaches to the sessions it works with.
 *
 * The identity itself is `envelope.clientId`. On websocket traffic that value is
 * authenticated: `BrowserWebSocketHubAdapter` binds a connection to the client id
 * it registered and refuses (or relabels) envelopes that name another one, so a
 * client cannot borrow a peer's identity by relabelling its commands. Callers
 * that reach the transport without a socket (in-process/native adapters, unit
 * fixtures) are trusted to pass their own id, as they always were.
 */
export function isClientRelatedToSession(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
): boolean {
	if (!clientId) {
		return false;
	}
	const state = ctx.sessionState.get(sessionId);
	if (!state) {
		return false;
	}
	return (
		state.createdByClientId === clientId || state.participants.has(clientId)
	);
}

/** The shared session ACL for commands and list filtering. */
export function canClientAccessSession(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
	options: { machineOwner?: boolean } = {},
): boolean {
	return (
		options.machineOwner === true ||
		ctx.sessionTrustModel === "loopback-single-owner" ||
		isClientRelatedToSession(ctx, sessionId, clientId)
	);
}

export function buildHubEvent(
	event: HubEventEnvelope["event"],
	payload?: Record<string, unknown>,
	sessionId?: string,
): HubEventEnvelope {
	return {
		version: "v1",
		event,
		eventId: createSessionId("hevt_"),
		sessionId,
		timestamp: Date.now(),
		payload,
	};
}

export async function readHubSessionRecord(
	ctx: HubTransportContext,
	sessionId: string,
): Promise<HubSessionRecord | undefined> {
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return undefined;
	}
	const usageSummary = await ctx.sessionHost.getAccumulatedUsage?.(sessionId);
	return toHubSessionRecord(
		session,
		ctx.sessionState.get(sessionId),
		usageSummary?.usage,
		usageSummary?.aggregateUsage,
	);
}

/**
 * Builds the snapshot that rides on hub events and command replies. It is a
 * state notification — status, usage, model, workspace, checkpoint — and
 * deliberately does NOT read the transcript: `snapshot.messages` here would
 * put the entire conversation on every status flip, for every subscriber,
 * and into the durable event log (observed in the wild as a 25GB hub process
 * feeding a slow reader). Anything that needs messages fetches them with the
 * `session.messages` command.
 */
export async function readCoreSessionSnapshot(
	ctx: HubTransportContext,
	sessionId: string,
): Promise<CoreSessionSnapshot | undefined> {
	const session = await ctx.sessionHost.getSession(sessionId);
	if (!session) {
		return undefined;
	}
	const usageSummary = await ctx.sessionHost.getAccumulatedUsage?.(sessionId);
	return createCoreSessionSnapshot({
		session,
		usage: usageSummary?.usage,
		aggregateUsage: usageSummary?.aggregateUsage,
	});
}

export function ensureSessionState(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
	role: SessionParticipant["role"],
	options: { interactive?: boolean } = {},
): HubSessionState {
	const existing = ctx.sessionState.get(sessionId);
	if (existing) {
		if (options.interactive !== undefined) {
			existing.interactive = options.interactive;
		}
		if (role === "creator" && !existing.createdByClientId) {
			existing.createdByClientId = clientId;
		}
		if (!existing.participants.has(clientId)) {
			existing.participants.set(clientId, {
				clientId,
				attachedAt: Date.now(),
				role,
			});
		}
		return existing;
	}
	const state: HubSessionState = {
		createdByClientId: clientId,
		interactive: options.interactive ?? true,
		participants: new Map([
			[
				clientId,
				{
					clientId,
					attachedAt: Date.now(),
					role,
				},
			],
		]),
	};
	ctx.sessionState.set(sessionId, state);
	return state;
}

export function ensureSessionParticipant(
	ctx: HubTransportContext,
	sessionId: string,
	clientId: string,
	role: SessionParticipant["role"],
	options: { interactive?: boolean } = {},
): HubSessionState {
	const existing = ctx.sessionState.get(sessionId);
	if (existing) {
		if (options.interactive !== undefined) {
			existing.interactive = options.interactive;
		}
		if (!existing.participants.has(clientId)) {
			existing.participants.set(clientId, {
				clientId,
				attachedAt: Date.now(),
				role,
			});
		}
		return existing;
	}
	const state: HubSessionState = {
		interactive: options.interactive ?? true,
		participants: new Map([
			[
				clientId,
				{
					clientId,
					attachedAt: Date.now(),
					role,
				},
			],
		]),
	};
	ctx.sessionState.set(sessionId, state);
	return state;
}
