import { randomUUID } from "node:crypto";
import {
	type AgentMode,
	decodeJwtPayload,
	type MessageWithMetadata,
} from "@cline/shared";
import type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
} from "./repositories";

const CREATE_TIMEOUT_MS = 610_000;
const PROVISIONING_POLL_MS = 3_000;
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
	mode?: AgentMode;
	workspaceRelativePath?: string;
	/** Null explicitly selects Personal; controllers resolve an omitted scope. */
	organizationId?: string | null;
	/** Host persistence hooks; never serialized into the provisioning request. */
	handoff?: {
		sourceSessionId: string;
		resolveMessages: () => Promise<MessageWithMetadata[]>;
		/** Persist dispatch intent after successful recovery lookup, before POST. */
		onCreating: () => void | Promise<void>;
		onOuterSessionCreated: (
			sessionId: string,
			context?: { created: boolean },
		) => Promise<void>;
		onOuterSessionRemoved?: (sessionId: string) => Promise<void>;
		onSeeding?: () => void | Promise<void>;
	};
};

export type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
	CloudRepositoryOption,
} from "./repositories";

export type CloudSessionApiOptions = {
	apiBaseUrl: string;
	appBaseUrl: string;
	getAuthToken: () => Promise<string | undefined>;
	fetch?: FetchLike;
	createTimeoutMs?: number;
};

export type CloudErrorCode =
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

/** The fresh handoff POST definitely did not create a workspace. Marker/list
 * failures and ambiguous transport outcomes deliberately never use this type. */
export class CloudHandoffCreationRejectedError extends Error {
	constructor(cause: unknown) {
		super(
			cause instanceof Error
				? cause.message
				: "Cloud handoff creation was rejected.",
			{ cause },
		);
		this.name = "CloudHandoffCreationRejectedError";
	}
}

type ApiResponse<T> = {
	success?: boolean;
	data?: T;
	error?: string;
};

function trimTrailingSlash(value: string): string {
	let end = value.length;
	while (end > 0 && value[end - 1] === "/") end--;
	return value.slice(0, end);
}

function createRequestTitle(requestId: string): string {
	return `${CREATE_REQUEST_TITLE_PREFIX}${requestId}`.slice(0, 255);
}

function isCreateRequestTitle(title: string | undefined): boolean {
	return title?.startsWith(CREATE_REQUEST_TITLE_PREFIX) === true;
}

export function parseCloudProvisioningPhase(
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
	private readonly unconfirmedHandoffCreates = new Set<string>();
	private readonly completedHandoffCreates = new Map<
		string,
		{
			sessionId: string;
			status: string;
			sandboxUrl: string;
			cleanupAuthToken: string;
		}
	>();
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
		onDispatch?: () => void,
	): Promise<T> {
		let refreshed = false;
		let rejectedToken: string | undefined;
		while (true) {
			let token: string | undefined;
			try {
				token =
					typeof auth === "string" ? auth : await this.options.getAuthToken();
			} catch (error) {
				if (rejectedToken)
					throw cloudErrorForResponse(
						401,
						undefined,
						this.appBaseUrl,
						githubConnectUrl,
					);
				throw error;
			}
			if (!token?.trim()) {
				throw new CloudSessionError(
					"authentication_required",
					"Sign in to Cline before starting a cloud session.",
				);
			}
			if (token.trim() === rejectedToken)
				throw new CloudSessionError(
					"authentication_required",
					"The cloud session credential was rejected. Sign in again.",
				);
			if (typeof auth === "object") {
				// Creation and recovery stay bound to the original account, while
				// consulting the host's current eligibility gate on every attempt.
				if (
					auth.subject
						? authSubject(token.trim()) !== auth.subject
						: token.trim() !== auth.token
				) {
					throw new CloudSessionError(
						"authentication_required",
						"The signed-in account changed during cloud session creation.",
					);
				}
				auth.token = token.trim();
			}
			onDispatch?.();
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
					auth.subject
				) {
					refreshed = true;
					rejectedToken = token.trim();
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
		if (input.handoff && typeof input.handoff.onCreating !== "function")
			throw new CloudSessionError(
				"request_failed",
				"Cloud handoff requires an onCreating callback to persist creation intent before dispatch.",
			);
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
		// The title carries the request identity because the API lacks idempotency.
		const recoveryTitle = createRequestTitle(
			input.requestId?.trim() || randomUUID(),
		);
		const handoffKey = input.handoff
			? `${creationAuth.subject ?? initialAuthToken}/${input.organizationId ?? ""}/${input.requestId?.trim() ?? ""}`
			: undefined;
		if (input.handoff && !input.requestId?.trim())
			throw new CloudSessionError(
				"request_failed",
				"A stable request id is required for cloud handoff creation.",
			);
		const listMatches = async () =>
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
					(!input.branch?.trim() ||
						session.repoContext.branch === input.branch.trim()),
			);
		const adopt = async (record: CloudSessionRecord) => {
			if (
				record.status === "failed" ||
				(record.expiredAt && Date.parse(record.expiredAt) <= Date.now())
			) {
				const terminalError = new CloudSessionError(
					record.status === "failed" ? "session_failed" : "session_expired",
					"The recovered cloud handoff workspace is no longer usable.",
				);
				try {
					await this.deleteWithAuth(record.id, creationAuth);
				} catch (cleanupError) {
					if (
						!(
							cleanupError instanceof CloudSessionError &&
							(cleanupError.code === "session_not_found" ||
								cleanupError.code === "session_expired")
						)
					) {
						throw new AggregateError(
							[terminalError, cleanupError],
							"The unusable recovered cloud handoff workspace could not be removed.",
						);
					}
				}
				if (handoffKey) {
					this.unconfirmedHandoffCreates.delete(handoffKey);
					this.completedHandoffCreates.delete(handoffKey);
				}
				await input.handoff?.onOuterSessionRemoved?.(record.id);
				throw terminalError;
			}
			await input.handoff?.onOuterSessionCreated(record.id, { created: false });
			const result = {
				sessionId: record.id,
				status: record.status,
				sandboxUrl: record.sandboxUrl,
				cleanupAuthToken: creationAuth.token,
			};
			if (handoffKey) {
				this.unconfirmedHandoffCreates.delete(handoffKey);
				this.completedHandoffCreates.set(handoffKey, result);
			}
			return result;
		};
		if (handoffKey) {
			// Always consult fresh scoped auth before using a remembered create result.
			const matches = await listMatches();
			if (matches.length > 1)
				throw new CloudSessionError(
					"request_failed",
					"Cloud handoff creation is ambiguous; inspect your cloud session list before continuing.",
				);
			if (matches[0]) return await adopt(matches[0]);
			const completed = this.completedHandoffCreates.get(handoffKey);
			if (completed) {
				try {
					await this.request(
						`/api/v1/session/${encodeURIComponent(completed.sessionId)}/status`,
						{},
						undefined,
						creationAuth,
					);
				} catch (error) {
					if (
						error instanceof CloudSessionError &&
						(error.code === "session_not_found" ||
							error.code === "session_expired")
					) {
						await input.handoff?.onOuterSessionRemoved?.(completed.sessionId);
						this.completedHandoffCreates.delete(handoffKey);
						this.unconfirmedHandoffCreates.delete(handoffKey);
					}
					throw error;
				}
				await input.handoff?.onOuterSessionCreated(completed.sessionId, {
					created: false,
				});
				return { ...completed, cleanupAuthToken: creationAuth.token };
			}
			if (this.unconfirmedHandoffCreates.has(handoffKey))
				throw new CloudSessionError(
					"request_failed",
					"Cloud handoff creation is still unconfirmed. Recover the original request before creating another workspace.",
				);
			this.unconfirmedHandoffCreates.add(handoffKey);
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.createTimeoutMs);
		let createdSessionId: string | undefined;
		let postDispatched = false;
		try {
			await input.handoff?.onCreating();
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
				() => {
					postDispatched = true;
				},
			);
			const sessionId = created?.sessionId?.trim();
			if (!sessionId) {
				throw new CloudSessionError(
					"request_failed",
					"The cloud session service returned no session id.",
				);
			}
			createdSessionId = sessionId;
			await this.persistHandoffOuterSession(
				input,
				sessionId,
				creationAuth,
				handoffKey,
			);
			const result = {
				sessionId,
				status: created.status?.trim() || "provisioning",
				sandboxUrl: created.sandboxUrl?.trim() ?? "",
				cleanupAuthToken: creationAuth.token,
			};
			if (handoffKey) {
				this.unconfirmedHandoffCreates.delete(handoffKey);
				this.completedHandoffCreates.set(handoffKey, result);
			}
			return result;
		} catch (error) {
			if (createdSessionId) throw error;
			const definitelyRejected =
				!postDispatched ||
				(error instanceof CloudSessionError &&
					((error.status !== undefined &&
						error.status >= 400 &&
						error.status < 500 &&
						error.status !== 408 &&
						error.status !== 409) ||
						[
							"authentication_required",
							"github_not_connected",
							"session_not_found",
							"session_expired",
						].includes(error.code)));
			if (handoffKey && definitelyRejected) {
				this.unconfirmedHandoffCreates.delete(handoffKey);
				throw new CloudHandoffCreationRejectedError(error);
			}
			// Recover only failures that may have followed an accepted POST.
			const mayStillBeProvisioning =
				controller.signal.aborted ||
				!(error instanceof CloudSessionError) ||
				(error instanceof CloudSessionError &&
					error.code === "request_failed" &&
					(error.status === undefined ||
						error.status >= 500 ||
						error.status === 408 ||
						error.status === 409));
			if (mayStillBeProvisioning) {
				let candidates: CloudSessionRecord[] = [];
				try {
					candidates = await listMatches();
				} catch (recoveryError) {
					if (input.handoff)
						throw new AggregateError(
							[error, recoveryError],
							"Cloud handoff creation is unconfirmed and its session list could not be checked.",
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
					if (input.handoff) return await adopt(recovered);
					return {
						sessionId: recovered.id,
						status: recovered.status,
						sandboxUrl: recovered.sandboxUrl,
						cleanupAuthToken: creationAuth.token,
					};
				}
			} else if (handoffKey) {
				this.unconfirmedHandoffCreates.delete(handoffKey);
			}
			throw error;
		} finally {
			clearTimeout(timeout);
		}
	}

	private async persistHandoffOuterSession(
		input: CreateCloudSessionInput,
		sessionId: string,
		auth: CreationAuth,
		handoffKey?: string,
	): Promise<void> {
		if (!input.handoff) return;
		try {
			await input.handoff.onOuterSessionCreated(sessionId, { created: true });
		} catch (persistenceError) {
			try {
				await this.deleteWithAuth(sessionId, auth.token);
			} catch (cleanupError) {
				if (
					!(
						cleanupError instanceof CloudSessionError &&
						(cleanupError.code === "session_not_found" ||
							cleanupError.code === "session_expired")
					)
				) {
					throw new AggregateError(
						[persistenceError, cleanupError],
						`Cloud session ${sessionId} was created but its recovery record could not be saved or its sandbox removed.`,
					);
				}
			}
			if (handoffKey) this.unconfirmedHandoffCreates.delete(handoffKey);
			await input.handoff.onOuterSessionRemoved?.(sessionId);
			throw persistenceError;
		}
	}

	async waitUntilReady(
		sessionId: string,
		signal: AbortSignal,
		onStatus?: (status: { phase?: CloudProvisioningPhase }) => void,
	): Promise<void> {
		signal = AbortSignal.any([
			signal,
			AbortSignal.timeout(this.createTimeoutMs),
		]);
		const token = await this.options.getAuthToken();
		const authToken = token
			? { token, subject: authSubject(token) }
			: undefined;
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

	private async deleteWithAuth(
		sessionId: string,
		auth?: RequestAuth,
	): Promise<void> {
		let goneError: CloudSessionError | undefined;
		try {
			await this.request(
				`/api/v1/session/${encodeURIComponent(sessionId)}`,
				{ method: "DELETE" },
				undefined,
				auth,
			);
		} catch (error) {
			if (
				!(error instanceof CloudSessionError) ||
				(error.code !== "session_not_found" && error.code !== "session_expired")
			)
				throw error;
			goneError = error;
		}
		for (const [key, result] of this.completedHandoffCreates)
			if (result.sessionId === sessionId) {
				this.completedHandoffCreates.delete(key);
				this.unconfirmedHandoffCreates.delete(key);
			}
		if (goneError) throw goneError;
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
		if (
			!payload ||
			typeof payload !== "object" ||
			!("version" in payload) ||
			payload.version !== 1 ||
			!("messages" in payload) ||
			!Array.isArray(payload.messages)
		) {
			throw new CloudSessionError(
				"request_failed",
				"Invalid archived session history",
			);
		}
		return payload.messages;
	}
}
