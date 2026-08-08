import { randomUUID } from "node:crypto";
import {
	ClineAccountService,
	isHubReconnectableTransportError,
	NodeHubClient,
	ProviderSettingsManager,
} from "@cline/core";
import {
	getClineEnvironmentConfig,
	type HubEventEnvelope,
} from "@cline/shared";
import { resolveFreshClineAuthToken } from "./cline-auth";
import {
	handleHubLiveEvent,
	sendEvent,
	sendPromptsInQueueSnapshot,
} from "./context";
import { resolveSessionListTitle } from "./session-data/common";
import { readSessionMessages } from "./session-data/messages";
import type {
	JsonRecord,
	LiveSession,
	PromptInQueue,
	SidecarContext,
	ToolApprovalRequestItem,
} from "./types";

const CLOUD_WORKSPACE_ROOT = "/workspace";
const CREATE_TIMEOUT_MS = 610_000;
// Bound hot-path REST calls so a dead network cannot hang the sidebar.
const REQUEST_TIMEOUT_MS = 15_000;
const CLOUD_ERROR_PREFIX = "CLOUD_SESSION_ERROR:";
const MAX_BUFFERED_SYNC_EVENTS = 2_000;
const MAX_SEEN_EVENT_IDS = 2_000;
const GITHUB_AUTH_SYSTEM_PROMPT =
	"IMPORTANT: GitHub API authentication is handled automatically by the infrastructure. " +
	"A secrets-proxy sidecar injects the necessary authentication credentials into all GitHub API requests. " +
	"You do NOT need to set up, configure, or manage any authentication tokens, API keys, or credentials for GitHub API calls. " +
	"Simply make your GitHub API calls normally — authentication will be injected transparently.";

type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type CloudSessionRecord = {
	id: string;
	status: string;
	title?: string;
	sandboxUrl: string;
	repoContext: { repoUrl?: string; branch?: string };
	metadata: { modelId?: string };
	expiredAt?: string | null;
	createdAt: string;
	updatedAt: string;
};

export function deriveCloudSessionTitle(prompt: string): string {
	return (prompt.trim().split("\n")[0] ?? "").trim().slice(0, 72);
}

function repositoryLabel(repoUrl: string): string {
	const parts = repoUrl
		.replace(/\.git$/i, "")
		.replace(/\/+$/, "")
		.split(/[/:]/)
		.filter(Boolean);
	return parts.slice(-2).join("/") || "repository";
}

export type CreateCloudSessionInput = {
	modelId: string;
	repoUrl: string;
	branch?: string;
	autoApproveTools?: boolean;
	thinking?: boolean;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	/** Omit for a personal session; otherwise scopes billing to this org. */
	organizationId?: string;
};

export type CloudRepositoryOption = {
	id: number;
	name: string;
	fullName: string;
	url: string;
	defaultBranch: string;
};

export type CloudRepositoryListResult = {
	connected: boolean;
	connectUrl: string;
	repositories: CloudRepositoryOption[];
};

export type CloudBranchListResult = {
	available: boolean;
	branches: string[];
	nextToken?: string;
};

export type CloudBranchListOptions = {
	cursor?: string;
	query?: string;
};

type CloudSessionApiOptions = {
	apiBaseUrl: string;
	appBaseUrl: string;
	getAuthToken: () => Promise<string | undefined>;
	fetch?: FetchLike;
	createTimeoutMs?: number;
};

type CloudErrorCode =
	| "authentication_required"
	| "github_not_connected"
	| "session_not_found"
	| "session_expired"
	| "request_failed";

export class CloudSessionError extends Error {
	constructor(
		readonly code: CloudErrorCode,
		message: string,
		readonly connectUrl?: string,
	) {
		super(
			`${CLOUD_ERROR_PREFIX}${JSON.stringify({ code, message, connectUrl })}`,
		);
		this.name = "CloudSessionError";
	}
}

type ApiResponse<T> = {
	success?: boolean;
	data?: T;
	error?: string;
};

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function readApiError(payload: unknown, fallback: string): string {
	if (payload && typeof payload === "object") {
		const error = (payload as { error?: unknown }).error;
		if (typeof error === "string" && error.trim()) {
			return error.trim();
		}
	}
	return fallback;
}

function cloudErrorForResponse(
	status: number,
	payload: unknown,
	appBaseUrl: string,
	githubConnectUrl?: string,
): CloudSessionError {
	const message = readApiError(
		payload,
		`Cloud session request failed (${status})`,
	);
	if (status === 401) {
		return new CloudSessionError("authentication_required", message);
	}
	if (status === 404) {
		return new CloudSessionError("session_not_found", message);
	}
	if (status === 410) {
		return new CloudSessionError("session_expired", message);
	}
	if (status === 412) {
		return new CloudSessionError(
			"github_not_connected",
			message,
			githubConnectUrl ??
				`${trimTrailingSlash(appBaseUrl)}/dashboard/integrations`,
		);
	}
	return new CloudSessionError("request_failed", message);
}

export class CloudSessionApi {
	private readonly apiBaseUrl: string;
	private readonly appBaseUrl: string;
	private readonly fetchImpl: FetchLike;
	private readonly createTimeoutMs: number;
	// Session ids already owned by a create() call in this process. The
	// create API has no request-specific identifier, so timeout recovery
	// matches by repo/model/branch/time; without claims, two identical
	// overlapping requests could both adopt the same record and orphan the
	// other sandbox.
	private readonly claimedSessionIds = new Set<string>();

	constructor(private readonly options: CloudSessionApiOptions) {
		this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl);
		this.appBaseUrl = trimTrailingSlash(options.appBaseUrl);
		this.fetchImpl = options.fetch ?? fetch;
		this.createTimeoutMs = options.createTimeoutMs ?? CREATE_TIMEOUT_MS;
	}

	private async request<T>(
		path: string,
		init: RequestInit = {},
		githubConnectUrl?: string,
		authToken?: string,
	): Promise<T> {
		const token = authToken ?? (await this.options.getAuthToken());
		if (!token?.trim()) {
			throw new CloudSessionError(
				"authentication_required",
				"Sign in to Cline before starting a cloud session.",
			);
		}
		const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
			...init,
			signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token.trim()}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...init.headers,
			},
		});
		const payload =
			response.status === 204
				? undefined
				: await response.json().catch(() => undefined);
		if (!response.ok) {
			throw cloudErrorForResponse(
				response.status,
				payload,
				this.appBaseUrl,
				githubConnectUrl,
			);
		}
		return (payload as ApiResponse<T> | undefined)?.data as T;
	}

	async list(organizationId?: string): Promise<CloudSessionRecord[]> {
		return await this.listWithToken(organizationId);
	}

	private async listWithToken(
		organizationId?: string,
		authToken?: string,
	): Promise<CloudSessionRecord[]> {
		const query = organizationId?.trim()
			? `?organizationId=${encodeURIComponent(organizationId.trim())}`
			: "";
		return (
			(await this.request<CloudSessionRecord[]>(
				`/api/v1/session${query}`,
				{},
				undefined,
				authToken,
			)) ?? []
		);
	}

	async listRepositories(
		organizationId?: string,
	): Promise<CloudRepositoryListResult> {
		const normalizedOrganizationId = organizationId?.trim();
		const connectUrl = normalizedOrganizationId
			? `${this.appBaseUrl}/dashboard/organization/integrations`
			: `${this.appBaseUrl}/dashboard/integrations`;
		const path = normalizedOrganizationId
			? `/api/v1/organizations/${encodeURIComponent(normalizedOrganizationId)}/integrations/github/repositories`
			: "/api/v1/integrations/github/repositories";
		try {
			const repositories =
				(await this.request<
					Array<{
						id?: unknown;
						name?: unknown;
						full_name?: unknown;
						html_url?: unknown;
						clone_url?: unknown;
						default_branch?: unknown;
					}>
				>(path)) ?? [];
			return {
				connected: true,
				connectUrl,
				repositories: repositories.flatMap((repository) => {
					const id = Number(repository.id);
					const url = String(
						repository.html_url ?? repository.clone_url ?? "",
					).trim();
					if (!Number.isSafeInteger(id) || id <= 0 || !url) return [];
					const name = String(repository.name ?? "").trim();
					return [
						{
							id,
							name,
							fullName: String(repository.full_name ?? (name || url)).trim(),
							url,
							defaultBranch: String(repository.default_branch ?? "").trim(),
						},
					];
				}),
			};
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				error.code === "session_not_found"
			) {
				return { connected: false, connectUrl, repositories: [] };
			}
			throw error;
		}
	}

	async listBranches(
		repositoryId: number,
		organizationId?: string,
		options: CloudBranchListOptions = {},
	): Promise<CloudBranchListResult> {
		if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
			throw new CloudSessionError(
				"request_failed",
				"Select a GitHub repository before loading branches.",
			);
		}
		const normalizedOrganizationId = organizationId?.trim();
		const path = normalizedOrganizationId
			? `/api/v1/organizations/${encodeURIComponent(normalizedOrganizationId)}/integrations/github/repositories/${repositoryId}/branches`
			: `/api/v1/integrations/github/repositories/${repositoryId}/branches`;
		const search = new URLSearchParams();
		const query = options.query?.trim();
		const cursor = options.cursor?.trim();
		if (query) search.set("query", query);
		if (cursor) search.set("cursor", cursor);
		const requestPath = search.size > 0 ? `${path}?${search}` : path;
		try {
			const payload = await this.request<
				| Array<{ name?: unknown }>
				| {
						items?: Array<{ name?: unknown }>;
						nextToken?: unknown;
				  }
			>(requestPath);
			const branches = Array.isArray(payload)
				? payload
				: Array.isArray(payload?.items)
					? payload.items
					: [];
			const normalizedQuery = query?.toLowerCase();
			return {
				available: true,
				branches: branches.flatMap((branch) => {
					const name = String(branch.name ?? "").trim();
					return name &&
						(!Array.isArray(payload) ||
							!normalizedQuery ||
							name.toLowerCase().includes(normalizedQuery))
						? [name]
						: [];
				}),
				nextToken: Array.isArray(payload)
					? ""
					: String(payload?.nextToken ?? "").trim(),
			};
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				error.code === "session_not_found"
			) {
				return { available: false, branches: [] };
			}
			throw error;
		}
	}

	async create(input: CreateCloudSessionInput): Promise<{
		sessionId: string;
		sandboxUrl: string;
		cleanupAuthToken: string;
	}> {
		const creationAuthToken = (await this.options.getAuthToken())?.trim();
		if (!creationAuthToken) {
			throw new CloudSessionError(
				"authentication_required",
				"Sign in to Cline before starting a cloud session.",
			);
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.createTimeoutMs);
		const requestedAt = Date.now();
		try {
			const created = await this.request<{
				sessionId: string;
				sandboxUrl: string;
			}>(
				"/api/v1/session",
				{
					method: "POST",
					body: JSON.stringify({
						modelId: input.modelId,
						repoUrl: input.repoUrl,
						...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
						...(input.organizationId?.trim()
							? { organizationId: input.organizationId.trim() }
							: {}),
					}),
					signal: controller.signal,
				},
				input.organizationId?.trim()
					? `${this.appBaseUrl}/dashboard/organization/integrations`
					: undefined,
				creationAuthToken,
			);
			if (created?.sessionId?.trim()) {
				this.claimedSessionIds.add(created.sessionId.trim());
			}
			return { ...created, cleanupAuthToken: creationAuthToken };
		} catch (error) {
			// Provisioning may outlive the synchronous request; recover its record.
			const mayStillBeProvisioning =
				controller.signal.aborted ||
				(error instanceof CloudSessionError && error.code === "request_failed");
			if (mayStillBeProvisioning) {
				const requestedBranch = input.branch?.trim();
				const recovered = (
					await this.listWithToken(
						input.organizationId,
						creationAuthToken,
					).catch(() => [])
				)
					.filter(
						(session) =>
							// Skip records another concurrent create already owns.
							!this.claimedSessionIds.has(session.id) &&
							session.repoContext.repoUrl === input.repoUrl &&
							session.metadata.modelId === input.modelId &&
							// The backend may resolve an omitted branch to the repo default,
							// so only require a match when we asked for a specific one.
							(!requestedBranch ||
								session.repoContext.branch === requestedBranch) &&
							Date.parse(session.createdAt) >= requestedAt - 5_000,
					)
					.sort(
						(left, right) =>
							Date.parse(right.createdAt) - Date.parse(left.createdAt),
					)[0];
				if (recovered) {
					this.claimedSessionIds.add(recovered.id);
					return {
						sessionId: recovered.id,
						sandboxUrl: recovered.sandboxUrl,
						cleanupAuthToken: creationAuthToken,
					};
				}
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	async delete(sessionId: string, authToken?: string): Promise<void> {
		await this.request(
			`/api/v1/session/${encodeURIComponent(sessionId)}`,
			{ method: "DELETE" },
			undefined,
			authToken,
		);
	}

	async updateTitle(
		sessionId: string,
		title: string,
	): Promise<CloudSessionRecord> {
		return await this.request<CloudSessionRecord>(
			`/api/v1/session/${encodeURIComponent(sessionId)}`,
			{
				method: "PATCH",
				body: JSON.stringify({ title }),
			},
		);
	}

	/** Raw archived snapshot; null distinguishes a missing archive from []. */
	async history(sessionId: string): Promise<unknown[] | null> {
		const token = await this.options.getAuthToken();
		if (!token?.trim()) {
			throw new CloudSessionError(
				"authentication_required",
				"Sign in to Cline to load this session's history.",
			);
		}
		const response = await this.fetchImpl(
			`${this.apiBaseUrl}/api/v1/session/${encodeURIComponent(sessionId)}/history`,
			{
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${token.trim()}`,
				},
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
		if (response.status === 404) {
			return null;
		}
		const payload = await response.json().catch(() => undefined);
		if (!response.ok) {
			throw cloudErrorForResponse(response.status, payload, this.appBaseUrl);
		}
		const messages = (payload as { messages?: unknown } | undefined)?.messages;
		return Array.isArray(messages) ? messages : [];
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
	prompts?: PromptInQueue[];
};

type CloudConnection = {
	remote: CloudSessionRecord;
	client: CloudHubClient;
	innerSessionId?: string;
	rehydrationPromise?: Promise<CloudRehydrationSnapshot>;
	rehydrationRerunRequested?: boolean;
	bufferingEvents?: boolean;
	bufferedEvents: HubEventEnvelope[];
	rehydrationGeneration: number;
	transcriptKnown: boolean;
	seenEventIds: Set<string>;
	seenEventIdOrder: string[];
	/** Prevents concurrent sends from creating competing inner sessions. */
	innerSessionCreation?: Promise<void>;
	unsubscribe: () => void;
};

type CloudSessionManagerOptions = {
	api: Pick<
		CloudSessionApi,
		| "create"
		| "delete"
		| "list"
		| "history"
		| "updateTitle"
		| "listRepositories"
		| "listBranches"
	>;
	getAuthToken: () => Promise<string | undefined>;
	apiBaseUrl: string;
	/** Resolves the active billing org; undefined means a personal session. */
	getActiveOrganizationId?: () => Promise<string | undefined>;
	createHubClient?: (
		options: ConstructorParameters<typeof NodeHubClient>[0],
	) => CloudHubClient;
};

/** Recognizes server ids even before the in-memory cloud registry is warm. */
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

function recordToLiveSession(record: CloudSessionRecord): LiveSession {
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
		endedAt: isExpiredRecord(record)
			? (record.expiredAt ?? undefined)
			: undefined,
		updatedAt: record.updatedAt,
		...(record.title?.trim() ? { title: record.title.trim() } : {}),
		metadata: {
			...(record.title?.trim() ? { title: record.title.trim() } : {}),
			origin: "cloud",
			repoUrl: record.repoContext.repoUrl ?? "",
			git: {
				url: record.repoContext.repoUrl ?? "",
				branch: record.repoContext.branch ?? "",
			},
		},
	};
}

function readSessionRows(
	payload: Record<string, unknown> | undefined,
): JsonRecord[] {
	return Array.isArray(payload?.sessions)
		? payload.sessions.filter(
				(item): item is JsonRecord =>
					Boolean(item) && typeof item === "object" && !Array.isArray(item),
			)
		: [];
}

function updatedAt(record: JsonRecord): number {
	const value = record.updatedAt;
	return typeof value === "number"
		? value
		: Date.parse(String(value ?? "")) || 0;
}

function sessionRowModelId(record: JsonRecord | undefined): string {
	const metadata =
		record?.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	return String(metadata?.model ?? record?.model ?? "").trim();
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

function messageText(message: unknown): string {
	if (!message || typeof message !== "object" || Array.isArray(message)) {
		return "";
	}
	const content = (message as JsonRecord).content;
	if (typeof content === "string") {
		return content.trim();
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((part) =>
			part && typeof part === "object" && !Array.isArray(part)
				? String((part as JsonRecord).text ?? "")
				: "",
		)
		.join("")
		.trim();
}

/** Normalizes pod-wrapped prompts and raw local/queue prompts. */
function normalizeUserPrompt(text: string): string {
	const trimmed = text.trim();
	const match = trimmed.match(/^<user_input\b[^>]*>([\s\S]*)<\/user_input>$/);
	return (match ? match[1] : trimmed).trim();
}

function countPromptOccurrences(
	messages: unknown[],
	prompts: PromptInQueue[],
	prompt: string,
): number {
	const expected = normalizeUserPrompt(prompt);
	return (
		messages.filter(
			(message) =>
				Boolean(message) &&
				typeof message === "object" &&
				!Array.isArray(message) &&
				String((message as JsonRecord).role ?? "").toLowerCase() === "user" &&
				normalizeUserPrompt(messageText(message)) === expected,
		).length +
		prompts.filter((item) => normalizeUserPrompt(item.prompt) === expected)
			.length
	);
}

const TERMINAL_RUN_EVENTS = new Set([
	"run.completed",
	"run.aborted",
	"run.failed",
]);
const SUPERSEDABLE_CONTENT_EVENTS = new Set([
	"assistant.delta",
	"assistant.finished",
	"reasoning.delta",
	"reasoning.finished",
]);

function assistantTexts(messages: unknown[]): string[] {
	return messages
		.filter(
			(message): message is JsonRecord =>
				Boolean(message) &&
				typeof message === "object" &&
				!Array.isArray(message) &&
				String((message as JsonRecord).role ?? "").toLowerCase() ===
					"assistant",
		)
		.map(messageText)
		.filter(Boolean);
}

function collectToolCallIds(
	value: unknown,
	result = new Set<string>(),
): Set<string> {
	if (!value || typeof value !== "object") return result;
	if (Array.isArray(value)) {
		for (const item of value) collectToolCallIds(item, result);
		return result;
	}
	const record = value as JsonRecord;
	if (record.type === "tool_use" && typeof record.id === "string") {
		result.add(record.id);
	}
	for (const key of ["toolCallId", "tool_call_id", "toolUseId"]) {
		if (typeof record[key] === "string" && record[key]) {
			result.add(record[key] as string);
		}
	}
	for (const child of Object.values(record)) collectToolCallIds(child, result);
	return result;
}

function streamedAssistantText(events: HubEventEnvelope[]): string {
	// Match messageText() trimming before substring supersession.
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (
			event.event === "assistant.finished" &&
			typeof event.payload?.text === "string" &&
			event.payload.text
		) {
			return event.payload.text.trim();
		}
	}
	return events
		.filter((event) => event.event === "assistant.delta")
		.map((event) =>
			typeof event.payload?.text === "string" ? event.payload.text : "",
		)
		.join("")
		.trim();
}

/** Reconciles each completed run separately; tools dedupe by stable call id. */
export function reconcileBufferedCloudEvents(
	events: HubEventEnvelope[],
	snapshotMessages: unknown[],
	options: {
		/**
		 * Whether a fresh queue snapshot was fetched and applied during
		 * rehydration. When it was, buffered queue events are stale and
		 * dropped; when the fetch failed, the newest buffered queue event is
		 * the best queue state available and must be replayed instead of
		 * silently losing queued/steered prompts.
		 */
		queueSnapshotApplied?: boolean;
	} = {},
): HubEventEnvelope[] {
	const queueSnapshotApplied = options.queueSnapshotApplied !== false;
	const snapshotAssistantTexts = assistantTexts(snapshotMessages);
	const snapshotToolCallIds = collectToolCallIds(snapshotMessages);
	// Queue events are full snapshots, so only the newest one matters.
	const lastQueueEvent = queueSnapshotApplied
		? undefined
		: events.findLast((event) => event.event === "session.pending_prompts");
	const reconciled: HubEventEnvelope[] = [];
	let segment: HubEventEnvelope[] = [];

	const flush = (terminal: boolean) => {
		if (segment.length === 0) return;
		const streamed = terminal ? streamedAssistantText(segment) : "";
		const contentPersisted =
			Boolean(streamed) &&
			snapshotAssistantTexts.some((text) => text.includes(streamed));
		for (const event of segment) {
			if (contentPersisted && SUPERSEDABLE_CONTENT_EVENTS.has(event.event)) {
				continue;
			}
			// The separately fetched queue snapshot is newer than buffered
			// copies; without one, replay the newest buffered snapshot.
			if (
				event.event === "session.pending_prompts" &&
				event !== lastQueueEvent
			) {
				continue;
			}
			// Keep terminal events: run.failed may carry the only error detail.
			if (event.event.startsWith("tool.")) {
				const toolCallId = String(event.payload?.toolCallId ?? "").trim();
				if (toolCallId && snapshotToolCallIds.has(toolCallId)) continue;
			}
			reconciled.push(event);
		}
		segment = [];
	};

	for (const event of events) {
		segment.push(event);
		if (TERMINAL_RUN_EVENTS.has(event.event)) flush(true);
	}
	// Never supersede an unterminated tail.
	flush(false);
	return reconciled;
}

export class CloudSessionManager {
	private disposed = false;
	private readonly connections = new Map<string, CloudConnection>();
	private readonly connectionPromises = new Map<
		string,
		Promise<CloudConnection>
	>();
	private readonly knownSessions = new Map<string, CloudSessionRecord>();
	private lastListedSessions: CloudSessionRecord[] = [];
	private discoveryRefresh?: Promise<CloudSessionRecord[]>;
	// REST cannot list sessions that are still provisioning.
	private readonly pendingCreates = new Map<string, JsonRecord>();
	private readonly createHubClient: NonNullable<
		CloudSessionManagerOptions["createHubClient"]
	>;

	constructor(
		private readonly ctx: SidecarContext,
		private readonly options: CloudSessionManagerOptions,
	) {
		this.createHubClient =
			options.createHubClient ??
			((clientOptions) => new NodeHubClient(clientOptions));
	}

	isCloudSession(sessionId: string): boolean {
		return (
			isCloudOuterSessionId(sessionId) ||
			this.knownSessions.has(sessionId) ||
			this.pendingCreates.has(sessionId) ||
			this.connections.has(sessionId) ||
			this.ctx.liveSessions.get(sessionId)?.config.executionTarget === "cloud"
		);
	}

	async list(): Promise<CloudSessionRecord[]> {
		const organizationId = await this.resolveActiveOrganizationId();
		const scoped = await this.options.api.list(organizationId);
		// Retain other scopes for routing; only lastListedSessions drives the sidebar.
		for (const session of scoped) {
			this.knownSessions.set(session.id, session);
		}
		this.lastListedSessions = scoped;
		return scoped;
	}

	private async resolveActiveOrganizationId(): Promise<string | undefined> {
		return await this.options.getActiveOrganizationId?.();
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
					() => ({ value: this.lastListedSessions }),
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

		const placeholders = Array.from(this.pendingCreates.values());
		const listed = records.map((record) => {
			const projected = cloudSessionToDiscoveryRecord(record);
			const live = this.ctx.liveSessions.get(record.id);
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
		return [...placeholders, ...listed];
	}

	async create(input: CreateCloudSessionInput): Promise<JsonRecord> {
		if (this.disposed) {
			throw new Error("Cloud session manager was disposed");
		}
		// Keep the session visible while the blocking create request provisions it.
		const placeholderId = `cloud-provisioning-${randomUUID()}`;
		const startedAt = new Date().toISOString();
		this.pendingCreates.set(placeholderId, {
			sessionId: placeholderId,
			origin: "cloud",
			executionTarget: "cloud",
			status: "provisioning",
			provider: "cline",
			model: input.modelId,
			repoUrl: input.repoUrl,
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			startedAt,
			updatedAt: startedAt,
			metadata: {
				origin: "cloud",
				repoUrl: input.repoUrl,
				git: { url: input.repoUrl, branch: input.branch ?? "" },
				title: `Provisioning ${repositoryLabel(input.repoUrl)}…`,
			},
		});
		// Show the placeholder before the next sidebar poll.
		sendEvent(this.ctx, "chat_session_status", {
			sessionId: placeholderId,
			status: "provisioning",
		});
		try {
			const created = await this.createProvisionedSession(input);
			// Swap an open placeholder thread to the real session.
			sendEvent(this.ctx, "cloud_session_provisioned", {
				placeholderId,
				sessionId: String(created.sessionId ?? ""),
			});
			return created;
		} finally {
			this.pendingCreates.delete(placeholderId);
			sendEvent(this.ctx, "chat_session_status", {
				sessionId: placeholderId,
				status: "ended",
			});
		}
	}

	private async createProvisionedSession(
		input: CreateCloudSessionInput,
	): Promise<JsonRecord> {
		const organizationId =
			input.organizationId ?? (await this.resolveActiveOrganizationId());
		const created = await this.options.api.create({
			...input,
			organizationId,
		});
		if (!created?.sessionId?.trim() || !created.sandboxUrl?.trim()) {
			throw new CloudSessionError(
				"request_failed",
				"The cloud session service returned an unexpected response; please try again.",
			);
		}
		if (this.disposed) {
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
			status: "ready",
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
		const live = recordToLiveSession(record);
		// REST does not round-trip the client-side approval preference.
		if (typeof input.autoApproveTools === "boolean") {
			live.config.autoApproveTools = input.autoApproveTools;
		}
		if (typeof input.thinking === "boolean") {
			live.config.thinking = input.thinking;
		}
		if (input.reasoningEffort) {
			live.config.reasoningEffort = input.reasoningEffort;
		}
		this.ctx.liveSessions.set(record.id, live);
		// Provisioning succeeded; a transient Hub connect must not report create failure.
		try {
			await this.ensureConnection(record.id, { createInner: true });
		} catch (error) {
			this.ctx.logger?.log(
				"Cloud session provisioned but initial connect failed; will connect on demand",
				{ sessionId: record.id, error },
			);
		}
		if (this.disposed) {
			await this.deleteProvisionedSessionAfterDispose(
				record.id,
				created.cleanupAuthToken,
			);
			throw new Error(
				"Cline account changed while the cloud session was starting",
			);
		}
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
		};
	}

	private async deleteProvisionedSessionAfterDispose(
		outerSessionId: string,
		authToken?: string,
	): Promise<void> {
		this.knownSessions.delete(outerSessionId);
		this.ctx.liveSessions.delete(outerSessionId);
		await this.options.api.delete(outerSessionId, authToken).catch((error) => {
			this.ctx.logger?.log(
				"Failed to clean up a cloud session created during an account change",
				{ sessionId: outerSessionId, error },
			);
		});
	}

	async attach(outerSessionId: string): Promise<JsonRecord> {
		// Opening a placeholder keeps the loading pane stable during provisioning.
		const placeholder = this.pendingCreates.get(outerSessionId);
		if (placeholder) {
			return { ...placeholder };
		}
		const known = await this.ensureKnownSession(outerSessionId);
		if (isExpiredRecord(known)) {
			return await this.attachExpired(known);
		}
		let connection: CloudConnection;
		try {
			connection = await this.ensureConnection(outerSessionId);
		} catch (error) {
			// Re-check expiry after a proxy upgrade failure.
			const refreshed = await this.refreshKnownSession(outerSessionId);
			if (refreshed && isExpiredRecord(refreshed)) {
				return await this.attachExpired(refreshed);
			}
			throw error;
		}
		await this.ensureAttached(connection);
		await this.refreshPendingApprovals(outerSessionId, connection);
		const record = connection.remote;
		const live = this.ctx.liveSessions.get(outerSessionId);
		return {
			sessionId: outerSessionId,
			origin: "cloud",
			executionTarget: "cloud",
			status: live?.status ?? record.status,
			provider: "cline",
			model: record.metadata.modelId ?? "",
			repoUrl: record.repoContext.repoUrl ?? "",
			branch: record.repoContext.branch ?? "",
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
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

	async send(
		outerSessionId: string,
		prompt: string,
		delivery?: "queue" | "steer",
		modelId?: string,
	): Promise<{
		sessionId: string;
		ok: true;
		queued?: boolean;
		recoveredAfterDisconnect?: boolean;
		status?: string;
		result?: unknown;
	}> {
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
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub session was not initialized");
		}
		await this.ensureAttached(connection);
		await this.updateModel(connection, modelId);
		if (!connection.transcriptKnown) {
			await this.rehydrateAfterTransportDrop(outerSessionId, connection);
		}
		const live = this.ctx.liveSessions.get(outerSessionId);
		const promptOccurrencesBeforeSend = countPromptOccurrences(
			live?.messages ?? [],
			live?.promptsInQueue ?? [],
			prompt,
		);
		const ownsBusyState = delivery !== "queue" && delivery !== "steer";
		if (live && ownsBusyState) {
			live.busy = true;
			live.status = "running";
			live.prompt ||= prompt;
		}
		// Name from the first prompt without delaying the send.
		const record = this.knownSessions.get(outerSessionId);
		if (record && !record.title?.trim()) {
			const title = deriveCloudSessionTitle(prompt);
			if (title) {
				record.title = title;
				if (live) {
					live.title = title;
				}
				void this.options.api.updateTitle?.(outerSessionId, title).catch(() => {
					// Sidebar still shows the local title; REST retries on rename.
				});
			}
		}
		try {
			const reply = await connection.client.command(
				"session.send_input",
				{ prompt, delivery },
				innerSessionId,
				{ timeoutMs: null },
			);
			// Advance the baseline so an older identical prompt cannot confirm this send.
			if (live && delivery !== "queue") {
				live.messages = [
					...live.messages,
					{ role: "user", content: [{ type: "text", text: prompt }] },
				];
			}
			return {
				sessionId: outerSessionId,
				ok: true,
				...(delivery === "queue" ? { queued: true } : {}),
				result: reply.payload?.result,
			};
		} catch (error) {
			if (isHubReconnectableTransportError(error)) {
				let snapshot: CloudRehydrationSnapshot;
				try {
					snapshot = await this.rehydrateAfterTransportDrop(
						outerSessionId,
						connection,
					);
				} catch (recoveryError) {
					if (live && ownsBusyState) {
						live.busy = false;
						live.status = "error";
					}
					throw recoveryError;
				}
				const promptOccurrencesAfterRecovery = countPromptOccurrences(
					snapshot.messages,
					snapshot.prompts ?? [],
					prompt,
				);
				if (promptOccurrencesAfterRecovery <= promptOccurrencesBeforeSend) {
					throw new CloudSessionError(
						"request_failed",
						"The connection was interrupted before this message could be confirmed. It was not found in the cloud session, so please send it again.",
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
			if (live && ownsBusyState) {
				live.busy = false;
				live.status = "error";
			}
			throw error;
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
		);
		this.applyModel(connection, modelId);
	}

	private applyModel(connection: CloudConnection, modelId: string): void {
		connection.remote.metadata.modelId = modelId;
		const live = this.ctx.liveSessions.get(connection.remote.id);
		if (live) {
			live.config.model = modelId;
			live.config.modelId = modelId;
		}
	}

	private async rehydrateAfterTransportDrop(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<CloudRehydrationSnapshot> {
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
			} while (connection.rehydrationRerunRequested && !this.disposed);
			return snapshot;
		})().finally(() => {
			if (connection.rehydrationPromise === rehydration) {
				connection.rehydrationPromise = undefined;
			}
		});
		connection.rehydrationPromise = rehydration;
		return await rehydration;
	}

	private async performTransportRehydration(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<CloudRehydrationSnapshot> {
		if (this.disposed) {
			throw new Error("Cloud session manager was disposed");
		}
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub session was not initialized");
		}
		connection.bufferingEvents = true;
		connection.bufferedEvents = [];
		connection.rehydrationGeneration += 1;
		try {
			// command() waits for registration, including reconnect attempts.
			await this.ensureAttached(connection);
			const sessionReply = await connection.client.command(
				"session.get",
				{ includeSnapshot: true },
				innerSessionId,
			);
			const session =
				sessionReply.payload?.session &&
				typeof sessionReply.payload.session === "object" &&
				!Array.isArray(sessionReply.payload.session)
					? (sessionReply.payload.session as JsonRecord)
					: undefined;
			const live = this.ctx.liveSessions.get(outerSessionId);
			const runtimeStatus = String(
				session?.status ?? live?.status ?? "running",
			).trim();
			const status = runtimeStatus === "pending" ? "running" : runtimeStatus;

			const messagesReply = await connection.client.command(
				"session.messages",
				{ sessionId: innerSessionId },
				innerSessionId,
			);
			if (!Array.isArray(messagesReply.payload?.messages)) {
				throw new Error("Cloud Hub returned an invalid transcript snapshot");
			}
			const messages = messagesReply.payload.messages;
			const queueReply = await connection.client
				.command(
					"session.pending_prompts",
					{ sessionId: innerSessionId },
					innerSessionId,
				)
				.catch(() => undefined);

			if (live) {
				const statusChanged = live.status !== status;
				live.messages = messages;
				live.status = status;
				live.busy = status === "running" || status === "pending";
				if (statusChanged) {
					if (
						status === "completed" ||
						status === "failed" ||
						status === "aborted"
					) {
						live.endedAt ??= Date.now();
						sendEvent(this.ctx, "chat_session_ended", {
							sessionId: outerSessionId,
							reason: status,
						});
					} else {
						sendEvent(this.ctx, "chat_session_status", {
							sessionId: outerSessionId,
							status,
						});
					}
				}
			}
			// A reply is only an authoritative queue snapshot when it succeeded
			// and actually carries a prompts array; treating an unsuccessful or
			// malformed reply as authoritative would publish an empty queue and
			// drop the buffered queue events that still hold the real state.
			const queueSnapshotValid =
				queueReply !== undefined &&
				queueReply.ok !== false &&
				Array.isArray(queueReply.payload?.prompts);
			const prompts = queueSnapshotValid
				? this.applyQueueSnapshot(outerSessionId, queueReply)
				: undefined;
			await this.refreshPendingApprovals(outerSessionId, connection);
			connection.transcriptKnown = true;

			// Publish the snapshot before releasing the reconciled tail.
			sendEvent(this.ctx, "cloud_session_rehydrated", {
				sessionId: outerSessionId,
				status,
				generation: connection.rehydrationGeneration,
				transcriptKnown: true,
				messages: await readSessionMessages(
					this.ctx,
					outerSessionId,
					800,
					messages,
				),
			});
			const buffered = reconcileBufferedCloudEvents(
				connection.bufferedEvents,
				messages,
				{ queueSnapshotApplied: queueSnapshotValid },
			);
			connection.bufferedEvents = [];
			connection.bufferingEvents = false;
			for (const event of buffered) {
				this.forwardEvent(outerSessionId, connection, event);
			}
			return { status, messages, prompts };
		} catch (error) {
			// Preserve the current view and release the full tail on snapshot failure.
			const buffered = connection.bufferedEvents;
			connection.bufferedEvents = [];
			connection.bufferingEvents = false;
			for (const event of buffered) {
				this.forwardEvent(outerSessionId, connection, event);
			}
			sendEvent(this.ctx, "cloud_session_sync_failed", {
				sessionId: outerSessionId,
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	async abort(
		outerSessionId: string,
	): Promise<{ sessionId: string; ok: true }> {
		const connection = await this.ensureConnection(outerSessionId);
		if (connection.innerSessionId) {
			await this.ensureAttached(connection);
			await connection.client.command(
				"run.abort",
				{ sessionId: connection.innerSessionId },
				connection.innerSessionId,
			);
		}
		const live = this.ctx.liveSessions.get(outerSessionId);
		if (live) {
			live.busy = false;
			live.status = "aborted";
		}
		return { sessionId: outerSessionId, ok: true };
	}

	async pendingPrompts(outerSessionId: string): Promise<JsonRecord> {
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
		await this.ensureAttached(connection);
		return await connection.client.command(
			command,
			{ sessionId: innerSessionId, ...payload },
			innerSessionId,
		);
	}

	/** Mirrors the authoritative queue reply into desktop state. */
	private applyQueueSnapshot(
		outerSessionId: string,
		reply: { payload?: Record<string, unknown> },
	): PromptInQueue[] {
		const items = Array.isArray(reply.payload?.prompts)
			? (reply.payload.prompts as Array<Record<string, unknown>>)
			: [];
		const mapped: PromptInQueue[] = items
			.map((item) => ({
				id: typeof item.id === "string" ? item.id : "",
				prompt: typeof item.prompt === "string" ? item.prompt : "",
				steer: item.delivery === "steer",
				attachmentCount:
					typeof item.attachmentCount === "number" ? item.attachmentCount : 0,
			}))
			.filter((item) => item.id);
		const live = this.ctx.liveSessions.get(outerSessionId);
		if (live) {
			live.promptsInQueue = mapped;
		}
		sendPromptsInQueueSnapshot(this.ctx, outerSessionId);
		return mapped;
	}

	async readMessages(outerSessionId: string): Promise<unknown[]> {
		if (this.pendingCreates.has(outerSessionId)) {
			return [];
		}
		const known = this.knownSessions.get(outerSessionId);
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
		await this.options.api.updateTitle(outerSessionId, title);
		const record = this.knownSessions.get(outerSessionId);
		if (record) {
			record.title = title;
		}
		const live = this.ctx.liveSessions.get(outerSessionId);
		if (live) {
			live.title = title;
		}
	}

	async delete(outerSessionId: string): Promise<void> {
		if (this.pendingCreates.has(outerSessionId)) {
			throw new CloudSessionError(
				"request_failed",
				"This cloud session is still provisioning and cannot be deleted yet.",
			);
		}
		// Settle an in-flight connect before deleting its connection.
		const pendingConnect = this.connectionPromises.get(outerSessionId);
		if (pendingConnect) {
			await pendingConnect.catch(() => undefined);
		}
		await this.disposeConnection(outerSessionId);
		await this.options.api.delete(outerSessionId);
		this.knownSessions.delete(outerSessionId);
		this.ctx.liveSessions.delete(outerSessionId);
		for (const [requestId, pending] of this.ctx.pendingApprovals) {
			if (pending.item.sessionId === outerSessionId) {
				this.ctx.pendingApprovals.delete(requestId);
			}
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const sessionIds = new Set([
			...this.connections.keys(),
			...this.knownSessions.keys(),
		]);
		await Promise.allSettled(
			Array.from(this.connections.keys()).map((sessionId) =>
				this.disposeConnection(sessionId),
			),
		);
		for (const [requestId, pending] of this.ctx.pendingApprovals) {
			if (sessionIds.has(pending.item.sessionId)) {
				this.ctx.pendingApprovals.delete(requestId);
			}
		}
		for (const sessionId of sessionIds) {
			this.ctx.liveSessions.delete(sessionId);
			this.sendApprovalSnapshot(sessionId);
		}
		this.knownSessions.clear();
		this.pendingCreates.clear();
	}

	private async attachExpired(record: CloudSessionRecord): Promise<JsonRecord> {
		const live =
			this.ctx.liveSessions.get(record.id) ?? recordToLiveSession(record);
		live.busy = false;
		live.status = "expired";
		this.ctx.liveSessions.set(record.id, live);
		await this.loadArchivedMessages(record).catch(() => undefined);
		return {
			sessionId: record.id,
			origin: "cloud",
			executionTarget: "cloud",
			status: "expired",
			provider: "cline",
			model: record.metadata.modelId ?? "",
			repoUrl: record.repoContext.repoUrl ?? "",
			branch: record.repoContext.branch ?? "",
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
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

	private async loadArchivedMessages(
		record: CloudSessionRecord,
	): Promise<unknown[] | null> {
		const messages = await this.options.api.history(record.id);
		if (messages === null) {
			return null;
		}
		const live =
			this.ctx.liveSessions.get(record.id) ?? recordToLiveSession(record);
		live.messages = messages;
		this.ctx.liveSessions.set(record.id, live);
		return messages;
	}

	private async refreshKnownSession(
		outerSessionId: string,
	): Promise<CloudSessionRecord | undefined> {
		const organizationId = await this.resolveActiveOrganizationId();
		const sessions = await this.options.api
			.list(organizationId)
			.catch(() => undefined);
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
		if (this.pendingCreates.has(outerSessionId)) {
			throw new CloudSessionError(
				"request_failed",
				"This cloud session is still provisioning — it will be ready shortly.",
			);
		}
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
		return record;
	}

	private async ensureConnection(
		outerSessionId: string,
		options: { createInner?: boolean } = {},
	): Promise<CloudConnection> {
		if (this.disposed) {
			throw new Error("Cloud session manager was disposed");
		}
		const existing = this.connections.get(outerSessionId);
		if (existing) {
			if (options.createInner && !existing.innerSessionId) {
				await this.createInnerSession(existing);
			}
			return existing;
		}
		const pending = this.connectionPromises.get(outerSessionId);
		if (pending) {
			const connection = await pending;
			if (options.createInner && !connection.innerSessionId) {
				await this.createInnerSession(connection);
			}
			return connection;
		}

		const connecting = (async () => {
			const remote = await this.ensureKnownSession(outerSessionId);
			// Surface expiry before the proxy turns it into an upgrade failure.
			if (isExpiredRecord(remote)) {
				throw new CloudSessionError(
					"session_expired",
					"This cloud session has expired; its sandbox is gone. Start a new cloud session to continue.",
				);
			}
			this.ctx.liveSessions.set(
				outerSessionId,
				this.ctx.liveSessions.get(outerSessionId) ??
					recordToLiveSession(remote),
			);
			let connection: CloudConnection | undefined;
			let socketAttempt = 0;
			const client = this.createHubClient({
				url: toWebSocketUrl(this.options.apiBaseUrl, outerSessionId),
				clientId: `code-cloud-${outerSessionId}`,
				clientType: "code-cloud-sidecar",
				displayName: "Cline Code cloud session",
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				resolveConnectionHeaders: async () => {
					const reconnecting = socketAttempt > 0;
					socketAttempt += 1;
					if (reconnecting) {
						setTimeout(() => {
							if (!connection) return;
							void this.rehydrateAfterTransportDrop(
								outerSessionId,
								connection,
							).catch(() => undefined);
						}, 0);
					}
					const token = await this.options.getAuthToken();
					if (!token?.trim()) {
						throw new CloudSessionError(
							"authentication_required",
							"Sign in to Cline to reconnect this cloud session.",
						);
					}
					return { Authorization: `Bearer ${token.trim()}` };
				},
			});
			connection = {
				remote,
				client,
				bufferedEvents: [],
				rehydrationGeneration: 0,
				transcriptKnown: false,
				seenEventIds: new Set(),
				seenEventIdOrder: [],
				unsubscribe: () => {},
			};
			connection.unsubscribe = client.subscribe((event) => {
				this.handleEvent(outerSessionId, connection, event);
			});
			try {
				await client.connect();
				if (this.disposed) {
					throw new Error("Cloud session manager was disposed");
				}
				const listed = await client.command("session.list", { limit: 100 });
				const newest = readSessionRows(listed.payload).sort(
					(left, right) => updatedAt(right) - updatedAt(left),
				)[0];
				const innerSessionId = String(newest?.sessionId ?? "").trim();
				if (innerSessionId) {
					connection.innerSessionId = innerSessionId;
					const modelId = sessionRowModelId(newest);
					if (modelId) this.applyModel(connection, modelId);
					await this.ensureAttached(connection);
				}
				if (this.disposed) {
					throw new Error("Cloud session manager was disposed");
				}
				this.connections.set(outerSessionId, connection);
				if (options.createInner && !connection.innerSessionId) {
					await this.createInnerSession(connection);
				}
				return connection;
			} catch (error) {
				// Never retain a client whose registration or inner creation failed.
				this.connections.delete(outerSessionId);
				connection.unsubscribe();
				await client.dispose().catch(() => undefined);
				throw error;
			}
		})().finally(() => {
			this.connectionPromises.delete(outerSessionId);
		});
		this.connectionPromises.set(outerSessionId, connecting);
		return await connecting;
	}

	private async createInnerSession(connection: CloudConnection): Promise<void> {
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
		const live = this.ctx.liveSessions.get(connection.remote.id);
		const reply = await connection.client.command("session.create", {
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			cwd: CLOUD_WORKSPACE_ROOT,
			sessionConfig: {
				providerId: "cline",
				modelId,
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				systemPrompt: GITHUB_AUTH_SYSTEM_PROMPT,
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
				source: "desktop",
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
		// A newly-created inner session has an authoritative empty transcript.
		connection.transcriptKnown = true;
	}

	private handleEvent(
		outerSessionId: string,
		connection: CloudConnection,
		event: HubEventEnvelope,
	): void {
		if (
			connection.innerSessionId &&
			event.sessionId &&
			event.sessionId !== connection.innerSessionId
		) {
			return;
		}
		const eventId = event.eventId?.trim();
		if (eventId) {
			if (connection.seenEventIds.has(eventId)) return;
			connection.seenEventIds.add(eventId);
			connection.seenEventIdOrder.push(eventId);
			while (connection.seenEventIdOrder.length > MAX_SEEN_EVENT_IDS) {
				const removed = connection.seenEventIdOrder.shift();
				if (removed) connection.seenEventIds.delete(removed);
			}
		}
		if (connection.bufferingEvents) {
			connection.bufferedEvents.push(event);
			if (connection.bufferedEvents.length > MAX_BUFFERED_SYNC_EVENTS) {
				connection.bufferedEvents.shift();
				this.ctx.logger?.log("Cloud sync event buffer reached its limit", {
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
		handleHubLiveEvent(this.ctx, { ...event, sessionId: outerSessionId });
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
		const item: ToolApprovalRequestItem = {
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
		this.ctx.pendingApprovals.set(requestId, {
			item,
			resolve: async (result) => {
				await this.ensureAttached(connection);
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

	private async refreshPendingApprovals(
		outerSessionId: string,
		connection: CloudConnection,
	): Promise<void> {
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) return;
		const reply = await connection.client
			.command(
				"approval.list_pending",
				{ sessionId: innerSessionId },
				innerSessionId,
			)
			.catch(() => undefined);
		// Old pods lack this command; keep observed state unless a list is returned.
		if (!reply?.ok || !Array.isArray(reply.payload?.approvals)) {
			return;
		}
		for (const [requestId, pending] of this.ctx.pendingApprovals) {
			if (pending.item.sessionId === outerSessionId) {
				this.ctx.pendingApprovals.delete(requestId);
			}
		}
		const approvals = reply.payload.approvals;
		for (const approval of approvals) {
			if (
				approval &&
				typeof approval === "object" &&
				!Array.isArray(approval)
			) {
				this.storePendingApproval(
					outerSessionId,
					connection,
					approval as Record<string, unknown>,
				);
			}
		}
		this.sendApprovalSnapshot(outerSessionId);
	}

	private removeApproval(outerSessionId: string, approvalId: string): void {
		this.ctx.pendingApprovals.delete(`${outerSessionId}:${approvalId}`);
		this.sendApprovalSnapshot(outerSessionId);
	}

	private sendApprovalSnapshot(outerSessionId: string): void {
		sendEvent(this.ctx, "tool_approval_state", {
			sessionId: outerSessionId,
			items: Array.from(this.ctx.pendingApprovals.values())
				.filter((pending) => pending.item.sessionId === outerSessionId)
				.map((pending) => pending.item),
		});
	}

	private async ensureAttached(connection: CloudConnection): Promise<void> {
		if (!connection.innerSessionId) {
			return;
		}
		await connection.client.command(
			"session.attach",
			{ sessionId: connection.innerSessionId },
			connection.innerSessionId,
		);
	}

	private async disposeConnection(outerSessionId: string): Promise<void> {
		const connection = this.connections.get(outerSessionId);
		this.connections.delete(outerSessionId);
		if (!connection) {
			return;
		}
		connection.unsubscribe();
		await connection.client.dispose();
	}
}

export function getCloudSessionManager(
	ctx: SidecarContext,
): CloudSessionManager {
	const existing = ctx.cloudSessionManager;
	if (existing instanceof CloudSessionManager) {
		return existing;
	}
	const environment = getClineEnvironmentConfig();
	const providerSettingsManager = new ProviderSettingsManager();
	const getAuthToken = () =>
		resolveFreshClineAuthToken(providerSettingsManager);
	const api = new CloudSessionApi({
		apiBaseUrl: environment.apiBaseUrl,
		appBaseUrl: environment.appBaseUrl,
		getAuthToken,
	});
	const accountService = new ClineAccountService({
		apiBaseUrl: environment.apiBaseUrl,
		getAuthToken,
	});
	// Cache successful org lookups across sidebar polls; never cache failures.
	let activeOrgCache: { id: string | undefined; at: number } | undefined;
	const getActiveOrganizationId = async (): Promise<string | undefined> => {
		if (activeOrgCache && Date.now() - activeOrgCache.at < 60_000) {
			return activeOrgCache.id;
		}
		const organizations = await accountService.fetchUserOrganizations();
		const id = organizations?.find(
			(organization) => organization.active,
		)?.organizationId;
		activeOrgCache = { id, at: Date.now() };
		return id;
	};
	const manager = new CloudSessionManager(ctx, {
		api,
		apiBaseUrl: environment.apiBaseUrl,
		getAuthToken,
		getActiveOrganizationId,
	});
	ctx.cloudSessionManager = manager;
	return manager;
}

export async function resetCloudSessionManager(
	ctx: SidecarContext,
): Promise<void> {
	const manager = ctx.cloudSessionManager;
	ctx.cloudSessionManager = null;
	await manager?.dispose();
}
