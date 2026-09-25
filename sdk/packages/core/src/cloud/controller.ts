import { randomUUID } from "node:crypto";
import type {
	BasicLogger,
	HubEventEnvelope,
	MessageWithMetadata,
	ToolApprovalResult,
} from "@cline/shared";
import { NodeHubClient } from "../hub/client/index";
import { isSessionNotFoundError } from "../runtime/host/runtime-host";
import {
	type CloudSessionApi,
	CloudSessionError,
	type CloudSessionRecord,
	type CreateCloudSessionInput,
	deriveCloudSessionTitle,
	parseCloudProvisioningPhase,
} from "./api";
import type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
} from "./repositories";
import {
	countPromptOccurrences,
	isRootSessionRow,
	readSessionRows,
	reconcileBufferedCloudEvents,
	sessionRowModelId,
	submittedPromptsFromEvents,
	updatedAt,
} from "./snapshots";
import {
	immutableCopy,
	reduceCloudEvent,
	resolveSessionListTitle,
} from "./state";
import type {
	CloudApproval,
	CloudCreationOptions,
	CloudQueuedPrompt,
	CloudSessionAttachment,
	CloudSessionEvent,
	CloudSessionSnapshot,
	CloudSessionState,
	JsonRecord,
} from "./types";

function isHubReconnectableTransportError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.name === "HubTransportError" &&
		[
			"hub_connect_timeout",
			"hub_connect_failed",
			"hub_connection_closed",
			"hub_connection_not_open",
		].includes(String((error as Error & { code?: string }).code))
	);
}
function isHubCommandTimeoutError(error: unknown, command?: string): boolean {
	return (
		error instanceof Error &&
		error.name === "HubCommandError" &&
		(error as Error & { code?: string }).code === "hub_command_timeout" &&
		(!command || (error as Error & { command?: string }).command === command)
	);
}
const CLOUD_WORKSPACE_ROOT = "/workspace";
const QUEUE_COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFERED_SYNC_EVENTS = 2_000;
const MAX_SEEN_EVENT_IDS = 2_000;
const CLOUD_SESSION_SYSTEM_PROMPT =
	"IMPORTANT: GitHub authentication is handled automatically by the infrastructure. " +
	"An egress proxy transparently injects credentials into all GitHub traffic. " +
	"You do NOT need to set up, configure, or manage any tokens, API keys, or credentials, " +
	"and you must never run `gh auth login` or attempt to authenticate manually. " +
	"The GitHub CLI (`gh`) is installed and already authenticated — prefer it for GitHub work " +
	"(`gh pr create`, `gh pr diff`, `gh issue list`, `gh api`, ...). " +
	"`git` push and pull are authenticated the same way. " +
	"Simply run the commands normally — credentials are injected transparently.";

export class CloudQueueUnconfirmedError extends CloudSessionError {
	constructor() {
		super(
			"request_failed",
			"The connection was interrupted and Cline could not confirm whether this message was queued. Check the cloud session before resending it.",
		);
		this.name = "CloudQueueUnconfirmedError";
	}
}

function isExpiredRecord(record: CloudSessionRecord): boolean {
	const expiredAt = record.expiredAt
		? Date.parse(record.expiredAt)
		: Number.NaN;
	return Number.isFinite(expiredAt) && expiredAt <= Date.now();
}

type CloudHubClient = Pick<
	NodeHubClient,
	"command" | "connect" | "dispose" | "getClientId" | "subscribe"
>;

type CloudRehydrationSnapshot = {
	status: string;
	messages: unknown[];
	prompts?: CloudQueuedPrompt[];
	submittedPrompts: CloudQueuedPrompt[];
};

type CloudConnection = {
	generation?: number;
	connected?: boolean;
	reconnecting?: boolean;
	remote: CloudSessionRecord;
	client: CloudHubClient;
	innerSessionId?: string;
	reconnectResolution?: Promise<void>;
	rehydrationPromise?: Promise<CloudRehydrationSnapshot>;
	rehydrationRerunRequested?: boolean;
	bufferingEvents?: boolean;
	bufferedEvents: HubEventEnvelope[];
	bufferedEventsDropped: number;
	transcriptKnown: boolean;
	seenEventIds: Set<string>;
	/** Exact command correlation; optimistic transcript text is never acceptance. */
	pendingInputs?: Map<
		string,
		{ clientId: string; ownsBusyState: boolean; accept: () => void }
	>;
	externalRun?: { progressHydrated: boolean };
	/** Prevents concurrent sends from creating competing inner sessions. */
	innerSessionCreation?: Promise<void>;
	/** Set by disposeConnection; late timers and approval callbacks must not
	 * command (and thereby resurrect) a disposed client. */
	disposed?: boolean;
	/** Rate-limits cloud_session_sync_failed to state transitions so a
	 * reconnect loop cannot spam the UI on every attempt. */
	syncFailureNotified?: boolean;
	unsubscribe: () => void;
};

export type CloudSessionControllerOptions = {
	logger?: BasicLogger;
	clientIdentity?: {
		prefix: string;
		type: string;
		displayName: string;
		source: string;
	};
	/** Desktop preserves its historical cleanup; CLI keeps late successful creations recoverable. */
	lateCreateDisposition?: "preserve" | "delete";
	/** Host-owned first-task policy survives controller replacement; established tasks never qualify. */
	pendingInitialTasks?: Map<string, CloudCreationOptions>;

	api: Pick<
		CloudSessionApi,
		| "create"
		| "delete"
		| "list"
		| "status"
		| "waitUntilReady"
		| "history"
		| "updateTitle"
		| "listRepositories"
		| "listBranches"
	>;
	getAuthToken: () => Promise<string | undefined>;
	apiBaseUrl: string;
	getActiveOrganizationId?: (options?: {
		fresh?: boolean;
	}) => Promise<string | undefined>;
	createHubClient?: (
		options: ConstructorParameters<typeof NodeHubClient>[0],
	) => CloudHubClient;
};

export function isCloudOuterSessionId(sessionId: string): boolean {
	return sessionId.trim().startsWith("ses-");
}

function toWebSocketUrl(apiBaseUrl: string, outerSessionId: string): string {
	const url = new URL(
		`/api/v1/session/${encodeURIComponent(outerSessionId)}`,
		apiBaseUrl,
	);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

function recordToCloudSessionState(
	record: CloudSessionRecord,
): CloudSessionState {
	return {
		config: {
			executionTarget: "cloud",
			provider: "cline",
			providerId: "cline",
			model: record.metadata.modelId ?? "",
			modelId: record.metadata.modelId ?? "",
			repoUrl: record.repoContext.repoUrl ?? "",
			branch: record.repoContext.branch ?? "",
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
		},
		messages: [],
		promptsInQueue: [],
		// REST "active" means a proxy WebSocket is open, not that the agent is
		// running. Hub attach/events provide the authoritative busy state.
		busy: false,
		startedAt: Date.parse(record.createdAt) || Date.now(),
		// A future TTL is not an end time.
		endedAt:
			isExpiredRecord(record) && record.expiredAt
				? Date.parse(record.expiredAt)
				: undefined,
		status: record.status,
		attachedViaHub: true,
	};
}

/** Reply shape for chat_session_command start/attach on a cloud session. */
function attachResultPayload(
	record: CloudSessionRecord,
	status: string,
	prompt?: string,
): CloudSessionAttachment {
	return {
		sessionId: record.id,
		origin: "cloud",
		executionTarget: "cloud",
		status,
		provider: "cline",
		model: record.metadata.modelId ?? "",
		repoUrl: record.repoContext.repoUrl ?? "",
		branch: record.repoContext.branch ?? "",
		cwd: CLOUD_WORKSPACE_ROOT,
		workspaceRoot: CLOUD_WORKSPACE_ROOT,
		...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
		metadata: {
			origin: "cloud",
			repoUrl: record.repoContext.repoUrl ?? "",
			git: {
				url: record.repoContext.repoUrl ?? "",
				branch: record.repoContext.branch ?? "",
			},
		},
	};
}

export function cloudSessionToDiscoveryRecord(
	record: CloudSessionRecord,
): JsonRecord {
	return {
		sessionId: record.id,
		origin: "cloud",
		executionTarget: "cloud",
		status: record.status,
		provider: "cline",
		model: record.metadata.modelId ?? "",
		cwd: CLOUD_WORKSPACE_ROOT,
		workspaceRoot: CLOUD_WORKSPACE_ROOT,
		repoUrl: record.repoContext.repoUrl ?? "",
		branch: record.repoContext.branch ?? "",
		// updatedAt changes on every reconnect, so it is not a stable start time.
		startedAt: record.createdAt,
		...(record.lastActivityAt ? { lastActivityAt: record.lastActivityAt } : {}),
		endedAt: isExpiredRecord(record)
			? (record.expiredAt ?? undefined)
			: record.status === "failed"
				? (record.lastActivityAt ?? record.createdAt)
				: undefined,
		updatedAt: record.updatedAt,
		...(record.title?.trim() ? { title: record.title.trim() } : {}),
		metadata: {
			...(record.title?.trim() ? { title: record.title.trim() } : {}),
			origin: "cloud",
			...(record.metadata.provisioningPhase
				? { provisioningPhase: record.metadata.provisioningPhase }
				: {}),
			repoUrl: record.repoContext.repoUrl ?? "",
			git: {
				url: record.repoContext.repoUrl ?? "",
				branch: record.repoContext.branch ?? "",
			},
		},
	};
}

function parseApprovalInput(value: unknown): unknown {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
function mergePromptEvidence(
	prompts: CloudQueuedPrompt[] | undefined,
	submittedPrompts: CloudQueuedPrompt[],
): CloudQueuedPrompt[] {
	const merged = [...(prompts ?? [])];
	const knownIds = new Set(merged.map((prompt) => prompt.id));
	for (const prompt of submittedPrompts) {
		if (!knownIds.has(prompt.id)) merged.push(prompt);
	}
	return merged;
}
export class CloudSessionController {
	private readonly sessionGenerations = new Map<string, number>();
	private readonly sessions = new Map<string, CloudSessionState>();
	private readonly approvals = new Map<
		string,
		{
			item: CloudApproval;
			resolve: (result: ToolApprovalResult) => Promise<void>;
		}
	>();
	private readonly listeners = new Set<(event: CloudSessionEvent) => void>();
	private readonly detachedSessions = new Set<string>();
	private readonly restoredOptions = new Map<string, CloudCreationOptions>();
	private readonly authoritativeMessages = new Map<
		string,
		MessageWithMetadata[]
	>();
	private readonly streamingMessages = new Map<string, number>();

	private disposed = false;
	private readonly connections = new Map<string, CloudConnection>();
	private readonly connectionPromises = new Map<
		string,
		Promise<CloudConnection>
	>();
	private readonly knownSessions = new Map<string, CloudSessionRecord>();
	// Retain new sessions until discovery has observed them at least once.
	private readonly unlistedSessions = new Map<string, CloudSessionRecord>();
	private readonly pendingInitialTasks: Map<string, CloudCreationOptions>;
	private lastListedSessions: CloudSessionRecord[] = [];
	private discoveryRefresh?: Promise<CloudSessionRecord[]>;
	private readonly createRequests = new Map<
		string,
		Promise<CloudSessionAttachment>
	>();
	private readonly provisioningControllers = new Map<
		string,
		Set<AbortController>
	>();
	private readonly sendAbortTokens = new Map<string, symbol>();
	private readonly titleWrites = new Map<string, Promise<void>>();
	private readonly deletingSessions = new Set<string>();
	private readonly createHubClient: NonNullable<
		CloudSessionControllerOptions["createHubClient"]
	>;

	constructor(private readonly options: CloudSessionControllerOptions) {
		this.pendingInitialTasks = options.pendingInitialTasks ?? new Map();
		this.createHubClient =
			options.createHubClient ??
			((clientOptions) => new NodeHubClient(clientOptions));
	}

	/** Restores only pre-creation settings; never mutates a running Hub session's policy. */
	restoreCreationOptions(
		sessionId: string,
		options: CloudCreationOptions,
	): void {
		this.restoredOptions.set(sessionId, structuredClone(options));
		if (this.pendingInitialTasks.has(sessionId)) {
			this.pendingInitialTasks.set(sessionId, {
				...this.pendingInitialTasks.get(sessionId),
				...structuredClone(options),
			});
		}
		const state = this.sessions.get(sessionId);
		if (state) Object.assign(state.config, structuredClone(options));
	}

	protected seedSessionState(
		sessionId: string,
		state: CloudSessionState,
	): void {
		if (!this.sessions.has(sessionId))
			this.sessions.set(sessionId, structuredClone(state));
	}

	private stateFromRecord(record: CloudSessionRecord): CloudSessionState {
		const state = recordToCloudSessionState(record);
		Object.assign(
			state.config,
			this.pendingInitialTasks.get(record.id),
			this.restoredOptions.get(record.id),
		);
		return state;
	}

	getSnapshot(sessionId: string): CloudSessionSnapshot | undefined {
		const record = this.knownSessions.get(sessionId);
		const state =
			this.sessions.get(sessionId) ??
			(record ? this.stateFromRecord(record) : undefined);
		if (!state) return undefined;
		const connection = this.connections.get(sessionId);
		return immutableCopy({
			...state,
			sessionId,
			record,
			approvals: Array.from(this.approvals.values())
				.filter((item) => item.item.sessionId === sessionId)
				.map((item) => item.item),
			connectionState:
				this.detachedSessions.has(sessionId) || this.disposed
					? "detached"
					: connection?.reconnectResolution || connection?.rehydrationPromise
						? "reconnecting"
						: connection
							? connection.connected
								? "connected"
								: connection.reconnecting
									? "reconnecting"
									: "connecting"
							: this.connectionPromises.has(sessionId)
								? "connecting"
								: "detached",
			transcriptKnown:
				connection?.transcriptKnown ??
				Boolean(record && isExpiredRecord(record)),
		});
	}

	subscribe(
		listener: (event: CloudSessionEvent) => void,
		sessionId?: string,
	): () => void {
		const scoped = (event: CloudSessionEvent) => {
			if (!sessionId || event.sessionId === sessionId) listener(event);
		};
		this.listeners.add(scoped);
		return () => {
			this.listeners.delete(scoped);
		};
	}

	private publish(event: CloudSessionEvent): void {
		// getSnapshot already owns and freezes the complete snapshot tree.
		const value =
			event.type === "snapshot" ? Object.freeze(event) : immutableCopy(event);
		for (const listener of this.listeners) {
			try {
				listener(value);
			} catch (error) {
				this.options.logger?.error?.("Cloud session subscriber failed", {
					error,
				});
			}
		}
	}

	private publishSnapshot(
		sessionId: string,
		replace = false,
		cause?: "status" | "ended" | "queue" | "approvals",
	): void {
		this.cancelScheduledSnapshot(sessionId);
		const snapshot = this.getSnapshot(sessionId);
		if (snapshot)
			this.publish({ type: "snapshot", sessionId, snapshot, replace, cause });
		else this.publish({ type: "removed", sessionId });
	}

	private readonly snapshotTimers = new Map<
		string,
		ReturnType<typeof setTimeout>
	>();
	private cancelScheduledSnapshot(sessionId: string): void {
		clearTimeout(this.snapshotTimers.get(sessionId));
		this.snapshotTimers.delete(sessionId);
	}
	private scheduleSnapshot(sessionId: string): void {
		if (
			this.disposed ||
			this.detachedSessions.has(sessionId) ||
			this.snapshotTimers.has(sessionId)
		)
			return;
		const timer = setTimeout(() => this.publishSnapshot(sessionId), 100);
		timer.unref?.();
		this.snapshotTimers.set(sessionId, timer);
	}

	private notify(name: string, payload: JsonRecord): void {
		const sessionId = String(payload.sessionId ?? "");
		if (name === "cloud_session_sync_failed") {
			this.publish({
				type: "sync_failed",
				sessionId,
				message: String(payload.message ?? "Cloud synchronization failed"),
			});
		} else {
			this.publishSnapshot(
				sessionId,
				name === "cloud_session_rehydrated",
				name === "chat_session_status"
					? "status"
					: name === "chat_session_ended"
						? "ended"
						: name === "tool_approval_state"
							? "approvals"
							: undefined,
			);
		}
	}

	private applyLiveEvent(sessionId: string, event: HubEventEnvelope): void {
		const state = this.sessions.get(sessionId);
		if (state)
			reduceCloudEvent(state, event, this.streamingMessages, sessionId);
	}

	async respondApproval(
		sessionId: string,
		approvalId: string,
		result: ToolApprovalResult,
	): Promise<void> {
		this.assertSessionActive(sessionId);
		const pending = this.approvals.get(`${sessionId}:${approvalId}`);
		if (!pending) {
			if (!this.connections.has(sessionId))
				throw new Error(
					"This cloud session connection is closed; reopen the session to respond.",
				);
			throw new CloudSessionError(
				"request_failed",
				"This approval was already resolved or is no longer available.",
			);
		}
		await pending.resolve(result);
	}

	/** Detaches this viewer and invalidates waiting sends without stopping or deleting remote work. */
	async detach(sessionId: string): Promise<void> {
		this.detachedSessions.add(sessionId);
		this.sessionGenerations.set(
			sessionId,
			(this.sessionGenerations.get(sessionId) ?? 0) + 1,
		);
		this.connectionPromises.delete(sessionId);
		this.sendAbortTokens.set(sessionId, Symbol());
		this.abortProvisioningControllers(
			sessionId,
			new Error("Cloud viewer detached"),
		);
		await this.disposeConnection(sessionId);
		this.publishSnapshot(sessionId);
	}

	isCloudSession(sessionId: string): boolean {
		return (
			isCloudOuterSessionId(sessionId) ||
			this.knownSessions.has(sessionId) ||
			this.connections.has(sessionId) ||
			this.sessions.get(sessionId)?.config.executionTarget === "cloud"
		);
	}

	/** Returns a session this process already created or discovered without
	 * making account/environment availability a prerequisite for opening it. */
	getCachedDiscoveryRecord(sessionId: string): JsonRecord | undefined {
		const record = this.knownSessions.get(sessionId);
		return record ? cloudSessionToDiscoveryRecord(record) : undefined;
	}

	/** Revalidates a cached row by id when the active-scope list does not include it. */
	async getCrossScopeDiscoveryRecord(
		sessionId: string,
	): Promise<JsonRecord | undefined> {
		const cached = this.getCachedDiscoveryRecord(sessionId);
		if (!cached) {
			return undefined;
		}
		try {
			const status = await this.options.api.status(sessionId);
			const value = status.status?.trim();
			return value ? { ...cached, status: value } : cached;
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				(error.code === "session_not_found" || error.code === "session_expired")
			) {
				this.knownSessions.delete(sessionId);
				this.unlistedSessions.delete(sessionId);
				this.pendingInitialTasks.delete(sessionId);
				return undefined;
			}
			// A scope/auth/network failure cannot prove the cached session is gone.
			return cached;
		}
	}

	async list(): Promise<CloudSessionRecord[]> {
		if (this.disposed) throw new Error("Cloud session controller was disposed");
		const organizationId = await this.resolveActiveOrganizationId();
		const listed = (await this.options.api.list(organizationId)).map(
			(session) => this.preserveConnectedRuntimeModel(session),
		);
		if (this.disposed) throw new Error("Cloud session controller was disposed");
		// Keep canonical rows available while their status checks run.
		this.lastListedSessions = listed;
		for (const session of listed) {
			this.knownSessions.set(session.id, session);
			this.unlistedSessions.delete(session.id);
		}
		// Omission can be a listing race; only a definitive status error drops a fallback.
		await Promise.all(
			Array.from(this.unlistedSessions.keys(), (sessionId) =>
				this.getCrossScopeDiscoveryRecord(sessionId),
			),
		);
		const scoped = await Promise.all(
			listed.map(async (session) => {
				if (session.status !== "provisioning") {
					return session;
				}
				const result = await this.options.api
					.status(session.id)
					.catch(() => undefined);
				const status = result?.status?.trim();
				if (!status) return session;
				return {
					...session,
					status,
					metadata: {
						...session.metadata,
						...(parseCloudProvisioningPhase(result?.phase)
							? { provisioningPhase: result?.phase }
							: {}),
						...(result?.statusReason?.trim()
							? { statusReason: result.statusReason.trim() }
							: {}),
					},
				};
			}),
		);
		if (this.disposed) throw new Error("Cloud session controller was disposed");
		// Retain other scopes for routing; only lastListedSessions drives the sidebar.
		for (const session of scoped) {
			this.knownSessions.set(session.id, session);
			const live = this.sessions.get(session.id);
			if (
				live?.status === "provisioning" &&
				session.status !== "provisioning"
			) {
				live.status = session.status;
			}
			const connection = this.connections.get(session.id);
			if (connection) {
				connection.remote = session;
			}
			const expired = isExpiredRecord(session);
			if (expired || session.status === "failed") {
				if (live) {
					live.busy = false;
					live.status = expired ? "expired" : "failed";
					live.endedAt = expired
						? Date.parse(session.expiredAt ?? "") || Date.now()
						: Math.max(
								live.endedAt ?? 0,
								Date.parse(session.lastActivityAt ?? session.createdAt) || 0,
							) || undefined;
				}
				if (connection) {
					// Unavailable sandboxes must stop reconnecting.
					void this.disposeConnection(session.id).catch(() => undefined);
				}
			}
		}
		this.lastListedSessions = scoped;
		for (const record of scoped)
			if (this.sessions.has(record.id)) this.publishSnapshot(record.id);
		return immutableCopy(scoped);
	}

	private preserveConnectedRuntimeModel(
		session: CloudSessionRecord,
	): CloudSessionRecord {
		const runtimeModel = this.connections
			.get(session.id)
			?.remote.metadata.modelId?.trim();
		if (!runtimeModel || runtimeModel === session.metadata.modelId) {
			return session;
		}
		return {
			...session,
			metadata: { ...session.metadata, modelId: runtimeModel },
		};
	}

	private async resolveActiveOrganizationId(options?: {
		fresh?: boolean;
	}): Promise<string | undefined> {
		return await this.options.getActiveOrganizationId?.(options);
	}

	async listRepositories(): Promise<CloudRepositoryListResult> {
		return await this.options.api.listRepositories(
			await this.resolveActiveOrganizationId(),
		);
	}

	async listBranches(
		repositoryId: number,
		options: CloudBranchListOptions = {},
	): Promise<CloudBranchListResult> {
		return await this.options.api.listBranches(
			repositoryId,
			await this.resolveActiveOrganizationId(),
			options,
		);
	}

	async listForDiscovery(
		options: { timeoutMs?: number } = {},
	): Promise<JsonRecord[]> {
		const refresh =
			this.discoveryRefresh ??
			this.list().finally(() => {
				if (this.discoveryRefresh === refresh) {
					this.discoveryRefresh = undefined;
				}
			});
		this.discoveryRefresh = refresh;

		let records = this.lastListedSessions;
		if (options.timeoutMs === undefined) {
			records = await refresh;
		} else {
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const result = await Promise.race([
				refresh.then(
					(value) => ({ value }),
					(error) => {
						if (
							!(
								error instanceof CloudSessionError &&
								error.code === "authentication_required"
							)
						) {
							this.options.logger?.error?.("Cloud session discovery failed", {
								error,
							});
						}
						return { value: this.lastListedSessions };
					},
				),
				new Promise<{ value: CloudSessionRecord[] }>((resolve) => {
					timeout = setTimeout(
						() => resolve({ value: this.lastListedSessions }),
						Math.max(0, options.timeoutMs ?? 0),
					);
				}),
			]);
			if (timeout) clearTimeout(timeout);
			records = result.value;
		}

		const recordsById = new Map(
			[...this.unlistedSessions.values(), ...records].map((record) => [
				record.id,
				record,
			]),
		);
		const listed = [...recordsById.values()].map((record) => {
			const projected = cloudSessionToDiscoveryRecord(record);
			const live = this.sessions.get(record.id);
			if (!live) {
				return projected;
			}
			const title = live.title?.trim() || record.title?.trim();
			return {
				...projected,
				status: live.status,
				prompt: live.prompt,
				endedAt:
					live.endedAt !== undefined
						? new Date(live.endedAt).toISOString()
						: projected.endedAt,
				metadata: {
					...((projected.metadata ?? {}) as JsonRecord),
					title: resolveSessionListTitle({
						sessionId: record.id,
						metadata: title ? { title } : undefined,
						prompt: live.prompt,
						messages: live.messages,
					}),
				},
			};
		});
		return listed;
	}

	async create(
		input: CreateCloudSessionInput,
	): Promise<CloudSessionAttachment> {
		const key = input.requestId?.trim();
		if (!key) return await this.createOnce(input);
		const existing = this.createRequests.get(key);
		if (existing) return await existing;
		const creating = this.createOnce(input).finally(() => {
			if (this.createRequests.get(key) === creating) {
				this.createRequests.delete(key);
			}
		});
		this.createRequests.set(key, creating);
		return await creating;
	}

	private trackProvisioningController(
		outerSessionId: string,
		controller: AbortController,
	): () => void {
		let controllers = this.provisioningControllers.get(outerSessionId);
		if (!controllers) {
			controllers = new Set();
			this.provisioningControllers.set(outerSessionId, controllers);
		}
		controllers.add(controller);
		return () => {
			controllers.delete(controller);
			if (controllers.size === 0) {
				this.provisioningControllers.delete(outerSessionId);
			}
		};
	}

	private abortProvisioningControllers(
		outerSessionId: string,
		reason?: unknown,
	): boolean {
		const controllers = this.provisioningControllers.get(outerSessionId);
		if (!controllers?.size) return false;
		for (const controller of controllers) controller.abort(reason);
		return true;
	}

	private async createOnce(
		input: CreateCloudSessionInput,
	): Promise<CloudSessionAttachment> {
		if (this.disposed) throw new Error("Cloud session manager was disposed");
		const organizationId =
			input.organizationId ??
			(await this.resolveActiveOrganizationId({ fresh: true }));
		const created = await this.options.api.create({ ...input, organizationId });
		if (!created?.sessionId?.trim()) {
			throw new CloudSessionError(
				"request_failed",
				"The cloud session service returned an unexpected response; please try again.",
			);
		}
		if (this.disposed) {
			if (this.options.lateCreateDisposition === "delete")
				await this.deleteProvisionedSessionAfterDispose(
					created.sessionId,
					created.cleanupAuthToken,
				);
			throw new Error(
				"Cline account changed while the cloud session was starting",
			);
		}
		const record: CloudSessionRecord = {
			id: created.sessionId,
			status: created.status,
			sandboxUrl: created.sandboxUrl,
			repoContext: {
				repoUrl: input.repoUrl,
				...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
			},
			metadata: { modelId: input.modelId },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		this.knownSessions.set(record.id, record);
		this.unlistedSessions.set(record.id, record);
		// REST does not round-trip these client-side first-task preferences.
		const { autoApproveTools, thinking, reasoningEffort } = input;
		this.pendingInitialTasks.set(record.id, {
			autoApproveTools,
			thinking,
			reasoningEffort,
		});
		const live = this.stateFromRecord(record);
		live.prompt = input.initialPrompt?.trim() || undefined;
		this.sessions.set(record.id, live);
		this.notify("chat_session_status", {
			sessionId: record.id,
			status: live.status,
		});
		return {
			sessionId: record.id,
			origin: "cloud",
			executionTarget: "cloud",
			status: record.status,
			provider: "cline",
			model: input.modelId,
			repoUrl: input.repoUrl,
			branch: input.branch ?? "",
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			...(live.prompt ? { prompt: live.prompt } : {}),
		};
	}

	private async deleteProvisionedSessionAfterDispose(
		outerSessionId: string,
		authToken?: string,
	): Promise<void> {
		this.knownSessions.delete(outerSessionId);
		this.unlistedSessions.delete(outerSessionId);
		this.pendingInitialTasks.delete(outerSessionId);
		this.sessions.delete(outerSessionId);
		await this.options.api.delete(outerSessionId, authToken).catch((error) => {
			this.options.logger?.log(
				"Failed to clean up a cloud session created during an account change",
				{ sessionId: outerSessionId, error },
			);
		});
	}

	async attach(
		outerSessionId: string,
		creationOptions?: CloudCreationOptions,
	): Promise<CloudSessionAttachment> {
		const generation = this.sessionGenerations.get(outerSessionId) ?? 0;
		this.detachedSessions.delete(outerSessionId);
		if (creationOptions)
			this.restoreCreationOptions(outerSessionId, creationOptions);
		const known = await this.ensureKnownSession(outerSessionId);
		this.assertSessionActive(outerSessionId);
		if (generation !== (this.sessionGenerations.get(outerSessionId) ?? 0))
			throw new Error("Cloud viewer detached during attachment");
		if (!this.sessions.has(outerSessionId))
			this.sessions.set(outerSessionId, this.stateFromRecord(known));
		if (known.status === "provisioning" || known.status === "failed") {
			return attachResultPayload(
				known,
				known.status,
				this.sessions.get(outerSessionId)?.prompt,
			);
		}
		if (isExpiredRecord(known)) {
			// A connection left over from before expiry would reconnect-loop
			// against a dead sandbox forever.
			await this.disposeConnection(outerSessionId);
			return await this.attachExpired(known);
		}
		let connection: CloudConnection;
		try {
			connection = await this.ensureConnection(outerSessionId);
		} catch (error) {
			// Re-check expiry after a proxy upgrade failure.
			const refreshed = await this.refreshKnownSession(outerSessionId);
			if (refreshed && isExpiredRecord(refreshed)) {
				await this.disposeConnection(outerSessionId);
				return await this.attachExpired(refreshed);
			}
			throw error;
		}
		await this.ensureAttached(connection);
		const record = connection.remote;
		const live = this.sessions.get(outerSessionId);
		return attachResultPayload(
			record,
			live?.status ?? record.status,
			live?.prompt,
		);
	}

	async send(
		outerSessionId: string,
		prompt: string,
		requestedDelivery?: "queue" | "steer",
		modelId?: string,
		userImages?: string[],
	): Promise<{
		sessionId: string;
		ok: true;
		queued?: boolean;
		recoveredAfterDisconnect?: boolean;
		status?: string;
		result?: unknown;
	}> {
		const abortToken = this.sendAbortTokens.get(outerSessionId);
		const knownForSend = this.knownSessions.get(outerSessionId);
		if (knownForSend && isExpiredRecord(knownForSend)) {
			throw new CloudSessionError(
				"session_expired",
				"This cloud session has expired; its sandbox is gone. Start a new cloud session to continue.",
			);
		}
		const connection = await this.ensureConnection(outerSessionId, {
			createInner: true,
		});
		const isCancelled = () =>
			this.disposed ||
			connection.disposed ||
			this.deletingSessions.has(outerSessionId) ||
			this.sendAbortTokens.get(outerSessionId) !== abortToken;
		const throwIfCancelled = () => {
			if (isCancelled()) throw new Error("Cloud session prompt cancelled");
		};
		throwIfCancelled();
		await connection.reconnectResolution;
		throwIfCancelled();
		await this.ensureAttached(connection);
		await connection.reconnectResolution;
		throwIfCancelled();
		if (!connection.transcriptKnown) {
			await this.rehydrateAfterTransportDrop(outerSessionId, connection);
		}
		// Rehydration attaches again and may reveal a model change made by a
		// different client. Enforce this send's selected model only after the
		// final authoritative snapshot.
		throwIfCancelled();
		await this.updateModel(connection, modelId);
		await connection.reconnectResolution;
		// Stop also cancels sends still waiting for connection/attachment.
		throwIfCancelled();
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub session was not initialized");
		}
		const live = this.sessions.get(outerSessionId);
		const delivery = requestedDelivery ?? (live?.busy ? "queue" : undefined);
		const promptOccurrencesBeforeSend = countPromptOccurrences(
			live?.messages ?? [],
			live?.promptsInQueue ?? [],
			prompt,
		);
		const ownsBusyState = delivery !== "queue" && delivery !== "steer";
		const pendingMessage: MessageWithMetadata | undefined =
			live && delivery !== "queue"
				? { role: "user", content: [{ type: "text", text: prompt }] }
				: undefined;
		if (live && pendingMessage) {
			live.messages = [...live.messages, pendingMessage];
		}
		const removePendingMessage = () => {
			if (live && pendingMessage) {
				live.messages = live.messages.filter(
					(message) => message !== pendingMessage,
				);
				this.publishSnapshot(outerSessionId);
			}
		};
		if (live && ownsBusyState) {
			const statusChanged = live.status !== "running";
			live.busy = true;
			live.status = "running";
			live.prompt ||= prompt;
			if (statusChanged) this.publishSnapshot(outerSessionId, false, "status");
		}
		const record = this.knownSessions.get(outerSessionId);
		if (
			record &&
			!record.title?.trim() &&
			!this.titleWrites.has(outerSessionId)
		) {
			const title = deriveCloudSessionTitle(prompt);
			if (title) {
				record.title = title;
				if (live) {
					live.title = title;
				}
				const write = this.options.api
					.updateTitle?.(outerSessionId, title)
					.then(() => {})
					.catch(() => {})
					.finally(() => {
						if (this.titleWrites.get(outerSessionId) === write) {
							this.titleWrites.delete(outerSessionId);
						}
					});
				if (write) this.titleWrites.set(outerSessionId, write);
			}
		}
		const dispatchedRequests = new Set<string>();
		let accepted = false;
		const accept = () => {
			if (accepted || isCancelled()) return;
			accepted = true;
			this.publish({
				type: "prompt_accepted",
				sessionId: outerSessionId,
				prompt,
				delivery,
			});
		};
		try {
			const reply = await connection.client.command(
				"session.send_input",
				{
					prompt,
					delivery,
					...(userImages?.length ? { attachments: { userImages } } : {}),
				},
				innerSessionId,
				{
					timeoutMs: delivery === "queue" ? QUEUE_COMMAND_TIMEOUT_MS : null,
					onDispatch: (requestId) => {
						dispatchedRequests.add(requestId);
						connection.pendingInputs ??= new Map();
						connection.pendingInputs.set(requestId, {
							clientId: connection.client.getClientId(),
							ownsBusyState,
							accept,
						});
					},
					beforeDispatch: () => {
						throwIfCancelled();
						if (connection.innerSessionId !== innerSessionId) {
							throw new Error(
								"The cloud session reconnected before the prompt could be sent. Please try again.",
							);
						}
					},
				},
			);
			accept();
			const queued =
				delivery === "queue" ||
				(delivery !== "steer" && reply.payload?.result === undefined);
			if (queued) removePendingMessage();
			return {
				sessionId: outerSessionId,
				ok: true,
				...(queued ? { queued: true } : {}),
				result: reply.payload?.result,
			};
		} catch (error) {
			if (isCancelled()) {
				removePendingMessage();
				// Stop owns the status; a newer send may already own busy state.
				throw error;
			}
			if (
				isHubReconnectableTransportError(error) ||
				isHubCommandTimeoutError(error, "session.send_input")
			) {
				let snapshot: CloudRehydrationSnapshot;
				try {
					snapshot = await this.rehydrateAfterTransportDrop(
						outerSessionId,
						connection,
					);
				} catch (recoveryError) {
					throwIfCancelled();
					removePendingMessage();
					if (live && ownsBusyState) {
						live.busy = false;
						live.status = "error";
					}
					if (delivery === "queue") throw new CloudQueueUnconfirmedError();
					throw recoveryError;
				}
				throwIfCancelled();
				// Matching queue/steer text cannot identify which concurrent input was accepted.
				if (delivery === "queue" || delivery === "steer") {
					throw new CloudSessionError(
						"request_failed",
						"Cline could not confirm whether this message was accepted. Check the cloud session before resending it.",
					);
				}
				const promptOccurrencesAfterRecovery = countPromptOccurrences(
					snapshot.messages,
					mergePromptEvidence(snapshot.prompts, snapshot.submittedPrompts),
					prompt,
				);
				if (promptOccurrencesAfterRecovery <= promptOccurrencesBeforeSend) {
					throw new CloudSessionError(
						"request_failed",
						"Cline could not confirm whether this message was accepted. Check the cloud session before resending it.",
					);
				}
				return {
					sessionId: outerSessionId,
					ok: true,
					...(delivery === "queue" ? { queued: true } : {}),
					recoveredAfterDisconnect: true,
					status: snapshot.status,
				};
			}
			removePendingMessage();
			if (live && ownsBusyState) {
				live.busy = false;
				live.status = "error";
			}
			this.publishSnapshot(outerSessionId);
			throw error;
		} finally {
			for (const requestId of dispatchedRequests)
				connection.pendingInputs?.delete(requestId);
		}
	}

	private async updateModel(
		connection: CloudConnection,
		requestedModelId?: string,
	): Promise<void> {
		const modelId = requestedModelId?.trim();
		if (!modelId || connection.remote.metadata.modelId === modelId) {
			return;
		}
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub session was not initialized");
		}
		await connection.client.command(
			"session.update_connection",
			{ sessionId: innerSessionId, updates: { modelId } },
			innerSessionId,
			{
				beforeDispatch: () => {
					this.assertSessionActive(connection.remote.id, connection);
					if (connection.innerSessionId !== innerSessionId) {
						throw new Error(
							"The cloud session reconnected before the model could be changed. Please try again.",
						);
					}
				},
			},
		);
		this.assertSessionActive(connection.remote.id, connection);
		this.applyModel(connection, modelId);
	}

	private applyModel(connection: CloudConnection, modelId: string): void {
		connection.remote.metadata.modelId = modelId;
		const live = this.sessions.get(connection.remote.id);
		if (live) {
			live.config.model = modelId;
			live.config.modelId = modelId;
		}
	}

	private async rehydrateAfterTransportDrop(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<CloudRehydrationSnapshot> {
		this.assertSessionActive(outerSessionId, connection);
		if (connection.rehydrationPromise) {
			connection.rehydrationRerunRequested = true;
			return await connection.rehydrationPromise;
		}
		const rehydration = (async () => {
			let snapshot: CloudRehydrationSnapshot | undefined;
			do {
				connection.rehydrationRerunRequested = false;
				snapshot = await this.performTransportRehydration(
					outerSessionId,
					connection,
				);
				this.assertSessionActive(outerSessionId, connection);
			} while (connection.rehydrationRerunRequested && !this.disposed);
			return snapshot;
		})().finally(() => {
			if (connection.rehydrationPromise === rehydration) {
				connection.rehydrationPromise = undefined;
				this.publishSnapshot(outerSessionId);
			}
		});
		connection.rehydrationPromise = rehydration;
		return await rehydration;
	}

	private async performTransportRehydration(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<CloudRehydrationSnapshot> {
		this.assertSessionActive(outerSessionId, connection);
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub session was not initialized");
		}
		connection.bufferingEvents = true;
		connection.bufferedEvents = [];
		connection.bufferedEventsDropped = 0;
		try {
			// command() waits for registration, including reconnect attempts.
			await this.ensureAttached(connection);
			this.assertSessionActive(outerSessionId, connection);
			const sessionReply = await connection.client.command(
				"session.get",
				{ includeSnapshot: true },
				innerSessionId,
			);
			this.assertSessionActive(outerSessionId, connection);
			const session =
				sessionReply.payload?.session &&
				typeof sessionReply.payload.session === "object" &&
				!Array.isArray(sessionReply.payload.session)
					? (sessionReply.payload.session as JsonRecord)
					: undefined;
			this.applySessionModel(connection, session);
			const live = this.sessions.get(outerSessionId);
			const baselineMessages =
				this.authoritativeMessages.get(outerSessionId) ?? [];
			const runtimeStatus = String(
				session?.status ?? live?.status ?? "running",
			).trim();
			const status = runtimeStatus === "pending" ? "running" : runtimeStatus;
			// Initial hydration can miss run.started. Arm its terminal refresh once;
			// rearming on a lagging terminal snapshot would start another refresh.
			// The history read below already covers the run's first progress.
			if (
				status === "running" &&
				!connection.transcriptKnown &&
				!connection.pendingInputs?.size
			) {
				connection.externalRun ??= { progressHydrated: true };
			}

			const readMessages = () =>
				connection.client.command(
					"session.messages",
					{ sessionId: innerSessionId },
					innerSessionId,
				);
			const messagesReply = await readMessages().catch((error) => {
				if (!isHubCommandTimeoutError(error, "session.messages")) throw error;
				this.assertSessionActive(outerSessionId, connection);
				return readMessages();
			});
			this.assertSessionActive(outerSessionId, connection);
			if (!Array.isArray(messagesReply.payload?.messages)) {
				throw new Error("Cloud Hub returned an invalid transcript snapshot");
			}
			const messages = messagesReply.payload.messages;
			const messagesSnapshotEventCutoff =
				connection.bufferedEventsDropped + connection.bufferedEvents.length;
			const queueReply = await connection.client
				.command(
					"session.pending_prompts",
					{ sessionId: innerSessionId },
					innerSessionId,
				)
				.catch(() => undefined);
			this.assertSessionActive(outerSessionId, connection);
			const queueSnapshotEventCutoff =
				connection.bufferedEventsDropped + connection.bufferedEvents.length;

			if (live) {
				const statusChanged = live.status !== status;
				this.authoritativeMessages.set(
					outerSessionId,
					structuredClone(messages),
				);
				live.messages = structuredClone(messages);
				this.streamingMessages.delete(outerSessionId);
				live.status = status;
				live.busy = status === "running";
				if (statusChanged) {
					if (
						status === "completed" ||
						status === "failed" ||
						status === "aborted"
					) {
						live.endedAt = Date.now();
						this.notify("chat_session_ended", {
							sessionId: outerSessionId,
							// The live run.failed path reports "error"; keep the
							// rehydrated terminal state on the same vocabulary.
							reason: status === "failed" ? "error" : status,
						});
					} else {
						this.notify("chat_session_status", {
							sessionId: outerSessionId,
							status,
						});
					}
				}
			}
			// Only a successful prompts array supersedes buffered queue events.
			const queueSnapshotValid =
				queueReply !== undefined &&
				queueReply.ok !== false &&
				Array.isArray(queueReply.payload?.prompts);
			const prompts = queueSnapshotValid
				? this.applyQueueSnapshot(outerSessionId, queueReply)
				: undefined;
			connection.transcriptKnown = true;

			// Publish the snapshot before releasing the reconciled tail.
			const displayMessages = messages;
			this.assertSessionActive(outerSessionId, connection);
			this.notify("cloud_session_rehydrated", {
				sessionId: outerSessionId,
				status,
				transcriptKnown: true,
				messages: displayMessages,
			});
			this.assertSessionActive(outerSessionId, connection);
			const bufferedEvents = connection.bufferedEvents;
			const submittedPrompts = submittedPromptsFromEvents(bufferedEvents);
			const buffered = reconcileBufferedCloudEvents(bufferedEvents, messages, {
				queueSnapshotApplied: queueSnapshotValid,
				queueSnapshotEventCutoff: Math.max(
					0,
					queueSnapshotEventCutoff - connection.bufferedEventsDropped,
				),
				messagesSnapshotEventCutoff: Math.max(
					0,
					messagesSnapshotEventCutoff - connection.bufferedEventsDropped,
				),
				baselineMessages,
			});
			connection.bufferedEvents = [];
			connection.bufferingEvents = false;
			connection.syncFailureNotified = false;
			for (const event of buffered) {
				this.forwardEvent(outerSessionId, connection, event);
			}
			return { status, messages, prompts, submittedPrompts };
		} catch (error) {
			// Preserve the current view and release the full tail on snapshot failure.
			const buffered = connection.bufferedEvents;
			connection.bufferedEvents = [];
			connection.bufferingEvents = false;
			this.assertSessionActive(outerSessionId, connection);
			for (const event of buffered) {
				this.forwardEvent(outerSessionId, connection, event);
			}
			// Notify once per failure transition, not on every reconnect attempt.
			if (!connection.syncFailureNotified) {
				connection.syncFailureNotified = true;
				this.notify("cloud_session_sync_failed", {
					sessionId: outerSessionId,
					message: error instanceof Error ? error.message : String(error),
				});
			}
			throw error;
		}
	}

	async abort(
		outerSessionId: string,
	): Promise<{ sessionId: string; ok: true }> {
		this.sendAbortTokens.set(outerSessionId, Symbol());
		if (
			this.abortProvisioningControllers(
				outerSessionId,
				new Error("Cloud session prompt cancelled"),
			)
		) {
			return { sessionId: outerSessionId, ok: true };
		}
		const connection = await this.ensureConnection(outerSessionId);
		const throwIfDisposed = () => {
			if (this.disposed || connection.disposed) {
				throw new Error("Cloud session connection was disposed");
			}
		};
		throwIfDisposed();
		await connection.client.connect();
		await connection.reconnectResolution;
		throwIfDisposed();
		// Reconnect clears the id and may swallow lookup errors for background
		// retry. Stop must resolve it or surface the failure before acknowledging.
		await this.resolveInnerSession(outerSessionId, connection);
		if (connection.innerSessionId) {
			await this.ensureAttached(connection);
			await connection.reconnectResolution;
			throwIfDisposed();
			const innerSessionId = connection.innerSessionId;
			if (!innerSessionId)
				throw new Error("Cloud Hub session was not initialized");
			await connection.client.command(
				"run.abort",
				{ sessionId: innerSessionId },
				innerSessionId,
				{
					beforeDispatch: () => {
						throwIfDisposed();
						if (connection.innerSessionId !== innerSessionId) {
							throw new Error(
								"The cloud session reconnected before Stop could be sent. Please try Stop again.",
							);
						}
					},
				},
			);
		}
		throwIfDisposed();
		const live = this.sessions.get(outerSessionId);
		if (live) {
			live.busy = false;
			live.status = "aborted";
		}
		this.publishSnapshot(outerSessionId);
		return { sessionId: outerSessionId, ok: true };
	}

	async pendingPrompts(outerSessionId: string): Promise<JsonRecord> {
		if (this.knownSessions.get(outerSessionId)?.status === "provisioning") {
			return { sessionId: outerSessionId, promptsInQueue: [] };
		}
		const connection = await this.ensureConnection(outerSessionId);
		if (!connection.innerSessionId) {
			return { sessionId: outerSessionId, promptsInQueue: [] };
		}
		const reply = await this.queueCommand(
			outerSessionId,
			"session.pending_prompts",
			{},
		);
		return {
			sessionId: outerSessionId,
			promptsInQueue: this.applyQueueSnapshot(outerSessionId, reply),
		};
	}

	async updatePendingPrompt(
		outerSessionId: string,
		promptId: string,
		changes: { prompt?: string; delivery?: "queue" | "steer" },
	): Promise<JsonRecord> {
		const reply = await this.queueCommand(
			outerSessionId,
			"session.update_pending_prompt",
			{ promptId, ...changes },
		);
		return {
			sessionId: outerSessionId,
			updated: reply.payload?.updated === true,
			promptsInQueue: this.applyQueueSnapshot(outerSessionId, reply),
		};
	}

	async removePendingPrompt(
		outerSessionId: string,
		promptId: string,
	): Promise<JsonRecord> {
		const reply = await this.queueCommand(
			outerSessionId,
			"session.remove_pending_prompt",
			{ promptId },
		);
		return {
			sessionId: outerSessionId,
			removed: reply.payload?.removed === true,
			promptsInQueue: this.applyQueueSnapshot(outerSessionId, reply),
		};
	}

	private async queueCommand(
		outerSessionId: string,
		command:
			| "session.pending_prompts"
			| "session.update_pending_prompt"
			| "session.remove_pending_prompt",
		payload: Record<string, unknown>,
	): Promise<{ ok: boolean; payload?: Record<string, unknown> }> {
		const connection = await this.ensureConnection(outerSessionId);
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub session was not initialized");
		}
		await connection.client.connect();
		await connection.reconnectResolution;
		await this.ensureAttached(connection);
		await connection.reconnectResolution;
		const reply = await connection.client.command(
			command,
			{ sessionId: innerSessionId, ...payload },
			innerSessionId,
			{
				beforeDispatch: () => {
					this.assertSessionActive(outerSessionId, connection);
					if (connection.innerSessionId !== innerSessionId) {
						throw new Error(
							"The cloud session reconnected before the queue request could be sent. Refresh the queue and try again.",
						);
					}
				},
			},
		);
		this.assertSessionActive(outerSessionId, connection);
		return reply;
	}

	private applyQueueSnapshot(
		outerSessionId: string,
		reply: { payload?: Record<string, unknown> },
	): CloudQueuedPrompt[] {
		// A missing prompts array is invalid, not an empty queue.
		if (!Array.isArray(reply.payload?.prompts)) {
			throw new Error("Cloud Hub returned an invalid pending-prompts snapshot");
		}
		const items = reply.payload.prompts as Array<Record<string, unknown>>;
		const mapped: CloudQueuedPrompt[] = items
			.map((item) => ({
				id: typeof item.id === "string" ? item.id : "",
				prompt: typeof item.prompt === "string" ? item.prompt : "",
				steer: item.delivery === "steer",
				attachmentCount:
					typeof item.attachmentCount === "number" ? item.attachmentCount : 0,
				userImages: Array.isArray(item.userImages)
					? item.userImages.filter(
							(image): image is string => typeof image === "string",
						)
					: undefined,
			}))
			.filter((item) => item.id);
		const live = this.sessions.get(outerSessionId);
		if (live) {
			live.promptsInQueue = mapped;
		}
		this.publishSnapshot(outerSessionId, false, "queue");
		return mapped;
	}

	async readMessages(outerSessionId: string): Promise<unknown[]> {
		const known = this.knownSessions.get(outerSessionId);
		if (known?.status === "provisioning" || known?.status === "failed") {
			return [];
		}
		if (known && isExpiredRecord(known)) {
			// An expired session with no snapshot legitimately has no transcript.
			return (await this.loadArchivedMessages(known)) ?? [];
		}
		try {
			const connection = await this.ensureConnection(outerSessionId);
			if (!connection.innerSessionId) {
				return [];
			}
			return (
				await this.rehydrateAfterTransportDrop(outerSessionId, connection)
			).messages;
		} catch (error) {
			// Fall back only to a real archive; [] on 404 would mask live failures.
			const refreshed =
				(await this.refreshKnownSession(outerSessionId)) ?? known;
			if (refreshed) {
				const archived = await this.loadArchivedMessages(refreshed).catch(
					() => null,
				);
				if (archived !== null) {
					return archived;
				}
			}
			throw error;
		}
	}

	async updateTitle(outerSessionId: string, title: string): Promise<void> {
		const previous = this.titleWrites.get(outerSessionId);
		const write = (async () => {
			await previous?.catch(() => {});
			this.assertSessionActive(outerSessionId);
			await this.options.api.updateTitle(outerSessionId, title);
			const record = this.knownSessions.get(outerSessionId);
			if (record) {
				record.title = title;
			}
			const live = this.sessions.get(outerSessionId);
			if (live) {
				live.title = title;
			}
			this.publishSnapshot(outerSessionId);
		})();
		this.titleWrites.set(outerSessionId, write);
		try {
			await write;
		} finally {
			if (this.titleWrites.get(outerSessionId) === write) {
				this.titleWrites.delete(outerSessionId);
			}
		}
	}

	async delete(outerSessionId: string): Promise<void> {
		// Tombstone the id so a concurrent attach/send/readMessages cannot dial
		// a fresh connection for a session that is being torn down.
		this.deletingSessions.add(outerSessionId);
		this.abortProvisioningControllers(outerSessionId);
		try {
			const pendingConnect = this.connectionPromises.get(outerSessionId);
			if (pendingConnect) {
				await pendingConnect.catch(() => undefined);
			}
			await this.disposeConnection(outerSessionId);
			try {
				await this.options.api.delete(outerSessionId);
			} catch (error) {
				// A session already gone remotely must still be deletable
				// locally, or its row becomes permanently stuck in the UI.
				const code = error instanceof CloudSessionError ? error.code : "";
				if (code !== "session_not_found" && code !== "session_expired") {
					throw error;
				}
			}
			this.knownSessions.delete(outerSessionId);
			this.unlistedSessions.delete(outerSessionId);
			this.pendingInitialTasks.delete(outerSessionId);
			this.sessions.delete(outerSessionId);
			this.authoritativeMessages.delete(outerSessionId);
			this.restoredOptions.delete(outerSessionId);
			this.publish({ type: "removed", sessionId: outerSessionId });
			this.sendAbortTokens.delete(outerSessionId);
			for (const [requestId, pending] of this.approvals) {
				if (pending.item.sessionId === outerSessionId) {
					this.approvals.delete(requestId);
				}
			}
		} finally {
			this.deletingSessions.delete(outerSessionId);
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		for (const sessionId of this.snapshotTimers.keys())
			this.cancelScheduledSnapshot(sessionId);
		this.sendAbortTokens.clear();
		for (const controllers of this.provisioningControllers.values()) {
			for (const controller of controllers) controller.abort();
		}
		this.provisioningControllers.clear();
		const sessionIds = new Set([
			...this.connections.keys(),
			...this.knownSessions.keys(),
			...this.sessions.keys(),
		]);
		// Clear shared state before awaiting teardown; a replacement manager
		// may populate it while this one is disposing.
		for (const [requestId, pending] of this.approvals) {
			if (sessionIds.has(pending.item.sessionId)) {
				this.approvals.delete(requestId);
			}
		}
		for (const sessionId of sessionIds) {
			this.sessions.delete(sessionId);
			this.knownSessions.delete(sessionId);
			this.publish({ type: "removed", sessionId });
		}
		this.knownSessions.clear();
		this.unlistedSessions.clear();
		if (!this.options.pendingInitialTasks) this.pendingInitialTasks.clear();
		this.listeners.clear();
		await Promise.allSettled(
			Array.from(this.connections.keys()).map((sessionId) =>
				this.disposeConnection(sessionId),
			),
		);
	}

	private async attachExpired(
		record: CloudSessionRecord,
	): Promise<CloudSessionAttachment> {
		const live =
			this.sessions.get(record.id) ?? recordToCloudSessionState(record);
		live.busy = false;
		live.status = "expired";
		this.sessions.set(record.id, live);
		await this.loadArchivedMessages(record).catch(() => undefined);
		return attachResultPayload(record, "expired");
	}

	private async loadArchivedMessages(
		record: CloudSessionRecord,
	): Promise<unknown[] | null> {
		const generation = this.sessionGenerations.get(record.id);
		const messages = await this.options.api.history(record.id);
		this.assertSessionActive(record.id);
		if (this.sessionGenerations.get(record.id) !== generation)
			throw new Error("Cloud session attachment changed while loading history");
		if (messages === null) {
			return null;
		}
		const live =
			this.sessions.get(record.id) ?? recordToCloudSessionState(record);
		live.messages = structuredClone(messages) as MessageWithMetadata[];
		this.sessions.set(record.id, live);
		this.authoritativeMessages.set(record.id, structuredClone(live.messages));
		this.publishSnapshot(record.id, true);
		return messages;
	}

	private async refreshKnownSession(
		outerSessionId: string,
	): Promise<CloudSessionRecord | undefined> {
		const organizationId = await this.resolveActiveOrganizationId();
		const sessions = await this.options.api
			.list(organizationId)
			.catch(() => undefined);
		if (this.disposed) throw new Error("Cloud session manager was disposed");
		if (!sessions) {
			return this.knownSessions.get(outerSessionId);
		}
		for (const session of sessions) {
			this.knownSessions.set(session.id, session);
		}
		return sessions.find((session) => session.id === outerSessionId);
	}

	private async ensureKnownSession(
		outerSessionId: string,
	): Promise<CloudSessionRecord> {
		const known = this.knownSessions.get(outerSessionId);
		if (known) {
			return known;
		}
		const record = (await this.list()).find(
			(session) => session.id === outerSessionId,
		);
		if (!record) {
			throw new CloudSessionError(
				"session_not_found",
				`Cloud session ${outerSessionId} was not found.`,
			);
		}
		// list() exposes frozen copies; transport metadata must use owned state.
		return this.knownSessions.get(outerSessionId) ?? structuredClone(record);
	}

	private assertSessionActive(
		outerSessionId: string,
		connection?: CloudConnection,
	): void {
		if (
			this.disposed ||
			connection?.disposed ||
			this.detachedSessions.has(outerSessionId) ||
			(connection?.generation !== undefined &&
				connection.generation !==
					(this.sessionGenerations.get(outerSessionId) ?? 0))
		) {
			throw new Error("Cloud session connection was disposed");
		}
		if (this.deletingSessions.has(outerSessionId)) {
			throw new CloudSessionError(
				"session_not_found",
				"This cloud session is being deleted.",
			);
		}
	}

	private async ensureConnection(
		outerSessionId: string,
		options: { createInner?: boolean } = {},
	): Promise<CloudConnection> {
		const generation = this.sessionGenerations.get(outerSessionId) ?? 0;
		const assertCurrent = () => {
			this.assertSessionActive(outerSessionId);
			if (generation !== (this.sessionGenerations.get(outerSessionId) ?? 0))
				throw new Error("Cloud viewer detached during connection");
		};
		assertCurrent();
		// The client is registered early to retain its reconnect loop, before
		// initial root resolution finishes. Callers must await that resolution.
		const pending = this.connectionPromises.get(outerSessionId);
		const existing = pending
			? await pending
			: this.connections.get(outerSessionId);
		if (existing) {
			this.assertSessionActive(outerSessionId, existing);
			// Reconnect clears the id while looking up the existing root session.
			await existing.reconnectResolution;
			this.assertSessionActive(outerSessionId, existing);
			if (!existing.innerSessionId) {
				// An initial failed upgrade can leave a retained, unresolved client.
				await existing.client.connect();
				await existing.reconnectResolution;
				this.assertSessionActive(outerSessionId, existing);
				await this.resolveInnerSession(outerSessionId, existing);
				this.assertSessionActive(outerSessionId, existing);
			}
			if (options.createInner && !existing.innerSessionId)
				await this.createInnerSession(existing);
			this.assertSessionActive(outerSessionId, existing);
			return existing;
		}

		const connecting = (async () => {
			let remote = await this.ensureKnownSession(outerSessionId);
			assertCurrent();
			if (remote.status === "provisioning") {
				const controller = new AbortController();
				const releaseController = this.trackProvisioningController(
					outerSessionId,
					controller,
				);
				try {
					await this.options.api.waitUntilReady(
						outerSessionId,
						controller.signal,
						({ phase }) => {
							remote.metadata.provisioningPhase = phase;
							this.notify("chat_session_status", {
								sessionId: outerSessionId,
								status: "provisioning",
								phase,
							});
						},
					);
					if (this.disposed)
						throw new Error("Cloud session manager was disposed");
					remote = (await this.refreshKnownSession(outerSessionId)) ?? remote;
					controller.signal.throwIfAborted();
					if (remote.status === "provisioning") remote.status = "ready";
					const live = this.sessions.get(outerSessionId);
					if (live?.status === "provisioning") live.status = "idle";
				} catch (error) {
					if (
						error instanceof CloudSessionError &&
						error.code === "session_failed"
					) {
						remote.status = "failed";
						remote.metadata.statusReason = error.detail;
						remote.metadata.provisioningPhase = "failed";
						if (!this.disposed) this.knownSessions.set(outerSessionId, remote);
						const live = this.sessions.get(outerSessionId);
						if (live) live.status = "error";
						this.notify("chat_session_status", {
							sessionId: outerSessionId,
							status: "error",
						});
					}
					throw error;
				} finally {
					releaseController();
				}
			}
			assertCurrent();
			if (remote.status === "failed") {
				throw new CloudSessionError(
					"session_failed",
					remote.metadata.statusReason ||
						"The cloud sandbox could not be prepared.",
				);
			}
			// Surface expiry before the proxy turns it into an upgrade failure.
			if (isExpiredRecord(remote)) {
				throw new CloudSessionError(
					"session_expired",
					"This cloud session has expired; its sandbox is gone. Start a new cloud session to continue.",
				);
			}
			this.sessions.set(
				outerSessionId,
				this.sessions.get(outerSessionId) ?? this.stateFromRecord(remote),
			);
			let connection: CloudConnection | undefined;
			let socketAttempt = 0;
			const client = this.createHubClient({
				url: toWebSocketUrl(this.options.apiBaseUrl, outerSessionId),
				// Unique client IDs prevent one viewer's close from unregistering another.
				clientId: `${this.options.clientIdentity?.prefix ?? "cloud"}-${outerSessionId}-${randomUUID()}`,
				clientType: this.options.clientIdentity?.type ?? "cloud-client",
				displayName:
					this.options.clientIdentity?.displayName ?? "Cline cloud session",
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				resolveConnectionHeaders: async () => {
					assertCurrent();
					const reconnecting = socketAttempt > 0;
					socketAttempt += 1;
					if (connection) {
						connection.connected = false;
						connection.reconnecting = reconnecting;
						this.publishSnapshot(outerSessionId);
					}
					if (reconnecting) {
						const reconnected = connection;
						if (reconnected && !reconnected.disposed) {
							// Publish reconnect recovery synchronously so a concurrent send
							// cannot capture the previous inner-session id.
							reconnected.transcriptKnown = false;
							reconnected.innerSessionId = undefined;
							const resolution = (async () => {
								await this.resolveInnerSession(outerSessionId, reconnected);
								if (reconnected.innerSessionId) {
									await this.rehydrateAfterTransportDrop(
										outerSessionId,
										reconnected,
									);
								}
							})()
								.catch(() =>
									this.disposeConnectionIfSessionGone(
										outerSessionId,
										reconnected,
									),
								)
								.finally(() => {
									if (reconnected.reconnectResolution === resolution) {
										reconnected.reconnectResolution = undefined;
										reconnected.connected = reconnected.transcriptKnown;
										this.publishSnapshot(outerSessionId);
									}
								});
							reconnected.reconnectResolution = resolution;
						}
					}
					const token = await this.options.getAuthToken();
					if (!token?.trim()) {
						throw new CloudSessionError(
							"authentication_required",
							"Sign in to Cline to reconnect this cloud session.",
						);
					}
					assertCurrent();
					return { Authorization: `Bearer ${token.trim()}` };
				},
			});
			connection = {
				generation,
				remote,
				client,
				bufferedEvents: [],
				bufferedEventsDropped: 0,
				transcriptKnown: false,
				seenEventIds: new Set(),
				unsubscribe: () => {},
			};
			// A scoped placeholder subscription keeps the client's built-in retry
			// loop alive if the first WebSocket upgrade races pod startup.
			connection.unsubscribe = client.subscribe(() => {}, {
				sessionId: remote.metadata.taskId?.trim() || outerSessionId,
			});
			this.connections.set(outerSessionId, connection);
			try {
				await client.connect();
				connection.connected = true;
				this.publishSnapshot(outerSessionId);
				this.assertSessionActive(outerSessionId, connection);
				await this.resolveInnerSession(outerSessionId, connection);
				this.assertSessionActive(outerSessionId, connection);
				if (options.createInner && !connection.innerSessionId) {
					await this.createInnerSession(connection);
				}
				this.assertSessionActive(outerSessionId, connection);
				return connection;
			} catch (error) {
				if (
					isHubReconnectableTransportError(error) &&
					!this.disposed &&
					!connection.disposed &&
					!this.deletingSessions.has(outerSessionId)
				) {
					throw error;
				}
				if (this.connections.get(outerSessionId) === connection)
					this.connections.delete(outerSessionId);
				connection.disposed = true;
				connection.unsubscribe();
				// Approvals stored during the failed setup hold resolve closures
				// over this dead connection. A disposed manager already cleared
				// its state; a replacement may now own the shared approval entries.
				if (
					!this.disposed &&
					generation === (this.sessionGenerations.get(outerSessionId) ?? 0)
				) {
					this.clearPendingApprovals(outerSessionId);
				}
				await client.dispose().catch(() => undefined);
				throw error;
			}
		})().finally(() => {
			if (this.connectionPromises.get(outerSessionId) === connecting)
				this.connectionPromises.delete(outerSessionId);
		});
		this.connectionPromises.set(outerSessionId, connecting);
		return await connecting;
	}

	private async resolveInnerSession(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<void> {
		this.assertSessionActive(outerSessionId, connection);
		if (connection.innerSessionId) return;
		const taskId = connection.remote.metadata.taskId?.trim();
		let session: JsonRecord | undefined;
		if (taskId) {
			try {
				const reply = await connection.client.command(
					"session.get",
					{ sessionId: taskId },
					taskId,
				);
				this.assertSessionActive(outerSessionId, connection);
				session =
					reply.payload?.session &&
					typeof reply.payload.session === "object" &&
					!Array.isArray(reply.payload.session)
						? (reply.payload.session as JsonRecord)
						: undefined;
			} catch (error) {
				if (!isSessionNotFoundError(error)) throw error;
			}
		} else {
			const listed = await connection.client.command("session.list", {
				limit: 100,
			});
			this.assertSessionActive(outerSessionId, connection);
			session = readSessionRows(listed.payload)
				.filter(isRootSessionRow)
				.sort((left, right) => updatedAt(right) - updatedAt(left))[0];
		}
		const innerSessionId = String(session?.sessionId ?? "").trim();
		if (!innerSessionId) {
			if (!this.pendingInitialTasks.has(outerSessionId)) {
				throw new Error(
					"This cloud session's task is unavailable. Start a new cloud session to continue.",
				);
			}
			return;
		}
		this.pendingInitialTasks.delete(outerSessionId);
		connection.innerSessionId = innerSessionId;
		this.subscribeToInnerSession(outerSessionId, connection);
		const modelId = sessionRowModelId(session);
		if (modelId) this.applyModel(connection, modelId);
		await this.ensureAttached(connection);
	}

	private async createInnerSession(connection: CloudConnection): Promise<void> {
		this.assertSessionActive(connection.remote.id, connection);
		if (connection.innerSessionId) {
			return;
		}
		if (connection.innerSessionCreation) {
			return await connection.innerSessionCreation;
		}
		const creation = this.createInnerSessionOnce(connection).finally(() => {
			connection.innerSessionCreation = undefined;
		});
		connection.innerSessionCreation = creation;
		return await creation;
	}

	private async createInnerSessionOnce(
		connection: CloudConnection,
	): Promise<void> {
		const modelId = connection.remote.metadata.modelId?.trim();
		if (!modelId) {
			throw new Error("Cloud session is missing its model id");
		}
		const live = this.sessions.get(connection.remote.id);
		const branch = `cline/${(connection.remote.metadata.taskId?.trim() || connection.remote.id).slice(-8).toLowerCase()}`;
		const systemPrompt =
			`${CLOUD_SESSION_SYSTEM_PROMPT}\n\n` +
			"SAVE YOUR WORK: This sandbox is temporary. Push your progress to origin so it remains available outside the sandbox. " +
			`The branch \`${branch}\` is a backup of your work-in-progress, not a finished deliverable, so commit to it freely even when the work is incomplete. ` +
			"Do all work for this task on that branch: create it from the current checkout before your first change " +
			"(or check it out if it already exists), and never commit directly to the default branch. " +
			"Commit regularly as you complete meaningful steps, using clear, descriptive messages. " +
			`The first time you commit, push the branch with \`git push -u origin ${branch}\`, and push again after each later commit. ` +
			"Do not force-push or amend commits that are already pushed unless the user explicitly asks.";
		const reply = await connection.client.command("session.create", {
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			cwd: CLOUD_WORKSPACE_ROOT,
			sessionConfig: {
				...(connection.remote.metadata.taskId?.trim()
					? { sessionId: connection.remote.metadata.taskId.trim() }
					: {}),
				providerId: "cline",
				modelId,
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				systemPrompt,
				mode: "act",
				enableTools: true,
				...(typeof live?.config.thinking === "boolean"
					? { thinking: live.config.thinking }
					: {}),
				...(typeof live?.config.reasoningEffort === "string"
					? { reasoningEffort: live.config.reasoningEffort }
					: {}),
			},
			metadata: {
				source: this.options.clientIdentity?.source ?? "sdk",
				provider: "cline",
				model: modelId,
				interactive: true,
			},
			runtimeOptions: { mode: "act" },
			modelSelection: { provider: "cline", model: modelId },
			toolPolicies: {
				"*": { autoApprove: live?.config.autoApproveTools !== false },
			},
		});
		this.assertSessionActive(connection.remote.id, connection);
		const session =
			reply.payload?.session && typeof reply.payload.session === "object"
				? (reply.payload.session as JsonRecord)
				: undefined;
		const innerSessionId = String(
			session?.sessionId ?? reply.payload?.sessionId ?? "",
		).trim();
		if (!innerSessionId) {
			throw new Error("Cloud Hub did not return an inner session id");
		}
		connection.innerSessionId = innerSessionId;
		this.subscribeToInnerSession(connection.remote.id, connection);
		this.pendingInitialTasks.delete(connection.remote.id);
		this.applySessionModel(connection, session);
		// A newly-created inner session has an authoritative empty transcript.
		connection.transcriptKnown = true;
	}

	private handleEvent(
		outerSessionId: string,
		connection: CloudConnection,
		event: HubEventEnvelope,
	): void {
		if (this.disposed || connection.disposed) return;
		if (
			connection.innerSessionId &&
			event.sessionId &&
			event.sessionId !== connection.innerSessionId
		) {
			return;
		}
		const eventId = event.eventId?.trim();
		// Pending-approval replays have no sequence and rebuild state after reconnect.
		if (
			eventId &&
			!(event.event === "approval.requested" && event.sequence === undefined)
		) {
			if (connection.seenEventIds.has(eventId)) return;
			connection.seenEventIds.add(eventId);
			while (connection.seenEventIds.size > MAX_SEEN_EVENT_IDS) {
				const removed = connection.seenEventIds.values().next().value;
				if (removed) connection.seenEventIds.delete(removed);
			}
		}
		if (connection.bufferingEvents) {
			connection.bufferedEvents.push(event);
			if (connection.bufferedEvents.length > MAX_BUFFERED_SYNC_EVENTS) {
				connection.bufferedEvents.shift();
				connection.bufferedEventsDropped += 1;
				this.options.logger?.log("Cloud sync event buffer reached its limit", {
					sessionId: outerSessionId,
					severity: "warn",
				});
			}
			return;
		}
		this.forwardEvent(outerSessionId, connection, event);
	}

	private forwardEvent(
		outerSessionId: string,
		connection: CloudConnection,
		event: HubEventEnvelope,
	): void {
		if (this.disposed || connection.disposed) return;
		if (
			event.event === "session.attached" ||
			event.event === "session.updated" ||
			event.event === "session.created"
		) {
			this.applySessionModel(connection, event.payload?.session);
		}
		if (event.event === "approval.requested") {
			this.handleApprovalRequested(outerSessionId, connection, event);
			return;
		}
		if (event.event === "approval.resolved") {
			const approvalId = String(event.payload?.approvalId ?? "").trim();
			if (approvalId) {
				this.removeApproval(outerSessionId, approvalId);
			}
			return;
		}
		if (event.event === "run.started") {
			// The Hub also emits this for queue/steer acceptance during a run.
			// Acknowledge the input without changing ownership of the active run.
			const alreadyRunning = this.sessions.get(outerSessionId)?.busy;
			const requestId = event.payload?.requestId;
			const pending =
				typeof requestId === "string"
					? connection.pendingInputs?.get(requestId)
					: undefined;
			if (pending && event.payload?.clientId === pending.clientId) {
				pending.accept();
				if (pending.ownsBusyState) connection.externalRun = undefined;
			} else if (typeof event.payload?.clientId === "string") {
				connection.externalRun ??= {
					progressHydrated: Boolean(alreadyRunning),
				};
			}
		}
		const external = connection.externalRun;
		const terminal =
			event.event === "run.completed" ||
			event.event === "run.failed" ||
			event.event === "run.aborted";
		const firstProgress =
			external &&
			!external.progressHydrated &&
			(event.event === "assistant.delta" ||
				event.event === "reasoning.delta" ||
				event.event === "tool.started");
		if (external && (firstProgress || terminal)) {
			external.progressHydrated = true;
			if (terminal) connection.externalRun = undefined;
			const alreadyHydrating = Boolean(connection.rehydrationPromise);
			// run.started precedes prompt persistence. First progress is the earliest
			// useful baseline; the terminal refresh also captures canonical final output.
			void this.rehydrateAfterTransportDrop(outerSessionId, connection).catch(
				(error) => {
					if (this.disposed || connection.disposed) return;
					this.notify("cloud_session_sync_failed", {
						sessionId: outerSessionId,
						message:
							error instanceof Error
								? error.message
								: "Cloud transcript refresh failed",
					});
				},
			);
			if (!alreadyHydrating) {
				// Include the triggering event in normal snapshot/tail reconciliation.
				connection.bufferedEvents.push(event);
				return;
			}
		}
		this.applyLiveEvent(outerSessionId, event);
		this.publish({
			type: "hub_event",
			sessionId: outerSessionId,
			event: { ...event, sessionId: outerSessionId },
		});
		// UI deltas stream immediately; only the full cached transcript is batched.
		if (
			event.event === "assistant.delta" ||
			event.event === "reasoning.delta" ||
			event.event === "tool.updated"
		)
			this.scheduleSnapshot(outerSessionId);
		else this.publishSnapshot(outerSessionId);
	}

	private handleApprovalRequested(
		outerSessionId: string,
		connection: CloudConnection,
		event: HubEventEnvelope,
	): void {
		this.storePendingApproval(outerSessionId, connection, event.payload);
		this.sendApprovalSnapshot(outerSessionId);
	}

	private storePendingApproval(
		outerSessionId: string,
		connection: CloudConnection,
		payload: Record<string, unknown> | undefined,
	): void {
		const approvalId = String(payload?.approvalId ?? "").trim();
		if (!approvalId) {
			return;
		}
		const requestId = `${outerSessionId}:${approvalId}`;
		const item: CloudApproval = {
			approvalId,
			requestId,
			sessionId: outerSessionId,
			createdAt: new Date(
				typeof payload?.createdAt === "number" ? payload.createdAt : Date.now(),
			).toISOString(),
			toolCallId: String(payload?.toolCallId ?? ""),
			toolName: String(payload?.toolName ?? "tool"),
			input: parseApprovalInput(payload?.inputJson),
			iteration:
				typeof payload?.iteration === "number" ? payload.iteration : undefined,
			agentId:
				typeof payload?.agentId === "string" ? payload.agentId : undefined,
			conversationId:
				typeof payload?.conversationId === "string"
					? payload.conversationId
					: undefined,
		};
		// Remote approvals outlive webview connections and have no local owner.
		this.approvals.set(requestId, {
			item,
			resolve: async (result) => {
				if (this.disposed || connection.disposed) {
					// Commanding a disposed NodeHubClient would silently redial;
					// make the user reopen the session instead.
					throw new Error(
						"This cloud session connection is closed; reopen the session to respond.",
					);
				}
				await this.ensureAttached(connection);
				if (this.disposed || connection.disposed) {
					throw new Error(
						"This cloud session connection is closed; reopen the session to respond.",
					);
				}
				await connection.client.command(
					"approval.respond",
					{
						approvalId,
						approved: result.approved,
						reason: result.reason,
					},
					connection.innerSessionId,
				);
			},
		});
	}

	private removeApproval(outerSessionId: string, approvalId: string): void {
		this.approvals.delete(`${outerSessionId}:${approvalId}`);
		this.sendApprovalSnapshot(outerSessionId);
	}

	private clearPendingApprovals(outerSessionId: string): void {
		for (const [requestId, pending] of this.approvals) {
			if (pending.item.sessionId === outerSessionId) {
				this.approvals.delete(requestId);
			}
		}
		this.sendApprovalSnapshot(outerSessionId);
	}

	private sendApprovalSnapshot(outerSessionId: string): void {
		this.notify("tool_approval_state", {
			sessionId: outerSessionId,
			items: Array.from(this.approvals.values())
				.filter((pending) => pending.item.sessionId === outerSessionId)
				.map((pending) => pending.item),
		});
	}

	private async ensureAttached(connection: CloudConnection): Promise<void> {
		this.assertSessionActive(connection.remote.id, connection);
		if (!connection.innerSessionId) {
			return;
		}
		const reply = await connection.client.command(
			"session.attach",
			{ sessionId: connection.innerSessionId },
			connection.innerSessionId,
		);
		this.assertSessionActive(connection.remote.id, connection);
		this.applySessionModel(connection, reply.payload?.session);
	}

	private subscribeToInnerSession(
		outerSessionId: string,
		connection: CloudConnection,
	): void {
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) return;
		connection.unsubscribe();
		// Rebuild from the Hub's pending-approval replay, not stale local buttons.
		this.clearPendingApprovals(outerSessionId);
		connection.unsubscribe = connection.client.subscribe(
			(event) => this.handleEvent(outerSessionId, connection, event),
			{ sessionId: innerSessionId },
		);
	}

	private applySessionModel(
		connection: CloudConnection,
		session: unknown,
	): void {
		if (!session || typeof session !== "object" || Array.isArray(session)) {
			return;
		}
		const modelId = sessionRowModelId(session as JsonRecord);
		if (modelId) this.applyModel(connection, modelId);
	}

	private async disposeConnection(outerSessionId: string): Promise<void> {
		this.cancelScheduledSnapshot(outerSessionId);
		const connection = this.connections.get(outerSessionId);
		this.connections.delete(outerSessionId);
		if (!connection) {
			return;
		}
		connection.disposed = true;
		connection.pendingInputs?.clear();
		connection.unsubscribe();
		this.clearPendingApprovals(outerSessionId);
		await connection.client.dispose();
	}

	/** Stop reconnecting only when the session is gone, not when lookup fails. */
	private async disposeConnectionIfSessionGone(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<void> {
		if (connection.disposed || this.disposed) return;
		let organizationId: string | undefined;
		try {
			organizationId = await this.resolveActiveOrganizationId();
		} catch {
			return;
		}
		const sessions = await this.options.api
			.list(organizationId)
			.catch(() => undefined);
		if (!sessions || connection.disposed) return;
		const listedRecord = sessions.find(
			(session) => session.id === outerSessionId,
		);
		const listed = listedRecord
			? this.preserveConnectedRuntimeModel(listedRecord)
			: undefined;
		if (!listed) {
			// Absent from a successful list; a later attach can reconnect if it reappears.
			await this.disposeConnection(outerSessionId).catch(() => undefined);
			return;
		}
		this.knownSessions.set(outerSessionId, listed);
		connection.remote = listed;
		if (listed.status === "failed") {
			const live = this.sessions.get(outerSessionId);
			if (live) {
				live.busy = false;
				live.status = "failed";
				live.endedAt = Date.parse(listed.updatedAt) || Date.now();
			}
			await this.disposeConnection(outerSessionId).catch(() => undefined);
			return;
		}
		if (isExpiredRecord(listed)) {
			await this.attachExpired(listed).catch(() => undefined);
			await this.disposeConnection(outerSessionId).catch(() => undefined);
		}
	}
}
