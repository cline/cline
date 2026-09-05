import { randomUUID } from "node:crypto";
import {
	ClineAccountService,
	isHubCommandTimeoutError,
	isHubReconnectableTransportError,
	NodeHubClient,
	ProviderSettingsManager,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import {
	decodeJwtPayload,
	getClineEnvironmentConfig,
	type HubEventEnvelope,
} from "@cline/shared";
import {
	CLOUD_PROVISIONING_SESSION_ID_PREFIX,
	type CloudBranchListOptions,
	type CloudBranchListResult,
	type CloudRepositoryListResult,
	cloudRepositoryLabel,
} from "../webview/lib/cloud-repositories";
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
const PROVISIONING_POLL_MS = 3_000;
// Bound hot-path REST calls so a dead network cannot hang the sidebar.
const REQUEST_TIMEOUT_MS = 15_000;
// Queue deliveries are acked promptly by the hub; a dead transport must not
// hang them forever the way a run-length immediate send legitimately can.
const QUEUE_COMMAND_TIMEOUT_MS = 30_000;
const CLOUD_ERROR_PREFIX = "CLOUD_SESSION_ERROR:";
const MAX_BUFFERED_SYNC_EVENTS = 2_000;
const MAX_SEEN_EVENT_IDS = 2_000;
const CREATE_REQUEST_TITLE_PREFIX = "__cline_create_request__:";
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
	metadata: {
		modelId?: string;
		statusReason?: string;
		createRequestTitle?: string;
	};
	expiredAt?: string | null;
	createdAt: string;
	updatedAt: string;
};

export type CloudProvisioningOutcome =
	| { status: "provisioning" }
	| { status: "ready"; sessionId: string }
	| { status: "failed"; message: string };

export function deriveCloudSessionTitle(prompt: string): string {
	return (prompt.trim().split("\n")[0] ?? "").trim().slice(0, 72);
}

export type CreateCloudSessionInput = {
	/** Stable client-planned id for single-flighting one chat's start request. */
	requestId?: string;
	modelId: string;
	repoUrl: string;
	initialPrompt?: string;
	branch?: string;
	autoApproveTools?: boolean;
	thinking?: boolean;
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	/** Omit for a personal session; otherwise scopes billing to this org. */
	organizationId?: string;
};

// The repository/branch wire contract is owned by the webview lib so the two
// sides of the desktop client cannot silently drift; re-exported here for
// sidecar-side consumers.
export type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
	CloudRepositoryOption,
} from "../webview/lib/cloud-repositories";

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
	| "session_failed"
	| "request_failed";

export class CloudSessionError extends Error {
	constructor(
		readonly code: CloudErrorCode,
		readonly detail: string,
		readonly connectUrl?: string,
		/** HTTP status of the failed request, when one was received. */
		readonly status?: number,
	) {
		super(
			`${CLOUD_ERROR_PREFIX}${JSON.stringify({ code, message: detail, connectUrl })}`,
		);
		this.name = "CloudSessionError";
	}
}

function isTransientGitHubTokenVendFailure(error: unknown): boolean {
	if (!(error instanceof CloudSessionError) || error.status !== 502)
		return false;
	const detail = error.detail.toLowerCase();
	return (
		detail.includes("couldn't authenticate with github") &&
		detail.includes("reconnecting the integration")
	);
}

type ApiResponse<T> = {
	success?: boolean;
	data?: T;
	error?: string;
};

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

function createRequestTitle(requestId: string): string {
	return `${CREATE_REQUEST_TITLE_PREFIX}${requestId}`.slice(0, 255);
}

function isCreateRequestTitle(title: string | undefined): boolean {
	return title?.startsWith(CREATE_REQUEST_TITLE_PREFIX) === true;
}

type CreationAuth = {
	token: string;
	subject?: string;
};

type RequestAuth = string | CreationAuth;

function authSubject(token: string): string | undefined {
	const payload = decodeJwtPayload(token.replace(/^workos:/, ""));
	return typeof payload?.sub === "string" && payload.sub.trim()
		? payload.sub.trim()
		: undefined;
}

function waitForProvisioningPoll(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, PROVISIONING_POLL_MS);
		signal.addEventListener("abort", onAbort, { once: true });
	});
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
	if (status === 403 && message.trim().toLowerCase() === "forbidden") {
		return new CloudSessionError(
			"request_failed",
			"Your active account or organization cannot create cloud sessions. Switch to Personal or another organization in Settings → Account, then try again.",
			undefined,
			status,
		);
	}
	return new CloudSessionError("request_failed", message, undefined, status);
}

export class CloudSessionApi {
	private readonly apiBaseUrl: string;
	private readonly appBaseUrl: string;
	private readonly fetchImpl: FetchLike;
	private readonly createTimeoutMs: number;
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
		auth?: RequestAuth,
	): Promise<T> {
		let refreshed = false;
		while (true) {
			const token =
				typeof auth === "string"
					? auth
					: (auth?.token ?? (await this.options.getAuthToken()));
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
				if (
					response.status === 401 &&
					typeof auth === "object" &&
					!refreshed &&
					(await this.refreshCreationAuth(auth))
				) {
					refreshed = true;
					continue;
				}
				throw cloudErrorForResponse(
					response.status,
					payload,
					this.appBaseUrl,
					githubConnectUrl,
				);
			}
			return (payload as ApiResponse<T> | undefined)?.data as T;
		}
	}

	private async refreshCreationAuth(auth: CreationAuth): Promise<boolean> {
		if (!auth.subject) return false;
		const freshToken = (await this.options.getAuthToken())?.trim();
		if (
			!freshToken ||
			freshToken === auth.token ||
			authSubject(freshToken) !== auth.subject
		) {
			return false;
		}
		auth.token = freshToken;
		return true;
	}

	async list(organizationId?: string): Promise<CloudSessionRecord[]> {
		return await this.listWithToken(organizationId);
	}

	private async listWithToken(
		organizationId?: string,
		auth?: RequestAuth,
		preserveCreateRequestTitle = false,
	): Promise<CloudSessionRecord[]> {
		const query = organizationId?.trim()
			? `?organizationId=${encodeURIComponent(organizationId.trim())}`
			: "";
		const rows =
			(await this.request<CloudSessionRecord[]>(
				`/api/v1/session${query}`,
				{},
				undefined,
				auth,
			)) ?? [];
		// Normalize before anything touches the rows: one malformed record
		// (missing repoContext/metadata) must not crash discovery or turn a
		// create-timeout recovery into an opaque TypeError.
		return rows.flatMap((row) => {
			if (!row || typeof row !== "object" || typeof row.id !== "string") {
				return [];
			}
			return [
				{
					...row,
					title:
						!preserveCreateRequestTitle && isCreateRequestTitle(row.title)
							? undefined
							: row.title,
					repoContext:
						row.repoContext && typeof row.repoContext === "object"
							? row.repoContext
							: {},
					metadata: {
						...(row.metadata && typeof row.metadata === "object"
							? row.metadata
							: {}),
						...(!preserveCreateRequestTitle && isCreateRequestTitle(row.title)
							? { createRequestTitle: row.title }
							: {}),
					},
				},
			];
		});
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

	async status(
		sessionId: string,
		options: { authToken?: string; signal?: AbortSignal } = {},
	): Promise<{ sessionId?: string; status?: string; statusReason?: string }> {
		return await this.request(
			`/api/v1/session/${encodeURIComponent(sessionId)}/status`,
			{ signal: options.signal },
			undefined,
			options.authToken,
		);
	}

	async create(input: CreateCloudSessionInput): Promise<{
		sessionId: string;
		sandboxUrl: string;
		cleanupAuthToken: string;
	}> {
		const initialAuthToken = (await this.options.getAuthToken())?.trim();
		if (!initialAuthToken) {
			throw new CloudSessionError(
				"authentication_required",
				"Sign in to Cline before starting a cloud session.",
			);
		}
		const creationAuth: CreationAuth = {
			token: initialAuthToken,
			subject: authSubject(initialAuthToken),
		};
		const recoveryTitle = createRequestTitle(
			input.requestId?.trim() || randomUUID(),
		);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.createTimeoutMs);
		let createdSessionId = "";
		try {
			const created = await this.request<{
				sessionId: string;
				sandboxUrl?: string;
				status?: string;
			}>(
				"/api/v1/session",
				{
					method: "POST",
					body: JSON.stringify({
						modelId: input.modelId,
						repoUrl: input.repoUrl,
						title: recoveryTitle,
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
				creationAuth,
			);
			const sessionId = created?.sessionId?.trim();
			if (!sessionId) {
				throw new CloudSessionError(
					"request_failed",
					"The cloud session service returned no session id.",
				);
			}
			createdSessionId = sessionId;
			if (created.status === "provisioning" || !created.sandboxUrl?.trim()) {
				await this.waitUntilReady(sessionId, controller.signal, creationAuth);
			}
			return {
				sessionId,
				sandboxUrl: created.sandboxUrl?.trim() ?? "",
				cleanupAuthToken: creationAuth.token,
			};
		} catch (error) {
			if (createdSessionId) {
				if (
					error instanceof CloudSessionError &&
					error.code === "session_failed"
				) {
					// A terminally failed sandbox lingers in the account list
					// otherwise; clean it up under the identity that created it.
					try {
						await this.deleteWithAuth(createdSessionId, creationAuth);
					} catch (cleanupError) {
						if (
							!(
								cleanupError instanceof CloudSessionError &&
								(cleanupError.code === "session_not_found" ||
									cleanupError.code === "session_expired")
							)
						) {
							throw new AggregateError(
								[error, cleanupError],
								"The cloud workspace failed to provision and could not be cleaned up.",
							);
						}
					}
				}
				throw error;
			}
			// Provisioning may outlive the synchronous request only when the
			// POST timed out or the server failed after possibly accepting it
			// (5xx / no HTTP status). A fast client-side rejection (4xx) never
			// provisioned anything, and recovering on one risks silently
			// adopting an identical-config session created by another device
			// on the same account.
			const mayStillBeProvisioning =
				controller.signal.aborted ||
				!(error instanceof CloudSessionError) ||
				(error instanceof CloudSessionError &&
					error.code === "request_failed" &&
					(error.status === undefined || error.status >= 500));
			if (mayStillBeProvisioning) {
				const requestedBranch = input.branch?.trim();
				// The API has no idempotency header, so stamp the request id into
				// the optional title and recover only that exact record. Config/time
				// matching can steal another process's otherwise-identical session.
				const candidates = (
					await this.listWithToken(
						input.organizationId,
						creationAuth,
						true,
					).catch(() => [])
				).filter(
					(session) =>
						session.title === recoveryTitle &&
						session.repoContext.repoUrl === input.repoUrl &&
						session.metadata.modelId === input.modelId &&
						(!requestedBranch ||
							session.repoContext.branch === requestedBranch),
				);
				if (candidates.length > 1) {
					throw new CloudSessionError(
						"request_failed",
						"Cloud session creation had an ambiguous result. Check your cloud session list before trying again.",
					);
				}
				const recovered = candidates[0];
				if (recovered) {
					if (
						recovered.status === "provisioning" ||
						recovered.status === "failed" ||
						!recovered.sandboxUrl?.trim()
					) {
						const recoveryController = new AbortController();
						const recoveryTimeout = setTimeout(
							() => recoveryController.abort(),
							this.createTimeoutMs,
						);
						try {
							await this.waitUntilReady(
								recovered.id,
								recoveryController.signal,
								creationAuth,
							);
						} catch (recoveryError) {
							if (
								recoveryError instanceof CloudSessionError &&
								recoveryError.code === "session_failed"
							) {
								await this.deleteWithAuth(recovered.id, creationAuth).catch(
									(cleanupError) => {
										if (
											!(
												cleanupError instanceof CloudSessionError &&
												(cleanupError.code === "session_not_found" ||
													cleanupError.code === "session_expired")
											)
										) {
											throw cleanupError;
										}
									},
								);
							}
							throw recoveryError;
						} finally {
							clearTimeout(recoveryTimeout);
						}
					}
					return {
						sessionId: recovered.id,
						sandboxUrl: recovered.sandboxUrl,
						cleanupAuthToken: creationAuth.token,
					};
				}
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async waitUntilReady(
		sessionId: string,
		signal: AbortSignal,
		authToken?: RequestAuth,
	): Promise<void> {
		while (!signal.aborted) {
			let result:
				| { sessionId?: string; status?: string; statusReason?: string }
				| undefined;
			try {
				result = await this.request(
					`/api/v1/session/${encodeURIComponent(sessionId)}/status`,
					{
						signal: AbortSignal.any([
							signal,
							AbortSignal.timeout(REQUEST_TIMEOUT_MS),
						]),
					},
					undefined,
					authToken,
				);
			} catch (error) {
				if (signal.aborted) throw error;
				if (
					error instanceof CloudSessionError &&
					error.code !== "request_failed"
				) {
					throw error;
				}
				await waitForProvisioningPoll(signal);
				continue;
			}
			const status = result?.status?.trim().toLowerCase();
			if (status === "ready" || status === "active") return;
			if (status === "failed") {
				throw new CloudSessionError(
					"session_failed",
					result?.statusReason?.trim() ||
						"The cloud sandbox could not be prepared.",
				);
			}
			if (status !== "provisioning") {
				throw new CloudSessionError(
					"request_failed",
					"The cloud session service returned an unexpected provisioning status.",
				);
			}
			await waitForProvisioningPoll(signal);
		}
		throw signal.reason;
	}

	async delete(sessionId: string, authToken?: string): Promise<void> {
		await this.deleteWithAuth(sessionId, authToken);
	}

	private async deleteWithAuth(
		sessionId: string,
		auth?: RequestAuth,
	): Promise<void> {
		await this.request(
			`/api/v1/session/${encodeURIComponent(sessionId)}`,
			{ method: "DELETE" },
			undefined,
			auth,
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
	submittedPrompts: PromptInQueue[];
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
	/** Set by disposeConnection; late timers and approval callbacks must not
	 * command (and thereby resurrect) a disposed client. */
	disposed?: boolean;
	/** Rate-limits cloud_session_sync_failed to state transitions so a
	 * reconnect loop cannot spam the UI on every attempt. */
	syncFailureNotified?: boolean;
	unsubscribe: () => void;
};

type CloudSessionManagerOptions = {
	api: Pick<
		CloudSessionApi,
		| "create"
		| "delete"
		| "list"
		| "status"
		| "history"
		| "updateTitle"
		| "listRepositories"
		| "listBranches"
	>;
	getAuthToken: () => Promise<string | undefined>;
	apiBaseUrl: string;
	/** Resolves the active billing org; undefined means a personal session. */
	getActiveOrganizationId?: (options?: {
		fresh?: boolean;
	}) => Promise<string | undefined>;
	/** Test seam for retry backoff waits. */
	sleep?: (ms: number) => Promise<void>;
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

/** Reply shape for chat_session_command start/attach on a cloud session. */
function attachResultPayload(
	record: CloudSessionRecord,
	status: string,
	prompt?: string,
): JsonRecord {
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

function isRootSessionRow(record: JsonRecord): boolean {
	const metadata =
		record.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	return !String(
		metadata?.parentSessionId ?? record.parentSessionId ?? "",
	).trim();
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

function submittedPromptsFromEvents(
	events: HubEventEnvelope[],
): PromptInQueue[] {
	return events.flatMap((event) => {
		if (event.event !== "session.pending_prompt_submitted") return [];
		const prompt =
			event.payload?.prompt &&
			typeof event.payload.prompt === "object" &&
			!Array.isArray(event.payload.prompt)
				? (event.payload.prompt as JsonRecord)
				: undefined;
		const id = String(prompt?.id ?? "").trim();
		if (!id) return [];
		return [
			{
				id,
				prompt: String(prompt?.prompt ?? ""),
				steer: prompt?.delivery === "steer",
				attachmentCount:
					typeof prompt?.attachmentCount === "number"
						? prompt.attachmentCount
						: 0,
				userImages: Array.isArray(prompt?.userImages)
					? prompt.userImages.filter(
							(image): image is string => typeof image === "string",
						)
					: undefined,
			},
		];
	});
}

function mergePromptEvidence(
	prompts: PromptInQueue[] | undefined,
	submittedPrompts: PromptInQueue[],
): PromptInQueue[] {
	const merged = [...(prompts ?? [])];
	const knownIds = new Set(merged.map((prompt) => prompt.id));
	for (const prompt of submittedPrompts) {
		if (!knownIds.has(prompt.id)) merged.push(prompt);
	}
	return merged;
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

function newlyPersistedAssistantTexts(
	snapshotMessages: unknown[],
	baselineMessages: unknown[],
): string[] {
	const baselineCounts = new Map<string, number>();
	for (const text of assistantTexts(baselineMessages)) {
		baselineCounts.set(text, (baselineCounts.get(text) ?? 0) + 1);
	}
	return assistantTexts(snapshotMessages).filter((text) => {
		const count = baselineCounts.get(text) ?? 0;
		if (count === 0) return true;
		if (count === 1) baselineCounts.delete(text);
		else baselineCounts.set(text, count - 1);
		return false;
	});
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
		 * rehydration. When it was, queue events received before its reply are
		 * stale; later events still win. When the fetch failed, the newest
		 * buffered queue event is the best state available.
		 */
		queueSnapshotApplied?: boolean;
		queueSnapshotEventCutoff?: number;
		baselineMessages?: unknown[];
	} = {},
): HubEventEnvelope[] {
	const queueSnapshotApplied = options.queueSnapshotApplied !== false;
	const unclaimedAssistantTexts = newlyPersistedAssistantTexts(
		snapshotMessages,
		options.baselineMessages ?? [],
	);
	const snapshotToolCallIds = collectToolCallIds(snapshotMessages);
	// Queue events are full snapshots, so only the newest one matters.
	const queueEvents = queueSnapshotApplied
		? events.slice(options.queueSnapshotEventCutoff ?? events.length)
		: events;
	const lastQueueEvent = queueEvents.findLast(
		(event) => event.event === "session.pending_prompts",
	);
	const reconciled: HubEventEnvelope[] = [];
	let segment: HubEventEnvelope[] = [];

	const flush = (terminal: boolean) => {
		if (segment.length === 0) return;
		const streamed = terminal ? streamedAssistantText(segment) : "";
		const persistedIndex = streamed
			? unclaimedAssistantTexts.findIndex((text) => text.includes(streamed))
			: -1;
		const contentPersisted = persistedIndex >= 0;
		if (contentPersisted) unclaimedAssistantTexts.splice(persistedIndex, 1);
		for (const event of segment) {
			if (contentPersisted && SUPERSEDABLE_CONTENT_EVENTS.has(event.event)) {
				continue;
			}
			// Replay only the newest queue state after the snapshot cutoff.
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
	private readonly createRequests = new Map<string, Promise<JsonRecord>>();
	// Keep locally-created sessions visible while their sandbox is provisioning.
	private readonly pendingCreates = new Map<string, JsonRecord>();
	// Reconcile only the server row stamped by this exact create request.
	private readonly pendingCreateRecoveryTitles = new Map<string, string>();
	private readonly provisioningOutcomes = new Map<
		string,
		Exclude<CloudProvisioningOutcome, { status: "provisioning" }>
	>();
	// Sessions mid-delete; blocks concurrent code from re-dialing them.
	private readonly deletingSessions = new Set<string>();
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
			this.provisioningOutcomes.has(sessionId) ||
			this.connections.has(sessionId) ||
			this.ctx.liveSessions.get(sessionId)?.config.executionTarget === "cloud"
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
		if (!cached || typeof this.options.api.status !== "function") {
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
				return undefined;
			}
			// A scope/auth/network failure cannot prove the cached session is gone.
			return cached;
		}
	}

	getProvisioningOutcome(
		placeholderId: string,
	): CloudProvisioningOutcome | null {
		if (this.pendingCreates.has(placeholderId)) {
			return { status: "provisioning" };
		}
		return this.provisioningOutcomes.get(placeholderId) ?? null;
	}

	async list(): Promise<CloudSessionRecord[]> {
		const organizationId = await this.resolveActiveOrganizationId();
		const listed = (await this.options.api.list(organizationId)).map(
			(session) => this.preserveConnectedRuntimeModel(session),
		);
		// Keep canonical rows available while their status checks run.
		this.lastListedSessions = listed;
		for (const session of listed) {
			this.knownSessions.set(session.id, session);
		}
		const scoped = await Promise.all(
			listed.map(async (session) => {
				if (
					session.status !== "provisioning" ||
					typeof this.options.api.status !== "function"
				) {
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
						...(result?.statusReason?.trim()
							? { statusReason: result.statusReason.trim() }
							: {}),
					},
				};
			}),
		);
		// Retain other scopes for routing; only lastListedSessions drives the sidebar.
		for (const session of scoped) {
			this.knownSessions.set(session.id, session);
			const connection = this.connections.get(session.id);
			if (connection) {
				// Keep the connection's record current (title/model changes from
				// other devices), and reap connections whose sandbox expired so
				// they stop reconnect-looping against a dead proxy.
				connection.remote = session;
				if (isExpiredRecord(session)) {
					const live = this.ctx.liveSessions.get(session.id);
					if (live) {
						live.busy = false;
						live.status = "expired";
						live.endedAt = Date.parse(session.expiredAt ?? "") || Date.now();
					}
					void this.disposeConnection(session.id).catch(() => undefined);
				}
			}
		}
		this.lastListedSessions = scoped;
		return scoped;
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
							this.ctx.logger?.error?.("Cloud session discovery failed", {
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

		const placeholders = Array.from(this.pendingCreates.values());
		const unmatchedRecoveryTitles = new Set(
			this.pendingCreateRecoveryTitles.values(),
		);
		const listedRecords = records.filter((record) => {
			const title =
				record.metadata.createRequestTitle?.trim() ?? record.title?.trim();
			return !title || !unmatchedRecoveryTitles.delete(title);
		});
		const listed = listedRecords.map((record) => {
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

	private async createOnce(
		input: CreateCloudSessionInput,
	): Promise<JsonRecord> {
		if (this.disposed) {
			throw new Error("Cloud session manager was disposed");
		}
		// Keep the session visible while the blocking create request provisions it.
		const placeholderId = `${CLOUD_PROVISIONING_SESSION_ID_PREFIX}${randomUUID()}`;
		const requestId = input.requestId?.trim();
		if (requestId) {
			this.pendingCreateRecoveryTitles.set(
				placeholderId,
				createRequestTitle(requestId),
			);
		}
		const startedAt = new Date().toISOString();
		this.pendingCreates.set(placeholderId, {
			sessionId: placeholderId,
			origin: "cloud",
			executionTarget: "cloud",
			status: "provisioning",
			provider: "cline",
			model: input.modelId,
			repoUrl: input.repoUrl,
			branch: input.branch ?? "",
			cwd: CLOUD_WORKSPACE_ROOT,
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			...(input.initialPrompt?.trim()
				? { prompt: input.initialPrompt.trim() }
				: {}),
			startedAt,
			updatedAt: startedAt,
			metadata: {
				origin: "cloud",
				repoUrl: input.repoUrl,
				git: { url: input.repoUrl, branch: input.branch ?? "" },
				title: `Provisioning ${cloudRepositoryLabel(input.repoUrl, "repository")}…`,
			},
		});
		// Show the placeholder before the next sidebar poll.
		sendEvent(this.ctx, "chat_session_status", {
			sessionId: placeholderId,
			status: "provisioning",
		});
		try {
			const created = await this.createProvisionedSession(input);
			const sessionId = String(created.sessionId ?? "");
			this.provisioningOutcomes.set(placeholderId, {
				status: "ready",
				sessionId,
			});
			// Swap an open placeholder thread to the real session.
			sendEvent(this.ctx, "cloud_session_provisioned", {
				placeholderId,
				sessionId,
			});
			return created;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.provisioningOutcomes.set(placeholderId, {
				status: "failed",
				message,
			});
			// A thread opened on the placeholder needs a terminal signal, or
			// its provisioning pane spins forever after the row disappears.
			sendEvent(this.ctx, "cloud_session_provisioning_failed", {
				placeholderId,
				message,
			});
			throw error;
		} finally {
			this.pendingCreates.delete(placeholderId);
			this.pendingCreateRecoveryTitles.delete(placeholderId);
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
			input.organizationId ??
			(await this.resolveActiveOrganizationId({ fresh: true }));
		let created: Awaited<ReturnType<CloudSessionApi["create"]>> | undefined;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				created = await this.options.api.create({
					...input,
					organizationId,
				});
				break;
			} catch (error) {
				// The secrets proxy occasionally 502s while vending the GitHub
				// token; that specific failure is safe to retry (nothing was
				// provisioned). Any other 502 could have provisioned.
				if (!isTransientGitHubTokenVendFailure(error) || attempt === 2) {
					throw error;
				}
				await (
					this.options.sleep ??
					((ms: number) =>
						new Promise<void>((resolve) => setTimeout(resolve, ms)))
				)(500 * (attempt + 1));
			}
		}
		if (!created?.sessionId?.trim()) {
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
		live.prompt = input.initialPrompt?.trim() || undefined;
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
			...(live.prompt ? { prompt: live.prompt } : {}),
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
		if (known.status === "provisioning" || known.status === "failed") {
			return attachResultPayload(known, known.status);
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
		await this.refreshPendingApprovals(outerSessionId, connection);
		const record = connection.remote;
		const live = this.ctx.liveSessions.get(outerSessionId);
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
		if (!connection.transcriptKnown) {
			await this.rehydrateAfterTransportDrop(outerSessionId, connection);
		}
		// Rehydration attaches again and may reveal a model change made by a
		// different client. Enforce this send's selected model only after the
		// final authoritative snapshot.
		await this.updateModel(connection, modelId);
		const live = this.ctx.liveSessions.get(outerSessionId);
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
			}
		};
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
				{
					prompt,
					delivery,
					...(userImages?.length ? { attachments: { userImages } } : {}),
				},
				innerSessionId,
				delivery === "queue"
					? { timeoutMs: QUEUE_COMMAND_TIMEOUT_MS }
					: { timeoutMs: null },
			);
			return {
				sessionId: outerSessionId,
				ok: true,
				...(delivery === "queue" ? { queued: true } : {}),
				result: reply.payload?.result,
			};
		} catch (error) {
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
					removePendingMessage();
					if (live && ownsBusyState) {
						live.busy = false;
						live.status = "error";
					}
					throw recoveryError;
				}
				// Without a queue snapshot the absence of the prompt proves
				// nothing for a queue delivery — telling the user to resend
				// would duplicate a durably queued prompt.
				if (delivery === "queue" && snapshot.prompts === undefined) {
					throw new CloudSessionError(
						"request_failed",
						"The connection was interrupted and Cline could not confirm whether this message was queued. Check the cloud session before resending it.",
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
			removePendingMessage();
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
			this.applySessionModel(connection, session);
			const live = this.ctx.liveSessions.get(outerSessionId);
			const baselineMessages = live?.messages ?? [];
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
			const queueSnapshotEventCutoff = connection.bufferedEvents.length;

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
						live.endedAt = Date.now();
						sendEvent(this.ctx, "chat_session_ended", {
							sessionId: outerSessionId,
							// The live run.failed path reports "error"; keep the
							// rehydrated terminal state on the same vocabulary.
							reason: status === "failed" ? "error" : status,
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
			const bufferedEvents = connection.bufferedEvents;
			const submittedPrompts = submittedPromptsFromEvents(bufferedEvents);
			const buffered = reconcileBufferedCloudEvents(bufferedEvents, messages, {
				queueSnapshotApplied: queueSnapshotValid,
				queueSnapshotEventCutoff,
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
			for (const event of buffered) {
				this.forwardEvent(outerSessionId, connection, event);
			}
			// Notify on the transition only: reconnect loops rehydrate on every
			// attempt, and one toast per attempt would flood the UI.
			if (!connection.syncFailureNotified) {
				connection.syncFailureNotified = true;
				sendEvent(this.ctx, "cloud_session_sync_failed", {
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
		const connection = await this.ensureConnection(outerSessionId);
		// No inner session means nothing was ever queued; answering [] beats
		// throwing after having dialed a socket just to fail.
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
		// A reply without a prompts array is not a snapshot; treating it as
		// an empty queue would silently hide queued or steered prompts.
		if (!Array.isArray(reply.payload?.prompts)) {
			throw new Error("Cloud Hub returned an invalid pending-prompts snapshot");
		}
		const items = reply.payload.prompts as Array<Record<string, unknown>>;
		const mapped: PromptInQueue[] = items
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
		// Tombstone the id so a concurrent attach/send/readMessages cannot dial
		// a fresh connection for a session that is being torn down.
		this.deletingSessions.add(outerSessionId);
		try {
			// Settle an in-flight connect before deleting its connection.
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
			this.ctx.liveSessions.delete(outerSessionId);
			for (const [requestId, pending] of this.ctx.pendingApprovals) {
				if (pending.item.sessionId === outerSessionId) {
					this.ctx.pendingApprovals.delete(requestId);
				}
			}
		} finally {
			this.deletingSessions.delete(outerSessionId);
		}
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		const sessionIds = new Set([
			...this.connections.keys(),
			...this.knownSessions.keys(),
		]);
		// Clear desktop-visible state synchronously BEFORE the async socket
		// teardown: resetCloudSessionManager nulls the context slot first, so
		// a command arriving mid-dispose builds a fresh manager — deleting
		// liveSessions/pendingApprovals after an await would destroy entries
		// that new manager just re-created.
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
		this.pendingCreateRecoveryTitles.clear();
		this.provisioningOutcomes.clear();
		await Promise.allSettled(
			Array.from(this.connections.keys()).map((sessionId) =>
				this.disposeConnection(sessionId),
			),
		);
	}

	private async attachExpired(record: CloudSessionRecord): Promise<JsonRecord> {
		const live =
			this.ctx.liveSessions.get(record.id) ?? recordToLiveSession(record);
		live.busy = false;
		live.status = "expired";
		this.ctx.liveSessions.set(record.id, live);
		await this.loadArchivedMessages(record).catch(() => undefined);
		return attachResultPayload(record, "expired");
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
		live.messages = messages as MessageWithMetadata[];
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
		if (this.deletingSessions.has(outerSessionId)) {
			throw new CloudSessionError(
				"session_not_found",
				"This cloud session is being deleted.",
			);
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
				// Hub registrations are keyed globally by client id. A per-process
				// suffix prevents one viewer from replacing another viewer of the
				// same cloud session and unregistering it on close.
				clientId: `code-cloud-${outerSessionId}-${randomUUID()}`,
				clientType: "code-cloud-sidecar",
				displayName: "Cline Code cloud session",
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				resolveConnectionHeaders: async () => {
					const reconnecting = socketAttempt > 0;
					socketAttempt += 1;
					if (reconnecting) {
						setTimeout(() => {
							const reconnected = connection;
							if (!reconnected || reconnected.disposed) return;
							// A dropped transport invalidates the duplicate-prompt
							// baseline send() computes from live.messages.
							reconnected.transcriptKnown = false;
							void this.rehydrateAfterTransportDrop(
								outerSessionId,
								reconnected,
							).catch(() =>
								this.disposeConnectionIfSessionGone(
									outerSessionId,
									reconnected,
								),
							);
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
			try {
				await client.connect();
				if (this.disposed) {
					throw new Error("Cloud session manager was disposed");
				}
				const listed = await client.command("session.list", { limit: 100 });
				const newest = readSessionRows(listed.payload)
					.filter(isRootSessionRow)
					.sort((left, right) => updatedAt(right) - updatedAt(left))[0];
				const innerSessionId = String(newest?.sessionId ?? "").trim();
				if (innerSessionId) {
					connection.innerSessionId = innerSessionId;
					this.subscribeToInnerSession(outerSessionId, connection);
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
				connection.disposed = true;
				connection.unsubscribe();
				await client.dispose().catch(() => undefined);
				// Approvals stored during the failed setup hold resolve closures
				// over this dead connection; drop them so a later user response
				// cannot resurrect the disposed client.
				for (const [requestId, pending] of this.ctx.pendingApprovals) {
					if (pending.item.sessionId === outerSessionId) {
						this.ctx.pendingApprovals.delete(requestId);
					}
				}
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
		this.subscribeToInnerSession(connection.remote.id, connection);
		this.applySessionModel(connection, session);
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
		// Pod-relayed approvals have no local owner: they must survive a
		// webview reload/disconnect and stay answerable from any trusted
		// surface, so they are stored ownerless rather than declined.
		this.ctx.pendingApprovals.set(requestId, {
			item,
			resolve: async (result) => {
				if (connection.disposed) {
					// Commanding a disposed NodeHubClient would silently redial;
					// make the user reopen the session instead.
					throw new Error(
						"This cloud session connection is closed; reopen the session to respond.",
					);
				}
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
		if (
			this.disposed ||
			connection.disposed ||
			this.connections.get(outerSessionId) !== connection
		) {
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
		const reply = await connection.client.command(
			"session.attach",
			{ sessionId: connection.innerSessionId },
			connection.innerSessionId,
		);
		this.applySessionModel(connection, reply.payload?.session);
	}

	private subscribeToInnerSession(
		outerSessionId: string,
		connection: CloudConnection,
	): void {
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) return;
		connection.unsubscribe();
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
		const connection = this.connections.get(outerSessionId);
		this.connections.delete(outerSessionId);
		if (!connection) {
			return;
		}
		connection.disposed = true;
		connection.unsubscribe();
		await connection.client.dispose();
	}

	/**
	 * Stops a reconnect loop whose session is confirmed expired or deleted.
	 * Without this, a dead sandbox left open in the app redials the proxy
	 * every few seconds indefinitely (plus a REST list per attempt). An
	 * unreachable list keeps the connection (offline must not kill live
	 * sessions).
	 */
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
			// The list succeeded and the session is absent: it was deleted
			// (possibly from another device) or the account scope changed.
			// Drop the connection so it stops redialing a dead proxy; a later
			// attach redials on demand if the session reappears.
			await this.disposeConnection(outerSessionId).catch(() => undefined);
			return;
		}
		this.knownSessions.set(outerSessionId, listed);
		connection.remote = listed;
		if (isExpiredRecord(listed)) {
			await this.attachExpired(listed).catch(() => undefined);
			await this.disposeConnection(outerSessionId).catch(() => undefined);
		}
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
		resolveFreshClineAuthToken(providerSettingsManager, ctx);
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
	const getActiveOrganizationId = async (options?: {
		fresh?: boolean;
	}): Promise<string | undefined> => {
		if (
			!options?.fresh &&
			activeOrgCache &&
			Date.now() - activeOrgCache.at < 60_000
		) {
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
