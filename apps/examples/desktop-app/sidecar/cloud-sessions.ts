import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import {
	buildCloudHandoffDashboardUrl,
	buildCloudHandoffSystemPrompt,
	ClineAccountService,
	CloudHandoffTranscriptMismatchError,
	cloudHandoffTranscriptsEqual,
	isHubCommandTimeoutError,
	isHubReconnectableTransportError,
	isSessionNotFoundError,
	NodeHubClient,
	ProviderSettingsManager,
} from "@cline/core";
import type { MessageWithMetadata } from "@cline/llms";
import {
	type AgentMode,
	decodeJwtPayload,
	getClineEnvironmentConfig,
	type HubEventEnvelope,
} from "@cline/shared";
import type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
} from "../webview/lib/cloud-repositories";
import { cloudRepositoryLabel } from "../webview/lib/cloud-repositories";
import { resolveFreshClineAuthToken } from "./cline-auth";
import {
	countPromptOccurrences,
	isRootSessionRow,
	readSessionRows,
	reconcileBufferedCloudEvents,
	sessionRowModelId,
	submittedPromptsFromEvents,
	updatedAt,
} from "./cloud-session-snapshots";
import {
	getEnvironmentContext,
	getSidecarContextOwner,
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
import { LOCAL_ENVIRONMENT_ID } from "./types";

const CLOUD_WORKSPACE_ROOT = "/workspace";
const CREATE_TIMEOUT_MS = 610_000;
const PROVISIONING_POLL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 15_000;
const QUEUE_COMMAND_TIMEOUT_MS = 30_000;
const CLOUD_ERROR_PREFIX = "CLOUD_SESSION_ERROR:";
const MAX_BUFFERED_SYNC_EVENTS = 2_000;
const MAX_SEEN_EVENT_IDS = 2_000;
const CREATE_REQUEST_TITLE_PREFIX = "__cline_create_request__:";
const CLOUD_SESSION_SYSTEM_PROMPT =
	"IMPORTANT: GitHub authentication is handled automatically by the infrastructure. " +
	"An egress proxy transparently injects credentials into all GitHub traffic. " +
	"You do NOT need to set up, configure, or manage any tokens, API keys, or credentials, " +
	"and you must never run `gh auth login` or attempt to authenticate manually. " +
	"The GitHub CLI (`gh`) is installed and already authenticated — prefer it for GitHub work " +
	"(`gh pr create`, `gh pr diff`, `gh issue list`, `gh api`, ...). " +
	"`git` push and pull are authenticated the same way. " +
	"Simply run the commands normally — credentials are injected transparently.";

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
		taskId?: string;
		statusReason?: string;
		provisioningPhase?: CloudProvisioningPhase;
		createRequestTitle?: string;
		cwd?: string;
	};
	expiredAt?: string | null;
	lastActivityAt?: string;
	createdAt: string;
	updatedAt: string;
};

export type CloudProvisioningPhase =
	| "provisioning"
	| "cloning_repo"
	| "agent_starting"
	| "ready"
	| "failed";

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
	/** Handoff-only source mode; ordinary cloud creation defaults to Act. */
	mode?: AgentMode;
	/** Handoff-only source cwd relative to the repository root. */
	workspaceRelativePath?: string;
	/** Null selects personal scope; omit to use the currently active scope. */
	organizationId?: string | null;
	/** Desktop handoff-only hooks; never serialized into the provisioning API body. */
	handoff?: {
		sourceSessionId: string;
		resolveMessages: () => Promise<MessageWithMetadata[]>;
		onOuterSessionCreated: (sessionId: string) => Promise<void>;
		onOuterSessionRemoved?: (sessionId: string) => Promise<void>;
		onSeeding?: () => void;
	};
};

type CloudHandoffSeed = {
	sourceSessionId: string;
	messages: MessageWithMetadata[];
	mode?: AgentMode;
	workspaceRelativePath?: string;
	/** Source-session settings that must survive a sidecar restart: the
	 * liveSessions fallback in createInnerSessionOnce is empty after a
	 * restart, and defaulting auto-approve to true there silently removes
	 * the approval gate from resumed handoffs. */
	config?: {
		autoApproveTools?: boolean;
		thinking?: boolean;
		reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	};
	onSeeding?: () => void;
};

function cloudWorkspaceCwd(workspaceRelativePath?: string): string {
	if (!workspaceRelativePath) return CLOUD_WORKSPACE_ROOT;
	if (
		posix.isAbsolute(workspaceRelativePath) ||
		workspaceRelativePath.includes("\\") ||
		workspaceRelativePath
			.split("/")
			.some((part) => !part || part === "." || part === "..")
	) {
		throw new CloudSessionError(
			"request_failed",
			"The handoff workspace path must stay inside the repository.",
		);
	}
	const cwd = posix.join(CLOUD_WORKSPACE_ROOT, workspaceRelativePath);
	if (!cwd.startsWith(`${CLOUD_WORKSPACE_ROOT}/`)) {
		throw new CloudSessionError(
			"request_failed",
			"The handoff workspace path must stay inside the repository.",
		);
	}
	return cwd;
}

function cloudSessionCwd(record: CloudSessionRecord): string {
	const cwd = record.metadata.cwd;
	return typeof cwd === "string" &&
		(cwd === CLOUD_WORKSPACE_ROOT || cwd.startsWith(`${CLOUD_WORKSPACE_ROOT}/`))
		? cwd
		: CLOUD_WORKSPACE_ROOT;
}

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
	/** Test seam for recovery re-list backoff waits. */
	sleep?: (ms: number) => Promise<void>;
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

/**
 * A queue delivery whose outcome could not be confirmed either way. Callers
 * must never present this as "not queued" — resubmitting a durably queued
 * prompt executes it twice.
 */
export class CloudQueueUnconfirmedError extends CloudSessionError {
	constructor() {
		super(
			"request_failed",
			"The connection was interrupted and Cline could not confirm whether this message was queued. Check the cloud session before resending it.",
		);
		this.name = "CloudQueueUnconfirmedError";
	}
}

export class CloudHandoffSeedUnsupportedError extends Error {
	constructor() {
		super(
			"The cloud session was created, but its transcript was not persisted. This cloud runtime cannot durably seed handoff transcripts and must use @cline/core 0.0.72 or newer. Updating the cloud runtime or pod is required; retrying /cloud against this same pod will not help.",
		);
		this.name = "CloudHandoffSeedUnsupportedError";
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

function createRequestTitle(requestId: string): string {
	return `${CREATE_REQUEST_TITLE_PREFIX}${requestId}`.slice(0, 255);
}

function isCreateRequestTitle(title: string | undefined): boolean {
	return title?.startsWith(CREATE_REQUEST_TITLE_PREFIX) === true;
}

function parseCloudProvisioningPhase(
	value: unknown,
): CloudProvisioningPhase | undefined {
	switch (value) {
		case "provisioning":
		case "cloning_repo":
		case "agent_starting":
		case "ready":
		case "failed":
			return value;
		default:
			return undefined;
	}
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
		// Keep malformed account records from breaking discovery or recovery.
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
	): Promise<{
		sessionId?: string;
		status?: string;
		phase?: CloudProvisioningPhase;
		statusReason?: string;
	}> {
		return await this.request(
			`/api/v1/session/${encodeURIComponent(sessionId)}/status`,
			{ signal: options.signal },
			undefined,
			options.authToken,
		);
	}

	async create(input: CreateCloudSessionInput): Promise<{
		sessionId: string;
		status: string;
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
		const requestedBranch = input.branch?.trim();
		// The API has no idempotency header, so stamp the request id into the
		// optional title and match only that exact record. Config/time matching
		// can steal another process's otherwise-identical session.
		const listTitleMatches = async () =>
			(
				await this.listWithToken(
					input.organizationId ?? undefined,
					creationAuth,
					true,
				)
			).filter(
				(session) =>
					session.title === recoveryTitle &&
					session.repoContext.repoUrl === input.repoUrl &&
					session.metadata.modelId === input.modelId &&
					(!requestedBranch || session.repoContext.branch === requestedBranch),
			);
		const removeTerminalRecoveredSession = async (
			recovered: CloudSessionRecord,
			error: CloudSessionError,
		): Promise<never> => {
			try {
				await this.deleteWithAuth(recovered.id, creationAuth);
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
						"The recovered cloud workspace is unusable and could not be cleaned up.",
					);
				}
			}
			await input.handoff?.onOuterSessionRemoved?.(recovered.id);
			throw error;
		};
		const adoptExisting = async (recovered: CloudSessionRecord) => {
			const recoveredStatus = recovered.status.trim().toLowerCase();
			if (recoveredStatus === "failed" || isExpiredRecord(recovered)) {
				return await removeTerminalRecoveredSession(
					recovered,
					new CloudSessionError(
						recoveredStatus === "failed" ? "session_failed" : "session_expired",
						recovered.metadata.statusReason?.trim() ||
							"The recovered cloud workspace is no longer usable.",
					),
				);
			}
			await this.persistHandoffOuterSession(
				input,
				recovered.id,
				creationAuth,
				false,
			);
			if (recoveredStatus === "provisioning" || !recovered.sandboxUrl?.trim()) {
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
				} catch (error) {
					if (
						error instanceof CloudSessionError &&
						(error.code === "session_failed" ||
							error.code === "session_expired" ||
							error.code === "session_not_found")
					) {
						return await removeTerminalRecoveredSession(recovered, error);
					}
					throw error;
				} finally {
					clearTimeout(recoveryTimeout);
				}
			}
			return {
				sessionId: recovered.id,
				status: recovered.status,
				sandboxUrl: recovered.sandboxUrl,
				cleanupAuthToken: creationAuth.token,
			};
		};
		// A retry after an ambiguous failure can arrive before the accepted
		// POST's row became visible: the failure-path re-lists saw nothing, the
		// user retried, and a second POST would provision a duplicate workspace.
		// Handoffs stamp a STABLE request id, so a title-matched row seen before
		// the POST always belongs to this logical create — adopt it instead.
		if (input.requestId?.trim() && input.handoff) {
			let probed: CloudSessionRecord[] | undefined;
			try {
				probed = await listTitleMatches();
			} catch {
				throw new CloudSessionError(
					"request_failed",
					"Cloud session creation could not be safely retried because the previous result is still unconfirmed. Check your cloud session list before trying again.",
				);
			}
			if (probed && probed.length > 1) {
				throw new CloudSessionError(
					"request_failed",
					"Cloud session creation had an ambiguous result. Check your cloud session list before trying again.",
				);
			}
			const preexisting = probed?.[0];
			if (preexisting) return await adoptExisting(preexisting);
		}
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
			await this.persistHandoffOuterSession(input, sessionId, creationAuth);
			return {
				sessionId,
				status: created.status?.trim() || "provisioning",
				sandboxUrl: created.sandboxUrl?.trim() ?? "",
				cleanupAuthToken: creationAuth.token,
			};
		} catch (error) {
			if (createdSessionId) {
				if (
					error instanceof CloudSessionError &&
					(error.code === "session_failed" ||
						error.code === "session_expired" ||
						error.code === "session_not_found")
				) {
					if (error.code === "session_failed") {
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
					await input.handoff?.onOuterSessionRemoved?.(createdSessionId);
				}
				throw error;
			}
			// Recover only failures that may have followed an accepted POST.
			// Provisioning may outlive the synchronous request only when the
			// POST timed out or the server failed after possibly accepting it
			// (5xx / no HTTP status). A fast client-side rejection (4xx) never
			// provisioned anything, and recovering on one risks silently
			// adopting an identical-config session created by another device
			// on the same account. A raw transport rejection (fetch throwing
			// before an HTTP status exists) is just as ambiguous as a 5xx: the
			// request may have reached the server before the connection died.
			const mayStillBeProvisioning =
				controller.signal.aborted ||
				!(error instanceof CloudSessionError) ||
				(error instanceof CloudSessionError &&
					error.code === "request_failed" &&
					(error.status === undefined || error.status >= 500));
			if (mayStillBeProvisioning) {
				// Recovery must observe the same identity/scope that issued the
				// create — the active account can change mid-provision. A failed
				// list is NOT an empty list: treating it as empty would blind
				// the ambiguity guard and let a retry provision a duplicate.
				let recoveryListFailed = false;
				// The list is eventually consistent with creates: an accepted
				// POST may not be visible yet. For seed-destructive handoffs,
				// re-list briefly before concluding nothing was created.
				let candidates: CloudSessionRecord[] = [];
				for (let attempt = 0; attempt < (input.handoff ? 3 : 1); attempt += 1) {
					if (attempt > 0) {
						await (
							this.options.sleep ??
							((ms: number) =>
								new Promise<void>((resolve) => setTimeout(resolve, ms)))
						)(2_500);
					}
					try {
						candidates = await listTitleMatches();
						recoveryListFailed = false;
						if (candidates.length > 0 || !input.handoff) break;
					} catch {
						recoveryListFailed = true;
					}
				}
				if (input.handoff && recoveryListFailed) {
					throw new CloudSessionError(
						"request_failed",
						"Cloud session creation had an ambiguous result and the session list could not be checked. Verify in Cline Cloud whether the workspace was created before retrying.",
						new URL("/agents", this.appBaseUrl).toString(),
					);
				}
				if (candidates.length > 1) {
					throw new CloudSessionError(
						"request_failed",
						"Cloud session creation had an ambiguous result. Check your cloud session list before trying again.",
					);
				}
				const recovered = candidates[0];
				if (recovered) {
					if (input.handoff) return await adoptExisting(recovered);
					return {
						sessionId: recovered.id,
						status: recovered.status,
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

	async waitUntilReady(
		sessionId: string,
		signal: AbortSignal,
		onStatusOrAuth?:
			| ((status: { phase?: CloudProvisioningPhase }) => void)
			| RequestAuth,
		auth?: RequestAuth,
	): Promise<void> {
		signal = AbortSignal.any([
			signal,
			AbortSignal.timeout(this.createTimeoutMs),
		]);
		const onStatus =
			typeof onStatusOrAuth === "function" ? onStatusOrAuth : undefined;
		const providedAuth =
			typeof onStatusOrAuth === "function" ? auth : onStatusOrAuth;
		const token = providedAuth ? undefined : await this.options.getAuthToken();
		const authToken =
			providedAuth ??
			(token ? { token, subject: authSubject(token) } : undefined);
		while (!signal.aborted) {
			let result:
				| {
						sessionId?: string;
						status?: string;
						phase?: CloudProvisioningPhase;
						statusReason?: string;
				  }
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
			onStatus?.({ phase: parseCloudProvisioningPhase(result?.phase) });
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

	private async persistHandoffOuterSession(
		input: CreateCloudSessionInput,
		sessionId: string,
		auth: CreationAuth,
		deleteOnFailure = true,
	): Promise<void> {
		const persist = input.handoff?.onOuterSessionCreated;
		if (!persist) return;
		try {
			await persist(sessionId);
		} catch (persistenceError) {
			if (!deleteOnFailure) throw persistenceError;
			try {
				await this.deleteWithAuth(sessionId, auth);
			} catch (cleanupError) {
				if (
					!(
						cleanupError instanceof CloudSessionError &&
						(cleanupError.code === "session_not_found" ||
							cleanupError.code === "session_expired")
					)
				) {
					const dashboardUrl = buildCloudHandoffDashboardUrl(
						this.appBaseUrl,
						sessionId,
					);
					throw new AggregateError(
						[persistenceError, cleanupError],
						`The cloud session was created, but its local recovery record could not be saved or cleaned up. Cloud session ${sessionId}: ${dashboardUrl}`,
					);
				}
			}
			throw persistenceError;
		}
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
		if (payload?.version !== 1 || !Array.isArray(payload.messages)) {
			throw new CloudSessionError(
				"request_failed",
				"Invalid archived session history",
			);
		}
		return payload.messages;
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
	reconnectResolution?: Promise<void>;
	rehydrationPromise?: Promise<CloudRehydrationSnapshot>;
	rehydrationRerunRequested?: boolean;
	bufferingEvents?: boolean;
	bufferedEvents: HubEventEnvelope[];
	bufferedEventsDropped: number;
	transcriptKnown: boolean;
	seenEventIds: Set<string>;
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

function recordToLiveSession(record: CloudSessionRecord): LiveSession {
	const cwd = cloudSessionCwd(record);
	return {
		config: {
			executionTarget: "cloud",
			provider: "cline",
			providerId: "cline",
			model: record.metadata.modelId ?? "",
			modelId: record.metadata.modelId ?? "",
			repoUrl: record.repoContext.repoUrl ?? "",
			branch: record.repoContext.branch ?? "",
			cwd,
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
	const cwd = cloudSessionCwd(record);
	return {
		sessionId: record.id,
		origin: "cloud",
		executionTarget: "cloud",
		status,
		provider: "cline",
		model: record.metadata.modelId ?? "",
		repoUrl: record.repoContext.repoUrl ?? "",
		branch: record.repoContext.branch ?? "",
		cwd,
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
	const cwd = cloudSessionCwd(record);
	return {
		sessionId: record.id,
		environmentId: LOCAL_ENVIRONMENT_ID,
		origin: "cloud",
		executionTarget: "cloud",
		status: record.status,
		provider: "cline",
		model: record.metadata.modelId ?? "",
		cwd,
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

function sessionRowCwd(record: JsonRecord | undefined): string | undefined {
	const cwd = record?.cwd;
	return typeof cwd === "string" &&
		(cwd === CLOUD_WORKSPACE_ROOT || cwd.startsWith(`${CLOUD_WORKSPACE_ROOT}/`))
		? cwd
		: undefined;
}

function sessionRowHandoffSourceSessionId(
	record: JsonRecord | undefined,
): string {
	const metadata =
		record?.metadata && typeof record.metadata === "object"
			? (record.metadata as JsonRecord)
			: undefined;
	const handoff =
		metadata?.handoff && typeof metadata.handoff === "object"
			? (metadata.handoff as JsonRecord)
			: undefined;
	return String(handoff?.sourceSessionId ?? "").trim();
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
export class CloudSessionManager {
	private disposed = false;
	private readonly connections = new Map<string, CloudConnection>();
	private readonly connectionPromises = new Map<
		string,
		Promise<CloudConnection>
	>();
	private readonly knownSessions = new Map<string, CloudSessionRecord>();
	// Retain new sessions until discovery has observed them at least once.
	private readonly unlistedSessions = new Map<string, CloudSessionRecord>();
	private readonly pendingInitialTasks = new Set<string>();
	private lastListedSessions: CloudSessionRecord[] = [];
	private discoveryRefresh?: Promise<CloudSessionRecord[]>;
	private readonly createRequests = new Map<string, Promise<JsonRecord>>();
	private readonly provisioningControllers = new Map<string, AbortController>();
	private readonly sendAbortTokens = new Map<string, symbol>();
	private readonly titleWrites = new Map<string, Promise<void>>();
	// Never repeat a seeded create whose request may still complete server-side.
	private readonly unconfirmedInnerCreates = new Map<string, string>();
	private readonly deletingSessions = new Set<string>();
	private readonly createHubClient: NonNullable<
		CloudSessionManagerOptions["createHubClient"]
	>;

	constructor(
		private readonly ctx: SidecarContext,
		private readonly options: CloudSessionManagerOptions,
	) {
		this.ctx = getEnvironmentContext(ctx, "local");
		this.createHubClient =
			options.createHubClient ??
			((clientOptions) => new NodeHubClient(clientOptions));
	}

	isCloudSession(sessionId: string): boolean {
		return (
			isCloudOuterSessionId(sessionId) ||
			this.knownSessions.has(sessionId) ||
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
				return undefined;
			}
			// A scope/auth/network failure cannot prove the cached session is gone.
			return cached;
		}
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
		// Retain other scopes for routing; only lastListedSessions drives the sidebar.
		for (const session of scoped) {
			this.knownSessions.set(session.id, session);
			const live = this.ctx.liveSessions.get(session.id);
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
		return scoped;
	}

	/**
	 * Checks whether an exact handoff target still exists without waiting for
	 * provisioning. Only an authoritative gone response is treated as absent;
	 * auth, network, and server failures remain errors so callers preserve the
	 * local recovery record.
	 */
	async handoffTargetExists(sessionId: string): Promise<boolean> {
		try {
			await this.options.api.status(sessionId);
			return true;
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				(error.code === "session_not_found" || error.code === "session_expired")
			) {
				return false;
			}
			throw error;
		}
	}

	private preserveConnectedRuntimeModel(
		session: CloudSessionRecord,
	): CloudSessionRecord {
		const runtimeMetadata = this.connections.get(session.id)?.remote.metadata;
		const runtimeModel = runtimeMetadata?.modelId?.trim();
		const runtimeCwd = runtimeMetadata?.cwd?.trim();
		if (!runtimeModel && !runtimeCwd) {
			return session;
		}
		return {
			...session,
			metadata: {
				...session.metadata,
				...(runtimeModel ? { modelId: runtimeModel } : {}),
				...(runtimeCwd ? { cwd: runtimeCwd } : {}),
			},
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

	/** Validates account auth and GitHub access before provisioning a handoff. */
	async prepareHandoffRepository(repoUrl: string): Promise<{
		organizationId?: string;
	}> {
		const organizationId = await this.resolveActiveOrganizationId();
		const listed = await this.options.api.listRepositories(organizationId);
		if (!listed.connected) {
			throw new CloudSessionError(
				"github_not_connected",
				"Connect GitHub before handing this session off to cloud.",
				listed.connectUrl,
			);
		}
		const normalize = (value: string) =>
			value
				.trim()
				.replace(/\.git$/i, "")
				.replace(/\/+$/, "")
				.toLowerCase();
		if (
			!listed.repositories.some(
				(repository) => normalize(repository.url) === normalize(repoUrl),
			)
		) {
			throw new CloudSessionError(
				"github_not_connected",
				`The GitHub integration cannot access ${cloudRepositoryLabel(repoUrl, repoUrl)}. Grant repository access before handing off.`,
				listed.connectUrl,
			);
		}
		return organizationId ? { organizationId } : {};
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

		const recordsById = new Map(
			[...this.unlistedSessions.values(), ...records].map((record) => [
				record.id,
				record,
			]),
		);
		const listed = [...recordsById.values()].map((record) => {
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
		return listed;
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

	/** Waits for an adopted pending handoff target before opening its Hub proxy. */
	async waitUntilReady(outerSessionId: string): Promise<void> {
		await this.options.api.waitUntilReady(
			outerSessionId,
			AbortSignal.timeout(CREATE_TIMEOUT_MS),
		);
		await this.refreshKnownSession(outerSessionId);
	}

	/** Seeds an already-provisioned outer session when retrying a pending handoff. */
	async seedHandoff(
		outerSessionId: string,
		seed: CloudHandoffSeed,
	): Promise<{ innerSessionId: string }> {
		const connection = await this.ensureConnection(outerSessionId, {
			createInner: true,
			handoffSeed: seed,
		});
		if (!connection.innerSessionId) {
			throw new Error("Cloud Hub did not return an inner session id");
		}
		return { innerSessionId: connection.innerSessionId };
	}

	async verifyHandoffTranscript(
		outerSessionId: string,
		expected: readonly MessageWithMetadata[],
		options: { allowAppendedMessages?: boolean } = {},
	): Promise<void> {
		const connection = await this.ensureConnection(outerSessionId);
		const innerSessionId = connection.innerSessionId;
		if (!innerSessionId) {
			throw new Error("Cloud Hub did not return an inner session id");
		}
		const reply = await connection.client.command(
			"session.messages",
			{ sessionId: innerSessionId },
			innerSessionId,
		);
		const actual = reply.payload?.messages;
		if (!Array.isArray(actual)) {
			throw new Error("Cloud runtime returned no transcript after seeding.");
		}
		if (expected.length > 0 && actual.length === 0) {
			throw new CloudHandoffSeedUnsupportedError();
		}
		const verified = options.allowAppendedMessages
			? actual.length >= expected.length &&
				cloudHandoffTranscriptsEqual(expected, actual.slice(0, expected.length))
			: cloudHandoffTranscriptsEqual(expected, actual);
		if (!verified) {
			throw new CloudHandoffTranscriptMismatchError(
				expected.length,
				actual.length,
			);
		}
		connection.transcriptKnown = true;
		// Baseline the live transcript with the verified seed: a later send's
		// ambiguity recovery counts prompt occurrences against this baseline,
		// and an empty baseline would let an older identical prompt in the
		// seeded history falsely confirm a new, undelivered follow-up.
		const live = this.ctx.liveSessions.get(outerSessionId);
		if (live) {
			live.messages = [...actual];
		}
	}

	private async createOnce(
		input: CreateCloudSessionInput,
	): Promise<JsonRecord> {
		if (this.disposed) throw new Error("Cloud session manager was disposed");
		const organizationId =
			input.organizationId === undefined
				? await this.resolveActiveOrganizationId({ fresh: true })
				: (input.organizationId ?? undefined);
		const created = await this.options.api.create({ ...input, organizationId });
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
				input.handoff?.onOuterSessionRemoved,
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
			metadata: {
				modelId: input.modelId,
				cwd: cloudWorkspaceCwd(input.workspaceRelativePath),
			},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		this.knownSessions.set(record.id, record);
		this.unlistedSessions.set(record.id, record);
		this.pendingInitialTasks.add(record.id);
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
		const handoffSeed = input.handoff
			? {
					sourceSessionId: input.handoff.sourceSessionId,
					messages: await input.handoff.resolveMessages(),
					mode: input.mode ?? "act",
					workspaceRelativePath: input.workspaceRelativePath,
					config: {
						...(typeof input.autoApproveTools === "boolean"
							? { autoApproveTools: input.autoApproveTools }
							: {}),
						...(typeof input.thinking === "boolean"
							? { thinking: input.thinking }
							: {}),
						...(input.reasoningEffort
							? { reasoningEffort: input.reasoningEffort }
							: {}),
					},
					onSeeding: input.handoff.onSeeding,
				}
			: undefined;
		// A handoff must seed durably before it can report success.
		if (handoffSeed) {
			await this.ensureConnection(record.id, {
				createInner: true,
				handoffSeed,
			});
		}
		if (this.disposed) {
			await this.deleteProvisionedSessionAfterDispose(
				record.id,
				created.cleanupAuthToken,
				input.handoff?.onOuterSessionRemoved,
			);
			throw new Error(
				"Cline account changed while the cloud session was starting",
			);
		}
		sendEvent(this.ctx, "chat_session_status", {
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
			cwd: cloudWorkspaceCwd(input.workspaceRelativePath),
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			...(live.prompt ? { prompt: live.prompt } : {}),
			...(this.connections.get(record.id)?.innerSessionId
				? { innerSessionId: this.connections.get(record.id)?.innerSessionId }
				: {}),
		};
	}

	private async deleteProvisionedSessionAfterDispose(
		outerSessionId: string,
		authToken?: string,
		onOuterSessionRemoved?: (sessionId: string) => Promise<void>,
	): Promise<void> {
		this.knownSessions.delete(outerSessionId);
		this.unlistedSessions.delete(outerSessionId);
		this.ctx.liveSessions.delete(outerSessionId);
		let removed = false;
		try {
			await this.options.api.delete(outerSessionId, authToken);
			removed = true;
		} catch (error) {
			removed =
				error instanceof CloudSessionError &&
				(error.code === "session_not_found" ||
					error.code === "session_expired");
			if (!removed) {
				this.ctx.logger?.log(
					"Failed to clean up a cloud session created during an account change",
					{ sessionId: outerSessionId, error },
				);
			}
		}
		if (removed) {
			await onOuterSessionRemoved?.(outerSessionId);
		}
	}

	async attach(outerSessionId: string): Promise<JsonRecord> {
		const known = await this.ensureKnownSession(outerSessionId);
		if (known.status === "provisioning" || known.status === "failed") {
			return attachResultPayload(
				known,
				known.status,
				this.ctx.liveSessions.get(outerSessionId)?.prompt,
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
			const statusChanged = live.status !== "running";
			live.status = "running";
			live.prompt ||= prompt;
			if (statusChanged) {
				sendEvent(this.ctx, "chat_session_status", {
					sessionId: outerSessionId,
					status: "running",
				});
			}
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
					// The original failure left a queue delivery's outcome
					// unknown, and the recovery check itself failed — the
					// outcome is STILL unknown. Surfacing the raw recovery
					// error would be read as "not queued" and invite a
					// duplicate resubmission.
					if (delivery === "queue") {
						throw new CloudQueueUnconfirmedError();
					}
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
			const live = this.ctx.liveSessions.get(outerSessionId);
			const baselineMessages = live?.messages ?? [];
			const runtimeStatus = String(
				session?.status ?? live?.status ?? "running",
			).trim();
			const status = runtimeStatus === "pending" ? "running" : runtimeStatus;

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
				live.messages = messages;
				live.status = status;
				live.busy = status === "running";
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
			const displayMessages = await readSessionMessages(
				this.ctx,
				outerSessionId,
				800,
				messages,
			);
			this.assertSessionActive(outerSessionId, connection);
			sendEvent(this.ctx, "cloud_session_rehydrated", {
				sessionId: outerSessionId,
				status,
				transcriptKnown: true,
				messages: displayMessages,
			});
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
		this.sendAbortTokens.set(outerSessionId, Symbol());
		const provisioning = this.provisioningControllers.get(outerSessionId);
		if (provisioning) {
			provisioning.abort(new Error("Cloud session prompt cancelled"));
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
		const live = this.ctx.liveSessions.get(outerSessionId);
		if (live) {
			live.busy = false;
			live.status = "aborted";
		}
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
	): PromptInQueue[] {
		// A missing prompts array is invalid, not an empty queue.
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
			const live = this.ctx.liveSessions.get(outerSessionId);
			if (live) {
				live.title = title;
			}
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
		this.provisioningControllers.get(outerSessionId)?.abort();
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
			this.unconfirmedInnerCreates.delete(outerSessionId);
			this.unlistedSessions.delete(outerSessionId);
			this.pendingInitialTasks.delete(outerSessionId);
			this.ctx.liveSessions.delete(outerSessionId);
			this.sendAbortTokens.delete(outerSessionId);
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
		this.sendAbortTokens.clear();
		for (const controller of this.provisioningControllers.values())
			controller.abort();
		const sessionIds = new Set([
			...this.connections.keys(),
			...this.knownSessions.keys(),
		]);
		// Clear shared state before awaiting teardown; a replacement manager
		// may populate it while this one is disposing.
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
		this.unconfirmedInnerCreates.clear();
		this.unlistedSessions.clear();
		this.pendingInitialTasks.clear();
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
		return record;
	}

	private assertSessionActive(
		outerSessionId: string,
		connection?: CloudConnection,
	): void {
		if (this.disposed || connection?.disposed) {
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
		options: { createInner?: boolean; handoffSeed?: CloudHandoffSeed } = {},
	): Promise<CloudConnection> {
		this.assertSessionActive(outerSessionId);
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
				await this.resolveInnerSession(
					outerSessionId,
					existing,
					Boolean(options.handoffSeed),
				);
				this.assertSessionActive(outerSessionId, existing);
			}
			if (options.handoffSeed && existing.innerSessionId) {
				await this.assertHandoffConnectionReusable(
					existing,
					options.handoffSeed,
				);
			}
			if (options.createInner && !existing.innerSessionId) {
				await this.createInnerSession(existing, options.handoffSeed);
			}
			this.assertSessionActive(outerSessionId, existing);
			return existing;
		}

		const connecting = (async () => {
			let remote = await this.ensureKnownSession(outerSessionId);
			this.assertSessionActive(outerSessionId);
			if (remote.status === "provisioning") {
				const controller = new AbortController();
				this.provisioningControllers.set(outerSessionId, controller);
				try {
					await this.options.api.waitUntilReady(
						outerSessionId,
						controller.signal,
						({ phase }) => {
							remote.metadata.provisioningPhase = phase;
							sendEvent(this.ctx, "chat_session_status", {
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
					const live = this.ctx.liveSessions.get(outerSessionId);
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
						const live = this.ctx.liveSessions.get(outerSessionId);
						if (live) live.status = "error";
						sendEvent(this.ctx, "chat_session_status", {
							sessionId: outerSessionId,
							status: "error",
						});
					}
					throw error;
				} finally {
					this.provisioningControllers.delete(outerSessionId);
				}
			}
			this.assertSessionActive(outerSessionId);
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
			this.ctx.liveSessions.set(
				outerSessionId,
				this.ctx.liveSessions.get(outerSessionId) ??
					recordToLiveSession(remote),
			);
			let connection: CloudConnection | undefined;
			let socketAttempt = 0;
			const client = this.createHubClient({
				url: toWebSocketUrl(this.options.apiBaseUrl, outerSessionId),
				// Unique client IDs prevent one viewer's close from unregistering another.
				clientId: `code-cloud-${outerSessionId}-${randomUUID()}`,
				clientType: "code-cloud-sidecar",
				displayName: "Cline cloud session",
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd: CLOUD_WORKSPACE_ROOT,
				resolveConnectionHeaders: async () => {
					const reconnecting = socketAttempt > 0;
					socketAttempt += 1;
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
					return { Authorization: `Bearer ${token.trim()}` };
				},
			});
			connection = {
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
				this.assertSessionActive(outerSessionId, connection);
				await this.resolveInnerSession(
					outerSessionId,
					connection,
					Boolean(options.handoffSeed),
				);
				this.assertSessionActive(outerSessionId, connection);
				if (options.handoffSeed && connection.innerSessionId) {
					await this.assertHandoffConnectionReusable(
						connection,
						options.handoffSeed,
					);
				}
				if (options.createInner && !connection.innerSessionId) {
					await this.createInnerSession(connection, options.handoffSeed);
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
				this.connections.delete(outerSessionId);
				connection.disposed = true;
				connection.unsubscribe();
				// Approvals stored during the failed setup hold resolve closures
				// over this dead connection. A disposed manager already cleared
				// its state; a replacement may now own the shared approval entries.
				if (!this.disposed) {
					this.clearPendingApprovals(outerSessionId);
				}
				await client.dispose().catch(() => undefined);
				throw error;
			}
		})().finally(() => {
			this.connectionPromises.delete(outerSessionId);
		});
		this.connectionPromises.set(outerSessionId, connecting);
		return await connecting;
	}

	private async resolveInnerSession(
		outerSessionId: string,
		connection: CloudConnection,
		allowMissing = false,
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
			if (!allowMissing && !this.pendingInitialTasks.has(outerSessionId)) {
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

	private async assertHandoffConnectionReusable(
		connection: CloudConnection,
		handoffSeed: CloudHandoffSeed,
	): Promise<void> {
		const listed = await connection.client.command("session.list", {
			limit: 100,
		});
		const rows = readSessionRows(listed.payload);
		const [only] = rows;
		if (
			rows.length !== 1 ||
			String(only?.sessionId ?? "").trim() !== connection.innerSessionId ||
			sessionRowHandoffSourceSessionId(only) !== handoffSeed.sourceSessionId
		) {
			throw new CloudSessionError(
				"request_failed",
				"This cloud workspace already contains another conversation. Open it in Cline Cloud or delete it before retrying the handoff.",
			);
		}
	}

	private async createInnerSession(
		connection: CloudConnection,
		handoffSeed?: CloudHandoffSeed,
	): Promise<void> {
		this.assertSessionActive(connection.remote.id, connection);
		if (connection.innerSessionId) {
			return;
		}
		if (connection.innerSessionCreation) {
			await connection.innerSessionCreation;
			// A seeded creation must never silently adopt a session created by
			// a concurrent seedless caller: the transcript would fail
			// verification later and destroy a workspace that may hold a
			// conversation. Validate the joined session against this seed.
			if (handoffSeed) {
				await this.assertHandoffConnectionReusable(connection, handoffSeed);
			}
			return;
		}
		const creation = (async () => {
			if (
				handoffSeed &&
				(await this.adoptExistingHandoffSession(connection, handoffSeed))
			) {
				this.unconfirmedInnerCreates.delete(connection.remote.id);
				return;
			}
			if (this.unconfirmedInnerCreates.has(connection.remote.id)) {
				throw new CloudSessionError(
					"request_failed",
					"Cloud conversation creation is still unconfirmed. Wait for it to appear before trying again.",
				);
			}
			await this.createInnerSessionOnce(connection, handoffSeed);
		})().finally(() => {
			connection.innerSessionCreation = undefined;
		});
		connection.innerSessionCreation = creation;
		return await creation;
	}

	private async adoptExistingHandoffSession(
		connection: CloudConnection,
		handoffSeed: CloudHandoffSeed,
	): Promise<boolean> {
		const listed = await connection.client.command("session.list", {
			limit: 100,
		});
		const rows = readSessionRows(listed.payload);
		if (rows.length === 0) return false;
		const [only] = rows;
		const innerSessionId = String(only?.sessionId ?? "").trim();
		if (
			rows.length !== 1 ||
			!innerSessionId ||
			sessionRowHandoffSourceSessionId(only) !== handoffSeed.sourceSessionId
		) {
			throw new CloudSessionError(
				"request_failed",
				"This cloud workspace already contains another conversation. Open it in Cline Cloud or delete it before retrying the handoff.",
			);
		}
		connection.innerSessionId = innerSessionId;
		this.subscribeToInnerSession(connection.remote.id, connection);
		this.applySessionModel(connection, only);
		await this.ensureAttached(connection);
		return true;
	}

	private async createInnerSessionOnce(
		connection: CloudConnection,
		handoffSeed?: CloudHandoffSeed,
	): Promise<void> {
		const modelId = connection.remote.metadata.modelId?.trim();
		if (!modelId) {
			throw new Error("Cloud session is missing its model id");
		}
		const live = this.ctx.liveSessions.get(connection.remote.id);
		const cwd = cloudWorkspaceCwd(handoffSeed?.workspaceRelativePath);
		const mode = handoffSeed?.mode ?? "act";
		handoffSeed?.onSeeding?.();
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
		const pendingReply = connection.client.command("session.create", {
			workspaceRoot: CLOUD_WORKSPACE_ROOT,
			cwd,
			...(handoffSeed ? { initialMessages: handoffSeed.messages } : {}),
			sessionConfig: {
				...(connection.remote.metadata.taskId?.trim()
					? { sessionId: connection.remote.metadata.taskId.trim() }
					: {}),
				providerId: "cline",
				modelId,
				workspaceRoot: CLOUD_WORKSPACE_ROOT,
				cwd,
				systemPrompt: handoffSeed
					? `${buildCloudHandoffSystemPrompt({
							repoUrl:
								connection.remote.repoContext.repoUrl ?? "the repository",
							branch:
								connection.remote.repoContext.branch ?? "the selected branch",
							workspaceRoot: CLOUD_WORKSPACE_ROOT,
						})}${cwd === CLOUD_WORKSPACE_ROOT ? "" : `\n\nContinue from the original repository subdirectory at ${cwd}.`}`
					: systemPrompt,
				mode,
				enableTools: true,
				...(typeof (handoffSeed?.config?.thinking ?? live?.config.thinking) ===
				"boolean"
					? { thinking: handoffSeed?.config?.thinking ?? live?.config.thinking }
					: {}),
				...(typeof (
					handoffSeed?.config?.reasoningEffort ?? live?.config.reasoningEffort
				) === "string"
					? {
							reasoningEffort:
								handoffSeed?.config?.reasoningEffort ??
								live?.config.reasoningEffort,
						}
					: {}),
			},
			metadata: {
				source: "desktop",
				provider: "cline",
				model: modelId,
				interactive: true,
				...(handoffSeed
					? {
							handoff: {
								from: "local",
								sourceSessionId: handoffSeed.sourceSessionId,
								outerSessionId: connection.remote.id,
							},
						}
					: {}),
			},
			runtimeOptions: { mode },
			modelSelection: { provider: "cline", model: modelId },
			toolPolicies: {
				"*": {
					autoApprove:
						(handoffSeed?.config?.autoApproveTools ??
							live?.config.autoApproveTools) !== false,
				},
			},
		});
		let reply: Awaited<typeof pendingReply>;
		try {
			reply = await pendingReply;
		} catch (error) {
			if (
				handoffSeed &&
				(isHubCommandTimeoutError(error, "session.create") ||
					isHubReconnectableTransportError(error))
			) {
				this.unconfirmedInnerCreates.set(
					connection.remote.id,
					handoffSeed.sourceSessionId,
				);
			}
			throw error;
		}
		this.assertSessionActive(connection.remote.id, connection);
		const session =
			reply.payload?.session && typeof reply.payload.session === "object"
				? (reply.payload.session as JsonRecord)
				: undefined;
		const innerSessionId = String(
			session?.sessionId ?? reply.payload?.sessionId ?? "",
		).trim();
		if (!innerSessionId) {
			if (handoffSeed) {
				this.unconfirmedInnerCreates.set(
					connection.remote.id,
					handoffSeed.sourceSessionId,
				);
			}
			throw new Error("Cloud Hub did not return an inner session id");
		}
		this.unconfirmedInnerCreates.delete(connection.remote.id);
		connection.innerSessionId = innerSessionId;
		this.subscribeToInnerSession(connection.remote.id, connection);
		this.pendingInitialTasks.delete(connection.remote.id);
		this.applySessionModel(connection, session);
		// Seeded content is authoritative only after a strict session.messages
		// read-back verifies that the pod persisted initialMessages.
		connection.transcriptKnown = !handoffSeed;
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
		// Remote approvals outlive webview connections and have no local owner.
		this.ctx.pendingApprovals.set(requestId, {
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
		this.ctx.pendingApprovals.delete(`${outerSessionId}:${approvalId}`);
		this.sendApprovalSnapshot(outerSessionId);
	}

	private clearPendingApprovals(outerSessionId: string): void {
		for (const [requestId, pending] of this.ctx.pendingApprovals) {
			if (pending.item.sessionId === outerSessionId) {
				this.ctx.pendingApprovals.delete(requestId);
			}
		}
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
		const cwd = sessionRowCwd(session as JsonRecord);
		if (cwd) {
			connection.remote.metadata.cwd = cwd;
			const live = this.ctx.liveSessions.get(connection.remote.id);
			if (live) live.config.cwd = cwd;
		}
	}

	private async disposeConnection(outerSessionId: string): Promise<void> {
		const connection = this.connections.get(outerSessionId);
		this.connections.delete(outerSessionId);
		if (!connection) {
			return;
		}
		connection.disposed = true;
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
			const live = this.ctx.liveSessions.get(outerSessionId);
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

export function getCloudSessionManager(
	ctx: SidecarContext,
): CloudSessionManager {
	ctx = getSidecarContextOwner(ctx);
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
		if (!(await getAuthToken())?.trim()) {
			return undefined;
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
	ctx = getSidecarContextOwner(ctx);
	const manager = ctx.cloudSessionManager;
	ctx.cloudSessionManager = null;
	await manager?.dispose();
}
