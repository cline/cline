import {
	ProviderSettingsManager,
	RuntimeOAuthTokenManager,
	resolveLocalClineAuthToken,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import { broadcastEvent } from "./context";
import { projectAgentMessages } from "./session-data/messages";
import type { JsonRecord, SidecarContext } from "./types";

// ---------------------------------------------------------------------------
// Cloud Sessions service
//
// Talks to the Cline Cloud remote-session API (the same API the dashboard's
// "Agents" page uses) on behalf of the desktop webview:
//   - REST:   session CRUD, GitHub integration status, repositories, models
//   - WS:     each remote session exposes a sandbox proxy speaking the Cline
//             hub protocol at  {apiBaseUrl}/api/v1/session/{id}
//
// The WebSocket lives in the sidecar (not the webview) because the proxy
// authenticates with a Bearer Authorization header on the HTTP upgrade, which
// browser WebSocket clients cannot send. Events are re-broadcast to webview
// clients over the existing sidecar transport.
// ---------------------------------------------------------------------------

// Internal/testing override so the whole cloud stack can be pointed at a
// local mock server without affecting the account/auth flows.
function cloudApiBaseUrl(): string {
	return (
		process.env.CLINE_CLOUD_API_BASE_URL?.trim().replace(/\/$/, "") ||
		getClineEnvironmentConfig().apiBaseUrl.replace(/\/$/, "")
	);
}

function cloudDashboardBaseUrl(): string {
	return (
		process.env.CLINE_CLOUD_APP_BASE_URL?.trim().replace(/\/$/, "") ||
		getClineEnvironmentConfig().appBaseUrl.replace(/\/$/, "")
	);
}

// Matches the system prompt the dashboard sends when starting the agent
// inside the sandbox: GitHub credentials are injected by the sandbox's
// secrets proxy, and the model needs to know not to look for tokens.
const SANDBOX_AGENT_SYSTEM_PROMPT =
	"IMPORTANT: GitHub API authentication is handled automatically by the infrastructure. " +
	"A secrets-proxy sidecar injects the necessary authentication credentials into all GitHub API requests. " +
	"You do NOT need to set up, configure, or manage any authentication tokens, API keys, or credentials for GitHub API calls. " +
	"Simply make your GitHub API calls normally — authentication will be injected transparently.";

const SANDBOX_WORKSPACE_ROOT = "/workspace";
const SANDBOX_CONNECT_TIMEOUT_MS = 15_000;
const SANDBOX_COMMAND_TIMEOUT_MS = 30_000;
const SANDBOX_RECONNECT_BASE_DELAY_MS = 500;
const SANDBOX_RECONNECT_MAX_DELAY_MS = 15_000;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// Access tokens expire between launches; resolve through the refresh-aware
// OAuth manager first (single shared instance keeps refreshes single-flight),
// then the persisted provider settings, then the CLINE_API_KEY environment
// variable that CLI/CI environments use.
let cloudOAuthTokenManager: RuntimeOAuthTokenManager | undefined;

export async function resolveCloudAuthToken(): Promise<string | undefined> {
	try {
		cloudOAuthTokenManager ??= new RuntimeOAuthTokenManager();
		const resolution = await cloudOAuthTokenManager.resolveProviderApiKey({
			providerId: "cline",
		});
		if (resolution?.apiKey) {
			return resolution.apiKey;
		}
	} catch {
		// Fall through to the persisted token / env var.
	}
	const manager = new ProviderSettingsManager();
	const persisted = resolveLocalClineAuthToken(
		manager.getProviderSettings("cline"),
	);
	return persisted ?? process.env.CLINE_API_KEY?.trim() ?? undefined;
}

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

export type CloudRemoteSession = {
	id: string;
	title?: string;
	status?: string;
	createdAt?: number | string;
	updatedAt?: number | string;
	expiredAt?: number | string;
	organizationId?: string | null;
	origin?: string;
	repoUrl?: string;
	modelId?: string;
};

export type CloudRepository = {
	id?: number | string;
	name?: string;
	fullName?: string;
	htmlUrl?: string;
	cloneUrl?: string;
	private?: boolean;
};

export type CloudModel = {
	id: string;
	name: string;
	description?: string;
	tags?: string[];
};

export class CloudApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code?: string,
	) {
		super(message);
		this.name = "CloudApiError";
	}
}

export function isGithubNotConnectedError(error: unknown): boolean {
	if (!(error instanceof CloudApiError)) {
		return false;
	}
	return (
		error.status === 412 ||
		/github.*not connected/i.test(error.message) ||
		/connect it under integrations/i.test(error.message)
	);
}

async function cloudApiRequest<T>(options: {
	method: "GET" | "POST" | "PATCH" | "DELETE";
	path: string;
	body?: unknown;
	query?: Record<string, string | undefined>;
}): Promise<T> {
	const token = await resolveCloudAuthToken();
	if (!token) {
		throw new CloudApiError(
			"No Cline account auth token found. Sign in to your Cline account first.",
			401,
			"not_signed_in",
		);
	}
	const url = new URL(`${cloudApiBaseUrl()}${options.path}`);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value !== undefined && value !== "") {
			url.searchParams.set(key, value);
		}
	}
	const response = await fetch(url, {
		method: options.method,
		headers: {
			authorization: `Bearer ${token}`,
			...(options.body !== undefined
				? { "content-type": "application/json" }
				: {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});
	let parsed: { success?: boolean; data?: unknown; error?: unknown } = {};
	const text = await response.text();
	if (text) {
		try {
			parsed = JSON.parse(text) as typeof parsed;
		} catch {
			// Non-JSON error bodies fall through to the status check below.
		}
	}
	if (!response.ok || parsed.success === false) {
		const message =
			typeof parsed.error === "string" && parsed.error.trim()
				? parsed.error.trim()
				: `Cline Cloud request failed (HTTP ${response.status})`;
		throw new CloudApiError(message, response.status);
	}
	return parsed.data as T;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function mapRemoteSession(record: JsonRecord): CloudRemoteSession | null {
	const id = asString(record.id);
	if (!id) {
		return null;
	}
	const metadata =
		record.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	const repoContext =
		record.repoContext && typeof record.repoContext === "object"
			? (record.repoContext as JsonRecord)
			: undefined;
	return {
		id,
		title: asString(record.title),
		status: asString(record.status),
		createdAt: record.createdAt as number | string | undefined,
		updatedAt: record.updatedAt as number | string | undefined,
		expiredAt: record.expiredAt as number | string | undefined,
		organizationId: asString(record.organizationId) ?? null,
		origin: asString(record.origin),
		repoUrl: asString(repoContext?.repoUrl),
		modelId: asString(metadata?.modelId),
	};
}

async function listRemoteSessions(
	organizationId?: string,
): Promise<CloudRemoteSession[]> {
	const data = await cloudApiRequest<unknown>({
		method: "GET",
		path: "/api/v1/session",
		query: { organizationId },
	});
	if (!Array.isArray(data)) {
		return [];
	}
	return data
		.filter((item): item is JsonRecord => !!item && typeof item === "object")
		.map(mapRemoteSession)
		.filter((session): session is CloudRemoteSession => session !== null);
}

async function createRemoteSession(input: {
	modelId: string;
	repoUrl: string;
	title: string;
	organizationId?: string;
}): Promise<{ sessionId: string; sandboxUrl?: string }> {
	const data = await cloudApiRequest<{
		sessionId?: string;
		sandboxUrl?: string;
	}>({
		method: "POST",
		path: "/api/v1/session",
		body: {
			modelId: input.modelId,
			organizationId: input.organizationId,
			repoUrl: input.repoUrl,
			title: input.title,
		},
	});
	const sessionId = asString(data?.sessionId);
	if (!sessionId) {
		throw new CloudApiError("Session creation returned no session id", 500);
	}
	return { sessionId, sandboxUrl: asString(data?.sandboxUrl) };
}

async function listGithubRepositories(
	organizationId?: string,
): Promise<CloudRepository[]> {
	const path = organizationId
		? `/api/v1/organizations/${encodeURIComponent(organizationId)}/integrations/github/repositories`
		: "/api/v1/integrations/github/repositories";
	const data = await cloudApiRequest<unknown>({ method: "GET", path });
	if (!Array.isArray(data)) {
		return [];
	}
	return data
		.filter((item): item is JsonRecord => !!item && typeof item === "object")
		.map((record) => ({
			id: record.id as number | string | undefined,
			name: asString(record.name),
			fullName: asString(record.full_name) ?? asString(record.fullName),
			htmlUrl: asString(record.html_url) ?? asString(record.htmlUrl),
			cloneUrl: asString(record.clone_url) ?? asString(record.cloneUrl),
			private: record.private === true || record._private === true,
		}));
}

async function listCloudModels(): Promise<CloudModel[]> {
	const data = await cloudApiRequest<unknown>({
		method: "GET",
		path: "/api/v1/ai/cline/models",
	});
	if (!Array.isArray(data)) {
		return [];
	}
	const models: CloudModel[] = [];
	for (const item of data) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const record = item as JsonRecord;
		const id = asString(record.id);
		if (!id) {
			continue;
		}
		models.push({
			id,
			name: asString(record.displayName) ?? asString(record.name) ?? id,
			description: asString(record.description),
			tags: Array.isArray(record.tags)
				? record.tags.filter(
						(tag): tag is string => typeof tag === "string" && !!tag.trim(),
					)
				: undefined,
		});
	}
	return models;
}

// ---------------------------------------------------------------------------
// Sandbox hub client (WebSocket, hub protocol)
// ---------------------------------------------------------------------------

type HubReply = {
	ok?: boolean;
	payload?: JsonRecord;
	error?: { code?: string; message?: string };
};

type HubEventEnvelope = {
	event: string;
	sessionId?: string;
	payload?: JsonRecord;
};

type PendingHubReply = {
	resolve: (reply: HubReply) => void;
	reject: (error: Error) => void;
	timeoutId?: ReturnType<typeof setTimeout>;
};

export type CloudConnectionState =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "disconnected"
	| "error";

// Bun's WebSocket accepts an options bag with custom headers on the upgrade
// request — required because the remote-session proxy authenticates with a
// Bearer Authorization header (browser clients cannot send one, which is why
// this connection lives in the sidecar).
type HeaderCapableWebSocketCtor = new (
	url: string,
	options?: { headers?: Record<string, string> },
) => WebSocket;

class SandboxHubClient {
	private socket: WebSocket | undefined;
	private readonly pending = new Map<string, PendingHubReply>();
	private requestCounter = 0;
	readonly clientId =
		`desktop-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
	closedByClient = false;

	constructor(
		private readonly options: {
			url: string;
			authToken: string;
			onEvent: (event: HubEventEnvelope) => void;
			onClose: () => void;
		},
	) {}

	async connect(): Promise<void> {
		await this.openSocket();
		await this.command("client.register", {
			clientId: this.clientId,
			clientType: "desktop-cloud",
			displayName: "Cline Desktop",
			transport: "browser-ws",
			actorKind: "client",
			protocolVersion: "v1",
		});
		this.sendFrame({
			kind: "stream.subscribe",
			clientId: this.clientId,
		});
	}

	private openSocket(): Promise<void> {
		return new Promise((resolve, reject) => {
			const WebSocketCtor = WebSocket as unknown as HeaderCapableWebSocketCtor;
			const socket = new WebSocketCtor(this.options.url, {
				headers: { authorization: `Bearer ${this.options.authToken}` },
			});
			this.socket = socket;
			let settled = false;
			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(new Error(`Timed out connecting to the cloud session sandbox.`));
				try {
					socket.close();
				} catch {
					// best-effort close
				}
			}, SANDBOX_CONNECT_TIMEOUT_MS);
			socket.addEventListener("open", () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				resolve();
			});
			socket.addEventListener("error", () => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				reject(new Error("Failed to connect to the cloud session sandbox."));
			});
			socket.addEventListener("message", (event) => {
				this.handleFrame(String((event as MessageEvent).data));
			});
			socket.addEventListener("close", () => {
				if (!settled) {
					settled = true;
					clearTimeout(timeout);
					reject(new Error("Cloud session sandbox closed the connection."));
				}
				const closeError = new Error("Cloud session connection closed");
				for (const pending of this.pending.values()) {
					if (pending.timeoutId) clearTimeout(pending.timeoutId);
					pending.reject(closeError);
				}
				this.pending.clear();
				if (this.socket === socket) {
					this.socket = undefined;
					this.options.onClose();
				}
			});
		});
	}

	close(): void {
		this.closedByClient = true;
		try {
			this.socket?.close();
		} catch {
			// best-effort close
		}
		this.socket = undefined;
	}

	isOpen(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	async command(
		command: string,
		payload?: JsonRecord,
		sessionId?: string,
		options?: { timeoutMs?: number | null },
	): Promise<HubReply> {
		const requestId = `hubreq_${Date.now().toString(36)}_${this.requestCounter++}`;
		const timeoutMs =
			options?.timeoutMs === undefined
				? SANDBOX_COMMAND_TIMEOUT_MS
				: options.timeoutMs;
		const reply = new Promise<HubReply>((resolve, reject) => {
			const timeoutId =
				timeoutMs === null
					? undefined
					: setTimeout(() => {
							if (this.pending.delete(requestId)) {
								reject(
									new Error(
										`Cloud session command ${command} timed out after ${timeoutMs}ms`,
									),
								);
							}
						}, timeoutMs);
			this.pending.set(requestId, { resolve, reject, timeoutId });
		});
		this.sendFrame({
			kind: "command",
			envelope: {
				version: "v1",
				command,
				requestId,
				clientId: this.clientId,
				sessionId,
				timeoutMs,
				payload,
			},
		});
		const resolved = await reply;
		if (resolved.ok === false) {
			throw new Error(
				resolved.error?.message ?? `Cloud session command failed: ${command}`,
			);
		}
		return resolved;
	}

	private sendFrame(frame: unknown): void {
		if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
			throw new Error("Cloud session connection is not open");
		}
		this.socket.send(JSON.stringify(frame));
	}

	private handleFrame(raw: string): void {
		let frame: {
			kind?: string;
			envelope?: JsonRecord;
		};
		try {
			frame = JSON.parse(raw) as typeof frame;
		} catch {
			return;
		}
		if (frame.kind === "reply" && frame.envelope) {
			const requestId = asString(frame.envelope.requestId);
			if (!requestId) return;
			const pending = this.pending.get(requestId);
			if (!pending) return;
			this.pending.delete(requestId);
			if (pending.timeoutId) clearTimeout(pending.timeoutId);
			pending.resolve(frame.envelope as HubReply);
			return;
		}
		if (frame.kind === "event" && frame.envelope) {
			const event = asString(frame.envelope.event);
			if (!event) return;
			this.options.onEvent({
				event,
				sessionId: asString(frame.envelope.sessionId),
				payload:
					frame.envelope.payload && typeof frame.envelope.payload === "object"
						? (frame.envelope.payload as JsonRecord)
						: undefined,
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Connection manager
// ---------------------------------------------------------------------------

type CloudConnection = {
	remoteSessionId: string;
	client: SandboxHubClient | null;
	state: CloudConnectionState;
	/** The agent session running inside the sandbox (hub session id). */
	agentSessionId: string | null;
	reconnectAttempt: number;
	reconnectTimer: ReturnType<typeof setTimeout> | null;
	disposed: boolean;
};

const cloudConnections = new Map<string, CloudConnection>();

function broadcastConnectionState(
	ctx: SidecarContext,
	connection: CloudConnection,
	state: CloudConnectionState,
	error?: string,
): void {
	connection.state = state;
	broadcastEvent(ctx, "cloud_session_connection", {
		remoteSessionId: connection.remoteSessionId,
		state,
		error: error ?? null,
	});
}

function broadcastCloudEvent(
	ctx: SidecarContext,
	remoteSessionId: string,
	event: HubEventEnvelope,
): void {
	broadcastEvent(ctx, "cloud_session_event", {
		remoteSessionId,
		event: event.event,
		agentSessionId: event.sessionId ?? null,
		payload: event.payload ?? null,
	});
}

function sandboxWsUrl(remoteSessionId: string): string {
	const url = new URL(
		`${cloudApiBaseUrl()}/api/v1/session/${encodeURIComponent(remoteSessionId)}`,
	);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	return url.toString();
}

async function openSandboxClient(
	ctx: SidecarContext,
	connection: CloudConnection,
): Promise<SandboxHubClient> {
	const token = await resolveCloudAuthToken();
	if (!token) {
		throw new CloudApiError(
			"No Cline account auth token found. Sign in to your Cline account first.",
			401,
			"not_signed_in",
		);
	}
	const client = new SandboxHubClient({
		url: sandboxWsUrl(connection.remoteSessionId),
		authToken: token,
		onEvent: (event) => {
			// The newest agent session inside the sandbox owns the conversation;
			// remember it so later prompts steer the same session.
			if (event.sessionId && !connection.agentSessionId) {
				connection.agentSessionId = event.sessionId;
			}
			broadcastCloudEvent(ctx, connection.remoteSessionId, event);
		},
		onClose: () => {
			if (connection.disposed || connection.client !== client) {
				return;
			}
			if (client.closedByClient) {
				broadcastConnectionState(ctx, connection, "disconnected");
				return;
			}
			scheduleSandboxReconnect(ctx, connection);
		},
	});
	await client.connect();
	return client;
}

function scheduleSandboxReconnect(
	ctx: SidecarContext,
	connection: CloudConnection,
): void {
	if (connection.disposed || connection.reconnectTimer) {
		return;
	}
	broadcastConnectionState(ctx, connection, "reconnecting");
	const delayMs = Math.min(
		SANDBOX_RECONNECT_BASE_DELAY_MS * 2 ** connection.reconnectAttempt,
		SANDBOX_RECONNECT_MAX_DELAY_MS,
	);
	connection.reconnectAttempt += 1;
	connection.reconnectTimer = setTimeout(() => {
		connection.reconnectTimer = null;
		if (connection.disposed) {
			return;
		}
		void (async () => {
			try {
				const client = await openSandboxClient(ctx, connection);
				connection.client = client;
				connection.reconnectAttempt = 0;
				broadcastConnectionState(ctx, connection, "connected");
				// Re-hydrate after the gap: events sent while disconnected were
				// missed, so the webview refetches the transcript snapshot.
				broadcastEvent(ctx, "cloud_session_resync", {
					remoteSessionId: connection.remoteSessionId,
				});
			} catch {
				scheduleSandboxReconnect(ctx, connection);
			}
		})();
	}, delayMs);
}

async function connectCloudSession(
	ctx: SidecarContext,
	remoteSessionId: string,
): Promise<{
	state: CloudConnectionState;
	agentSessionId: string | null;
	agentStatus: string | null;
	messages: unknown[];
	usage: JsonRecord | null;
}> {
	let connection = cloudConnections.get(remoteSessionId);
	if (!connection || connection.disposed) {
		connection = {
			remoteSessionId,
			client: null,
			state: "connecting",
			agentSessionId: null,
			reconnectAttempt: 0,
			reconnectTimer: null,
			disposed: false,
		};
		cloudConnections.set(remoteSessionId, connection);
	}
	if (!connection.client?.isOpen()) {
		broadcastConnectionState(ctx, connection, "connecting");
		try {
			connection.client = await openSandboxClient(ctx, connection);
			connection.reconnectAttempt = 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			broadcastConnectionState(ctx, connection, "error", message);
			throw error;
		}
	}
	const snapshot = await readAgentSnapshot(connection);
	broadcastConnectionState(ctx, connection, "connected");
	return { state: "connected", ...snapshot };
}

async function readAgentSnapshot(connection: CloudConnection): Promise<{
	agentSessionId: string | null;
	agentStatus: string | null;
	messages: unknown[];
	usage: JsonRecord | null;
}> {
	const client = connection.client;
	if (!client) {
		return {
			agentSessionId: null,
			agentStatus: null,
			messages: [],
			usage: null,
		};
	}
	const listReply = await client.command("session.list", { limit: 50 });
	const sessions = Array.isArray(listReply.payload?.sessions)
		? (listReply.payload.sessions as JsonRecord[])
		: [];
	const newest = sessions
		.slice()
		.sort(
			(left, right) =>
				Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0),
		)[0];
	const agentSessionId = asString(newest?.sessionId) ?? null;
	connection.agentSessionId = agentSessionId;
	if (!agentSessionId) {
		return {
			agentSessionId: null,
			agentStatus: null,
			messages: [],
			usage: null,
		};
	}
	const [messagesReply, sessionReply] = await Promise.all([
		client.command("session.messages", { sessionId: agentSessionId }),
		client
			.command("session.get", { sessionId: agentSessionId }, agentSessionId)
			.catch(() => undefined),
	]);
	const rawMessages = Array.isArray(messagesReply.payload?.messages)
		? (messagesReply.payload.messages as unknown[])
		: [];
	// Project into the same flat ChatMessage records local history uses so the
	// webview renders cloud transcripts with the standard chat components.
	const messages = projectAgentMessages(agentSessionId, rawMessages);
	const sessionRecord =
		sessionReply?.payload?.session &&
		typeof sessionReply.payload.session === "object"
			? (sessionReply.payload.session as JsonRecord)
			: undefined;
	const usage =
		sessionRecord?.aggregateUsage &&
		typeof sessionRecord.aggregateUsage === "object"
			? (sessionRecord.aggregateUsage as JsonRecord)
			: sessionRecord?.usage && typeof sessionRecord.usage === "object"
				? (sessionRecord.usage as JsonRecord)
				: null;
	return {
		agentSessionId,
		agentStatus:
			asString(sessionRecord?.status) ?? asString(newest?.status) ?? null,
		messages,
		usage,
	};
}

function requireOpenConnection(remoteSessionId: string): {
	connection: CloudConnection;
	client: SandboxHubClient;
} {
	const connection = cloudConnections.get(remoteSessionId);
	const client = connection?.client;
	if (!connection || !client?.isOpen()) {
		throw new Error(
			"Not connected to this cloud session. Reopen the session and try again.",
		);
	}
	return { connection, client };
}

function disconnectCloudSession(remoteSessionId: string): void {
	const connection = cloudConnections.get(remoteSessionId);
	if (!connection) {
		return;
	}
	connection.disposed = true;
	if (connection.reconnectTimer) {
		clearTimeout(connection.reconnectTimer);
		connection.reconnectTimer = null;
	}
	connection.client?.close();
	connection.client = null;
	cloudConnections.delete(remoteSessionId);
}

export function disposeCloudConnections(): void {
	for (const remoteSessionId of [...cloudConnections.keys()]) {
		disconnectCloudSession(remoteSessionId);
	}
}

// ---------------------------------------------------------------------------
// Command router
// ---------------------------------------------------------------------------

export function isCloudSessionCommand(command: string): boolean {
	return command.startsWith("cloud_");
}

export async function handleCloudSessionCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	const organizationId = asString(args?.organizationId);

	if (command === "cloud_github_status") {
		// One command answers "can this account start cloud sessions?" so the
		// webview needs a single round trip to choose onboarding vs. composer.
		try {
			const repositories = await listGithubRepositories(organizationId);
			return {
				connected: true,
				repositories,
				connectUrl: githubConnectUrl(organizationId),
			};
		} catch (error) {
			if (error instanceof CloudApiError && error.code === "not_signed_in") {
				return {
					connected: false,
					signedOut: true,
					repositories: [],
					connectUrl: githubConnectUrl(organizationId),
				};
			}
			if (isGithubNotConnectedError(error)) {
				return {
					connected: false,
					repositories: [],
					connectUrl: githubConnectUrl(organizationId),
				};
			}
			throw error;
		}
	}
	if (command === "cloud_list_models") {
		return { models: await listCloudModels() };
	}
	if (command === "cloud_list_sessions") {
		return { sessions: await listRemoteSessions(organizationId) };
	}
	if (command === "cloud_create_session") {
		const modelId = asString(args?.modelId);
		const repoUrl = asString(args?.repoUrl);
		const title = asString(args?.title);
		if (!modelId || !repoUrl || !title) {
			throw new Error("modelId, repoUrl, and title are required");
		}
		return await createRemoteSession({
			modelId,
			repoUrl,
			title,
			organizationId,
		});
	}
	if (command === "cloud_rename_session") {
		const sessionId = asString(args?.sessionId);
		const title = asString(args?.title);
		if (!sessionId || !title) {
			throw new Error("sessionId and title are required");
		}
		const data = await cloudApiRequest<JsonRecord>({
			method: "PATCH",
			path: `/api/v1/session/${encodeURIComponent(sessionId)}`,
			body: { sessionID: sessionId, title },
		});
		return { session: data ? mapRemoteSession(data) : null };
	}
	if (command === "cloud_delete_session") {
		const sessionId = asString(args?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		disconnectCloudSession(sessionId);
		await cloudApiRequest<unknown>({
			method: "DELETE",
			path: `/api/v1/session/${encodeURIComponent(sessionId)}`,
		});
		return { deleted: true };
	}
	if (command === "cloud_session_history") {
		const sessionId = asString(args?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		try {
			const token = await resolveCloudAuthToken();
			const response = await fetch(
				`${cloudApiBaseUrl()}/api/v1/session/${encodeURIComponent(sessionId)}/history`,
				{ headers: { authorization: `Bearer ${token ?? ""}` } },
			);
			if (response.status === 404) {
				return { messages: [] };
			}
			if (!response.ok) {
				throw new Error(
					`Failed to load archived session history (HTTP ${response.status})`,
				);
			}
			const parsed = (await response.json()) as {
				version?: number;
				messages?: unknown[];
			};
			return {
				messages: projectAgentMessages(
					sessionId,
					Array.isArray(parsed.messages) ? parsed.messages : [],
				),
			};
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error("Failed to load archived session history");
		}
	}
	if (command === "cloud_connect_session") {
		const sessionId = asString(args?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		return await connectCloudSession(ctx, sessionId);
	}
	if (command === "cloud_disconnect_session") {
		const sessionId = asString(args?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		disconnectCloudSession(sessionId);
		return { disconnected: true };
	}
	if (command === "cloud_send_prompt") {
		const sessionId = asString(args?.sessionId);
		const prompt = asString(args?.prompt);
		const modelId = asString(args?.modelId);
		if (!sessionId || !prompt) {
			throw new Error("sessionId and prompt are required");
		}
		const { connection, client } = requireOpenConnection(sessionId);
		if (!connection.agentSessionId) {
			const reply = await client.command("session.create", {
				workspaceRoot: SANDBOX_WORKSPACE_ROOT,
				cwd: SANDBOX_WORKSPACE_ROOT,
				sessionConfig: {
					providerId: "cline",
					modelId,
					cwd: SANDBOX_WORKSPACE_ROOT,
					workspaceRoot: SANDBOX_WORKSPACE_ROOT,
					systemPrompt: SANDBOX_AGENT_SYSTEM_PROMPT,
					mode: "act",
				},
				metadata: {
					source: "desktop",
					provider: "cline",
					model: modelId,
					interactive: true,
				},
				modelSelection: { provider: "cline", model: modelId },
			});
			const session =
				reply.payload?.session && typeof reply.payload.session === "object"
					? (reply.payload.session as JsonRecord)
					: undefined;
			const agentSessionId = asString(session?.sessionId);
			if (!agentSessionId) {
				throw new Error("The cloud agent session could not be created.");
			}
			connection.agentSessionId = agentSessionId;
		}
		const agentSessionId = connection.agentSessionId;
		// send_input replies when the whole turn finishes; do not block this
		// command on it. Failures surface asynchronously as a run.failed event
		// so the transcript shows what happened.
		void client
			.command("session.send_input", { prompt, mode: "act" }, agentSessionId, {
				timeoutMs: null,
			})
			.catch((error) => {
				broadcastCloudEvent(ctx, sessionId, {
					event: "run.failed",
					sessionId: agentSessionId ?? undefined,
					payload: {
						error: error instanceof Error ? error.message : String(error),
					},
				});
			});
		return { agentSessionId };
	}
	if (command === "cloud_abort_run") {
		const sessionId = asString(args?.sessionId);
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const { connection, client } = requireOpenConnection(sessionId);
		if (!connection.agentSessionId) {
			return { aborted: false };
		}
		await client.command(
			"run.abort",
			{ sessionId: connection.agentSessionId },
			connection.agentSessionId,
		);
		return { aborted: true };
	}
	if (command === "cloud_respond_approval") {
		const sessionId = asString(args?.sessionId);
		const approvalId = asString(args?.approvalId);
		if (!sessionId || !approvalId) {
			throw new Error("sessionId and approvalId are required");
		}
		const { connection, client } = requireOpenConnection(sessionId);
		await client.command(
			"approval.respond",
			{ approvalId, approved: args?.approved === true },
			connection.agentSessionId ?? undefined,
		);
		return { responded: true };
	}

	throw new Error(`unsupported cloud session command: ${command}`);
}

function githubConnectUrl(organizationId?: string): string {
	return organizationId
		? `${cloudDashboardBaseUrl()}/dashboard/organization/integrations`
		: `${cloudDashboardBaseUrl()}/dashboard/integrations`;
}
