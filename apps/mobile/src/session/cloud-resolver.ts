/**
 * Resolves an outer cloud session into a connected hub session handle.
 *
 * Cloud sessions are two-level:
 *
 * - the **remote session** is the REST-managed sandbox — an id, a URL, a status
 *   and an expiry. It is what the sessions list screen shows.
 * - the **hub sessions** inside it are the transcripts and runs, reachable only
 *   over the hub websocket the sandbox exposes.
 *
 * The REST layer is expressed here as the {@link RemoteSessionGateway}
 * interface (with a Cloud API implementation and an in-memory fake for
 * tests). The
 * hub half is real: the resolver derives the websocket URL, hands it to an
 * injected client factory, connects and picks the inner session.
 *
 * Auth deliberately lives in the factory. Production passes a bearer-header
 * client, tests pass a subprotocol client against a local test hub, and the
 * resolver itself knows about neither.
 */

import {
	type HubClient,
	HubCommandError,
	type HubConnectionStateChange,
	type HubConnectionStateListener,
} from "@cline/hub-client";
import {
	HUB_CLIENT_ID_IN_USE_ERROR_CODE,
	isSessionNotFoundError,
} from "@cline/shared";
import { asHubSessionId, type HubSessionId, type RemoteSessionId } from "./ids";
import type { SessionDiagnostic } from "./reducer";
import { restoreCloudSession } from "./restore-cloud-session";
import {
	parseSessionCreateReply,
	parseSessionListReply,
	parseSessionRecordReply,
} from "./schemas";

export type RemoteSessionStatus =
	| "unknown"
	| "provisioning"
	| "running"
	| "stopped"
	| "suspended"
	| "expired"
	| "failed";

/** The outer, REST-managed cloud session (one sandbox). */
export interface RemoteSession {
	id: RemoteSessionId;
	/**
	 * Public URL of the sandbox's hub endpoint. By cloud convention this is
	 * already the proxy URL, so it is connected to as-is — only the scheme is
	 * rewritten to ws(s).
	 */
	sandboxUrl: string;
	status: RemoteSessionStatus;
	sandboxType?: "standard" | "resumable";
	/** Epoch ms at which the sandbox expires; `null` when it does not. */
	expiredAt: number | null;
	/** Cline model recorded by the outer Cloud session. */
	modelId?: string;
	taskId?: string;
	branch?: string;
	phase?: string;
	statusReason?: string;
	/** Repository backing the Cloud workspace, when Cloud API supplies it. */
	repoUrl?: string;
	/** Organization scope needed to list and reconnect this workspace. */
	organizationId?: string;
	title?: string;
	createdAt?: number;
	updatedAt?: number;
	lastActivityAt?: number;
}

/**
 * The REST surface this resolver needs. CloudSessionGateway implements it;
 * FakeRemoteSessionGateway supplies deterministic test data.
 */
export interface RemoteSessionGateway {
	listRemoteSessions(): Promise<RemoteSession[]>;
	getRemoteSession(id: RemoteSessionId): Promise<RemoteSession | undefined>;
	resumeSuspendedSession?(
		id: RemoteSessionId,
		options?: CloudSessionWaitOptions,
	): Promise<RemoteSession>;
	waitUntilReady?(
		id: RemoteSessionId,
		initialStatus: string,
		options?: CloudSessionWaitOptions,
	): Promise<void>;
}

export interface CloudSessionProgress {
	status: string;
	phase?: string;
	statusReason?: string;
}

export interface CloudSessionWaitOptions {
	signal?: AbortSignal;
	onProgress?: (progress: CloudSessionProgress) => void;
}

export class RemoteSessionNotFoundError extends Error {
	constructor(readonly remoteSessionId: RemoteSessionId) {
		super(`Remote session ${remoteSessionId} does not exist.`);
		this.name = "RemoteSessionNotFoundError";
	}
}

export class RemoteSessionExpiredError extends Error {
	constructor(
		readonly remoteSessionId: RemoteSessionId,
		readonly expiredAt: number | null,
		readonly status: RemoteSessionStatus,
		readonly statusReason?: string,
	) {
		super(
			`Remote session ${remoteSessionId} is no longer available (status=${status}${
				expiredAt === null ? "" : `, expiredAt=${expiredAt}`
			}).${statusReason ? ` ${statusReason}` : ""}`,
		);
		this.name = "RemoteSessionExpiredError";
	}
}

/**
 * The hub answered `session.list` with something this client cannot read.
 *
 * Deliberately fatal: an unreadable list is indistinguishable from an empty one,
 * and treating it as empty would lazily `session.create` a *second* transcript in
 * a sandbox that already has one — forking the user's chat on protocol drift.
 */
export class SessionListUnavailableError extends Error {
	constructor(
		readonly remoteSessionId: RemoteSessionId,
		readonly detail: string,
	) {
		super(
			`Hub for remote session ${remoteSessionId} returned an unusable session.list reply: ${detail}`,
		);
		this.name = "SessionListUnavailableError";
	}
}

/** The caller named one transcript and the hub no longer has that transcript. */
export class ExactSessionNotFoundError extends Error {
	constructor(
		readonly remoteSessionId: RemoteSessionId,
		readonly hubSessionId?: string,
	) {
		super(
			hubSessionId
				? `Session ${hubSessionId} is no longer available on this Cline host.`
				: "The conversation for this Cloud workspace is no longer available.",
		);
		this.name = "ExactSessionNotFoundError";
	}
}

/** In-memory {@link RemoteSessionGateway} for tests and local development. */
export class FakeRemoteSessionGateway implements RemoteSessionGateway {
	private readonly sessions = new Map<string, RemoteSession>();

	constructor(sessions: RemoteSession[] = []) {
		for (const session of sessions) {
			this.sessions.set(session.id, session);
		}
	}

	set(session: RemoteSession): void {
		this.sessions.set(session.id, session);
	}

	remove(id: RemoteSessionId): void {
		this.sessions.delete(id);
	}

	get(id: RemoteSessionId): RemoteSession | undefined {
		return this.sessions.get(id);
	}

	async listRemoteSessions(): Promise<RemoteSession[]> {
		return [...this.sessions.values()];
	}

	async getRemoteSession(
		id: RemoteSessionId,
	): Promise<RemoteSession | undefined> {
		return this.sessions.get(id);
	}
}

/**
 * Builds the hub client for a resolved sandbox. Owns every auth decision.
 *
 * `onConnectionState` must be passed straight through as
 * `HubClientOptions.onConnectionState`: `HubClient` takes that listener at
 * construction time, so the factory is the only place it can be installed, and
 * {@link SessionHandle.onConnectionState} is the fan-out over it.
 */
export type HubClientFactory = (input: {
	url: string;
	remoteSession: RemoteSession;
	onConnectionState: HubConnectionStateListener;
}) => HubClient;

export interface SessionHandle {
	readonly client: HubClient;
	readonly remoteSession: RemoteSession;
	/** The inner session, once known. */
	readonly hubSessionId: HubSessionId | undefined;
	/** True until an inner session exists; `ensureSession` creates one. */
	readonly needsCreate: boolean;
	/** Resolves the inner session id, creating it on first use if needed. */
	ensureSession(): Promise<HubSessionId>;
	/** Pin a session created on this socket by a checkpoint restore. */
	adoptSession?(sessionId: HubSessionId): void;
	/**
	 * Observes the client's transport lifecycle. Returns an unsubscribe function.
	 *
	 * Multiple observers are supported because the connection, and later the shell
	 * around it, both care about reconnects.
	 */
	onConnectionState(listener: HubConnectionStateListener): () => void;
}

export interface ResolveCloudSessionOptions {
	gateway: RemoteSessionGateway;
	remoteSessionId: RemoteSessionId;
	clientFactory: HubClientFactory;
	/** Payload for the lazy inner `session.create`. */
	createSessionInput?:
		| Record<string, unknown>
		| ((remote: RemoteSession) => Record<string, unknown>);
	/** Ignore existing inner sessions and lazily create a fresh one. */
	createNewSession?: boolean;
	/** Permission for the first prompt to create an absent canonical task, never to replace one. */
	allowInitialCreate?: boolean;
	signal?: AbortSignal;
	onProgress?: (progress: CloudSessionProgress) => void;
	/** Select this exact inner hub session instead of silently choosing newest. */
	hubSessionId?: string;
	/** Injectable clock, so expiry checks are deterministic in tests. */
	now?: () => number;
	onDiagnostic?: (diagnostic: SessionDiagnostic) => void;
}

const UNAVAILABLE_STATUSES = new Set<RemoteSessionStatus>([
	"expired",
	"stopped",
	"failed",
]);

/** http(s) or ws(s) sandbox URL -> ws(s) hub URL, path and query untouched. */
export function hubUrlForSandbox(sandboxUrl: string): string {
	let parsed: URL;
	try {
		parsed = new URL(sandboxUrl);
	} catch {
		throw new Error(`Unusable sandbox url: ${sandboxUrl}`);
	}
	switch (parsed.protocol) {
		case "https:":
			parsed.protocol = "wss:";
			break;
		case "http:":
			parsed.protocol = "ws:";
			break;
		case "wss:":
		case "ws:":
			break;
		default:
			throw new Error(
				`Unusable sandbox url scheme ${parsed.protocol} in ${sandboxUrl}`,
			);
	}
	return parsed.toString();
}

export function isRemoteSessionUnavailable(
	session: RemoteSession,
	now: number,
): boolean {
	if (UNAVAILABLE_STATUSES.has(session.status)) {
		return true;
	}
	return (
		session.sandboxType !== "resumable" &&
		session.expiredAt !== null &&
		session.expiredAt <= now
	);
}

// React Native's abort-controller polyfill does not expose throwIfAborted().
function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw signal.reason ?? new Error("Cloud startup cancelled.");
}

/**
 * Newest inner session wins. `updatedAt` is the ordering key with `createdAt` as
 * a fallback, and the id breaks ties so the same sandbox always resolves to the
 * same session no matter what order the hub listed them in.
 */
function selectNewestSession(
	sessions: Array<{
		sessionId: string;
		updatedAt?: number;
		createdAt?: number;
	}>,
): string | undefined {
	const sorted = [...sessions].sort((left, right) => {
		const leftAt = left.updatedAt ?? left.createdAt ?? 0;
		const rightAt = right.updatedAt ?? right.createdAt ?? 0;
		if (leftAt !== rightAt) {
			return rightAt - leftAt;
		}
		return left.sessionId < right.sessionId ? -1 : 1;
	});
	return sorted[0]?.sessionId;
}

export async function resolveCloudSession(
	options: ResolveCloudSessionOptions,
): Promise<SessionHandle> {
	const now = options.now ?? Date.now;
	let remoteSession = await options.gateway.getRemoteSession(
		options.remoteSessionId,
	);
	if (!remoteSession) {
		throw new RemoteSessionNotFoundError(options.remoteSessionId);
	}
	throwIfCancelled(options.signal);
	if (remoteSession.status === "suspended") {
		if (!options.gateway.resumeSuspendedSession)
			throw new Error("This workspace is paused. Update Cline to resume it.");
		options.onProgress?.({ status: "provisioning", phase: "resuming" });
		remoteSession = await options.gateway.resumeSuspendedSession(
			remoteSession.id,
			{
				signal: options.signal,
				onProgress: options.onProgress,
			},
		);
		throwIfCancelled(options.signal);
		if (
			remoteSession.id !== options.remoteSessionId ||
			!["running", "provisioning"].includes(remoteSession.status)
		)
			throw new Error("Cline Cloud has not resumed this workspace. Try again.");
	}
	if (isRemoteSessionUnavailable(remoteSession, now())) {
		throw new RemoteSessionExpiredError(
			remoteSession.id,
			remoteSession.expiredAt,
			remoteSession.status,
			remoteSession.statusReason,
		);
	}
	if (remoteSession.status === "provisioning") {
		if (!options.gateway.waitUntilReady) {
			throw new Error(
				"Cline Cloud is still preparing this workspace. Try again shortly.",
			);
		}
		options.onProgress?.({
			status: remoteSession.status,
			phase: remoteSession.phase,
			statusReason: remoteSession.statusReason,
		});
		await options.gateway.waitUntilReady(
			remoteSession.id,
			remoteSession.status,
			{ signal: options.signal, onProgress: options.onProgress },
		);
		remoteSession = { ...remoteSession, status: "running" };
	}
	throwIfCancelled(options.signal);

	const url = hubUrlForSandbox(remoteSession.sandboxUrl);
	const connectionListeners = new Set<HubConnectionStateListener>();
	const client = options.clientFactory({
		url,
		remoteSession,
		onConnectionState: (change: HubConnectionStateChange) => {
			for (const listener of [...connectionListeners]) {
				try {
					listener(change);
				} catch {
					// An observer fault must never destabilise the transport.
				}
			}
		},
	});
	try {
		// close() starts the old socket's shutdown but does not await the hub's
		// unregister. A fast reopen may briefly collide with our own stable ID.
		// Retry only that registration conflict; never take over a live client.
		for (let attempt = 0; ; attempt += 1) {
			throwIfCancelled(options.signal);
			try {
				await client.connect();
				break;
			} catch (error) {
				throwIfCancelled(options.signal);
				if (
					!(error instanceof HubCommandError) ||
					error.command !== "client.register" ||
					error.code !== HUB_CLIENT_ID_IN_USE_ERROR_CODE ||
					attempt >= 2
				)
					throw error;
				await new Promise<void>((resolve) =>
					setTimeout(resolve, 150 * (attempt + 1)),
				);
			}
		}
		throwIfCancelled(options.signal);
	} catch (error) {
		client.close();
		throw error;
	}

	const unusable = (detail: string): SessionListUnavailableError => {
		// Nothing above this point is usable, so the socket goes with it.
		try {
			client.close();
		} catch {
			// best-effort close
		}
		return new SessionListUnavailableError(remoteSession.id, detail);
	};

	let hubSessionId: HubSessionId | undefined;
	const requestedSessionId = options.hubSessionId?.trim() || undefined;
	const canonicalTaskId = remoteSession.taskId?.trim();
	const exactId = requestedSessionId ?? canonicalTaskId;
	if (exactId) {
		try {
			const reply = await client.command(
				"session.get",
				{ sessionId: exactId },
				exactId,
			);
			const record = parseSessionRecordReply(reply.payload);
			if (record.status !== "ok" || record.sessionId !== exactId) {
				throw unusable("session.get did not return the assigned conversation");
			}
			hubSessionId = asHubSessionId(exactId);
		} catch (error) {
			if (!isSessionNotFoundError(error)) {
				client.close();
				throw error;
			}
			if (requestedSessionId || !options.allowInitialCreate) {
				client.close();
				throw new ExactSessionNotFoundError(remoteSession.id, exactId);
			}
		}
	} else {
		const listed = await client.command("session.list", {}).catch((error) => {
			client.close();
			throw error;
		});
		const parsed = parseSessionListReply(listed.payload);
		if (parsed.status === "invalid") {
			throw unusable(parsed.detail);
		}
		if (parsed.invalidCount > 0) {
			options.onDiagnostic?.({
				level: "warn",
				type: "command_failed",
				command: "session.list",
				detail: `${parsed.invalidCount} unusable session row(s)`,
			});
		}
		const selected = selectNewestSession(
			parsed.sessions.filter(
				(session) =>
					!String(
						session.metadata?.parentSessionId ?? session.parentSessionId ?? "",
					).trim(),
			),
		);
		if (!selected && parsed.invalidCount > 0) {
			// The hub has sessions; we just could not read any of them. `needsCreate` is
			// only ever reached from an empty *and* valid list.
			throw unusable(
				`${parsed.invalidCount} unusable session row(s) and no usable one`,
			);
		}
		if (!selected && options.allowInitialCreate === false) {
			client.close();
			throw new ExactSessionNotFoundError(remoteSession.id);
		}
		hubSessionId =
			selected && !options.createNewSession
				? asHubSessionId(selected)
				: undefined;
	}
	if (options.signal?.aborted) {
		client.close();
		throwIfCancelled(options.signal);
	}

	if (hubSessionId && remoteSession.sandboxType === "resumable") {
		try {
			await restoreCloudSession(
				client,
				hubSessionId,
				remoteSession.modelId,
				options.signal,
			);
			throwIfCancelled(options.signal);
		} catch (error) {
			client.close();
			throw error;
		}
	}

	let createPromise: Promise<HubSessionId> | undefined;

	const handle: SessionHandle = {
		client,
		remoteSession,
		onConnectionState(listener: HubConnectionStateListener): () => void {
			connectionListeners.add(listener);
			return () => {
				connectionListeners.delete(listener);
			};
		},
		get hubSessionId() {
			return hubSessionId;
		},
		get needsCreate() {
			return hubSessionId === undefined;
		},
		adoptSession(sessionId) {
			if (hubSessionId || createPromise)
				throw new Error("This connection already owns a conversation.");
			hubSessionId = sessionId;
		},
		async ensureSession(): Promise<HubSessionId> {
			if (hubSessionId) {
				return hubSessionId;
			}
			// One create per handle even under concurrent sends; a failure clears the
			// latch so a retry is not permanently poisoned.
			createPromise ??= (async () => {
				const createInput =
					typeof options.createSessionInput === "function"
						? options.createSessionInput(remoteSession)
						: options.createSessionInput;
				const reply = await client.command(
					"session.create",
					canonicalTaskId
						? {
								...createInput,
								sessionConfig: {
									...(createInput?.sessionConfig as
										| Record<string, unknown>
										| undefined),
									sessionId: canonicalTaskId,
								},
							}
						: (createInput ?? {}),
				);
				const created = parseSessionCreateReply(reply.payload);
				if (created.status === "invalid") {
					throw new Error(
						`session.create returned no usable session id: ${created.detail}`,
					);
				}
				if (canonicalTaskId && created.sessionId !== canonicalTaskId) {
					throw new Error(
						"Cloud Hub created a different conversation than the assigned task.",
					);
				}
				hubSessionId = asHubSessionId(created.sessionId);
				return hubSessionId;
			})().finally(() => {
				createPromise = undefined;
			});
			return await createPromise;
		},
	};
	return handle;
}
