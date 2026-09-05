import { randomUUID } from "node:crypto";
import { decodeJwtPayload } from "@cline/shared";
import type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
} from "../webview/lib/cloud-repositories";

const CREATE_TIMEOUT_MS = 610_000;
const PROVISIONING_POLL_MS = 3_000;
// Bound hot-path REST calls so a dead network cannot hang the sidebar.
const REQUEST_TIMEOUT_MS = 15_000;
const CLOUD_ERROR_PREFIX = "CLOUD_SESSION_ERROR:";
const CREATE_REQUEST_TITLE_PREFIX = "__cline_create_request__:";

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
