/**
 * The real {@link RemoteSessionGateway} for Cline Cloud, backed by the core-api
 * REST sessions API.
 *
 * It is auth-agnostic: credentials arrive via an injected `getAccessToken` that
 * returns the raw Cline JWT, and every request is sent as
 * `Authorization: Bearer workos:<jwt>`. `fetch` is injectable too, so the whole
 * gateway is driven by a fake in tests with no network.
 *
 * Two shapes cross this boundary:
 *  - the wire `SessionDTO` (free-form `status` string, ISO dates, raw sandbox
 *    host), and
 *  - the resolver's {@link RemoteSession} (a `RemoteSessionStatus` union, epoch
 *    ms, and — by cloud convention — `sandboxUrl` set to the WS *proxy* URL, not
 *    the raw sandbox host, so `resolveCloudSession` connects through the proxy).
 */

import { z } from "zod";
import { errorDetail } from "../../error-message";
import {
	asRemoteSessionId,
	type RemoteSession,
	type RemoteSessionGateway,
	type RemoteSessionId,
	type RemoteSessionStatus,
} from "../../session";
import type { CloudSessionWaitOptions } from "../../session/cloud-resolver";
import { formatCloudCredential } from "../auth/credential";
import { type FetchLike, readJson, resolveFetch, timeoutSignal } from "../http";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PROVISIONING_POLL_MS = 3_000;
const DEFAULT_PROVISIONING_TIMEOUT_MS = 10 * 60_000;

// React Native's abort-controller polyfill does not expose throwIfAborted().
function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw signal.reason ?? new Error("Cloud startup cancelled.");
}

/**
 * Thrown when create returns 412: the account has no connected GitHub
 * integration, which can only be fixed on the web dashboard.
 */
export class GitHubIntegrationRequiredError extends Error {
	constructor(readonly detail?: string) {
		super(
			detail ??
				"GitHub is not connected for this account. Connect it under Integrations on the web first.",
		);
		this.name = "GitHubIntegrationRequiredError";
	}
}

/** Any other non-OK response from the sessions REST API. */
export class CloudSessionApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "CloudSessionApiError";
	}
}

/**
 * Thrown when a 2xx response's body is not the shape the contract promises.
 *
 * A subclass so callers that only care about "the cloud call failed" keep working
 * off {@link CloudSessionApiError}, while a malformed body is still
 * distinguishable from an HTTP error.
 */
export class CloudSessionResponseError extends CloudSessionApiError {
	constructor(message: string, status: number) {
		super(message, status);
		this.name = "CloudSessionResponseError";
	}
}

/** The server may have created a workspace. Recovery must list sessions, not repeat POST. */
export class AmbiguousCloudSessionCreateError extends CloudSessionResponseError {
	constructor(
		detail = "The connection ended before Cline Cloud confirmed the new workspace.",
		status = 0,
	) {
		super(detail, status);
		this.name = "AmbiguousCloudSessionCreateError";
	}
}

/**
 * The wire shape of a session row (subset the app reads; §2 `SessionDTO`).
 *
 * Parsed, not cast: core-api is a separate release from the app, and an
 * unvalidated `json.data as SessionDto[]` turned a non-array body into a silent
 * "no sessions" and a row missing `id` into internal error text in front of the
 * user.
 */
const sessionDtoSchema = z.looseObject({
	id: z.string().min(1),
	status: z.string().optional(),
	sandboxType: z.enum(["standard", "resumable"]).optional(),
	sandboxUrl: z.string().optional(),
	organizationId: z.string().optional(),
	title: z.string().optional(),
	metadata: z
		.looseObject({
			modelId: z.string().optional(),
			taskId: z.string().optional(),
			statusReason: z.string().optional(),
			sandboxType: z.enum(["standard", "resumable"]).optional(),
		})
		.nullish(),
	repoContext: z
		.looseObject({
			repoUrl: z.string().optional(),
			branch: z.string().optional(),
		})
		.nullish(),
	phase: z.string().nullish(),
	expiredAt: z.string().nullish(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	lastActivityAt: z.string().nullish(),
});

const sessionListSchema = z.array(sessionDtoSchema);
const sessionCreateSchema = z.looseObject({
	sessionId: z.string().min(1),
	status: z.string().optional(),
});
const sessionStatusSchema = z.looseObject({
	sessionId: z.string().min(1),
	status: z.string().min(1),
	statusReason: z.string().optional(),
	phase: z.string().optional(),
});

type SessionDto = z.infer<typeof sessionDtoSchema>;

interface SessionEnvelope {
	success?: boolean;
	error?: unknown;
	data?: unknown;
}

export interface CreateRemoteSessionInput {
	/** e.g. `anthropic/claude-sonnet-4-6`. Required. */
	modelId: string;
	/** `https://github.com/owner/repo`. Required. */
	repoUrl: string;
	organizationId?: string;
	title?: string;
	/** Git branch to start from. Omitted = the repository's default branch. */
	branch?: string;
}

export interface CreateRemoteSessionResult {
	sessionId: RemoteSessionId;
	/** The WS proxy URL for this session (already the connect URL). */
	sandboxUrl: string;
}

export interface CreatedRemoteSession extends CreateRemoteSessionResult {
	/** Status returned by create, retained so retry resumes polling this session. */
	initialStatus?: string;
}

export interface CreateRemoteSessionOptions extends CloudSessionWaitOptions {
	onCreated?(session: CreatedRemoteSession): unknown;
}

export interface CloudSessionGatewayOptions {
	/** core-api base (no trailing slash), e.g. staging core-api host. */
	apiBaseUrl: string;
	/** Resolves the raw Cline JWT (WITHOUT the `workos:` prefix). */
	getAccessToken: () => Promise<string | null>;
	/** Org scope for list/create; omit for personal sessions. */
	organizationId?: string;
	fetchImpl?: FetchLike;
	/** Timeout for each REST request. */
	requestTimeoutMs?: number;
	/** Provisioning poll cadence. Defaults to the dashboard's 3 seconds. */
	provisioningPollMs?: number;
	/** Total time to wait for a newly-created sandbox to become ready. */
	provisioningTimeoutMs?: number;
	/** Test seam for polling without real timers. */
	sleep?: (ms: number) => Promise<void>;
}

/** Free-form DTO `status` -> the resolver's status union. */
const STATUS_MAP: Readonly<Record<string, RemoteSessionStatus>> = {
	ready: "running",
	running: "running",
	active: "running",
	provisioning: "provisioning",
	pending: "provisioning",
	creating: "provisioning",
	starting: "provisioning",
	initializing: "provisioning",
	stopped: "stopped",
	stopping: "stopped",
	paused: "stopped",
	suspended: "suspended",
	expired: "expired",
	failed: "failed",
	error: "failed",
};

/** Unknown availability must never be presented as a running agent. */
export function mapRemoteSessionStatus(status?: string): RemoteSessionStatus {
	if (!status) {
		return "unknown";
	}
	return STATUS_MAP[status.trim().toLowerCase()] ?? "unknown";
}

/** First couple of zod issues as `path: message`, for a diagnostic-grade string. */
function describeIssues(error: z.ZodError): string {
	return error.issues
		.slice(0, 2)
		.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
		.join("; ");
}

function parseEpoch(value: string | null | undefined): number | undefined {
	if (!value) {
		return undefined;
	}
	const epoch = Date.parse(value);
	return Number.isNaN(epoch) ? undefined : epoch;
}

export class CloudSessionGateway implements RemoteSessionGateway {
	constructor(private readonly options: CloudSessionGatewayOptions) {}

	private get doFetch(): FetchLike {
		return resolveFetch(this.options.fetchImpl);
	}

	private async authHeader(): Promise<string> {
		const token = await this.options.getAccessToken();
		if (!token) {
			throw new CloudSessionApiError("Not signed in to Cline Cloud.", 401);
		}
		return `Bearer ${formatCloudCredential(token)}`;
	}

	private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
		throwIfCancelled(signal);
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort: (() => void) | undefined;
		try {
			await new Promise<void>((resolve, reject) => {
				abort = () =>
					reject(signal?.reason ?? new Error("Cloud startup cancelled."));
				signal?.addEventListener("abort", abort, { once: true });
				if (this.options.sleep) this.options.sleep(ms).then(resolve, reject);
				else timer = setTimeout(resolve, ms);
			});
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			if (abort) signal?.removeEventListener("abort", abort);
		}
	}

	/**
	 * By cloud convention the connect URL is the WS proxy, not the raw sandbox
	 * host. Setting `RemoteSession.sandboxUrl` to this keeps `resolveCloudSession`
	 * oblivious — it only rewrites the scheme to `wss:`.
	 */
	private proxyUrl(sessionId: string): string {
		return `${this.options.apiBaseUrl}/api/v1/session/${sessionId}`;
	}

	private toRemoteSession(dto: SessionDto): RemoteSession {
		const createdAt = parseEpoch(dto.createdAt);
		const updatedAt = parseEpoch(dto.updatedAt);
		const lastActivityAt = parseEpoch(dto.lastActivityAt);
		return {
			id: asRemoteSessionId(dto.id),
			sandboxUrl: this.proxyUrl(dto.id),
			status: mapRemoteSessionStatus(dto.status),
			...((dto.sandboxType ?? dto.metadata?.sandboxType)
				? { sandboxType: dto.sandboxType ?? dto.metadata?.sandboxType }
				: {}),
			expiredAt: parseEpoch(dto.expiredAt) ?? null,
			...(dto.metadata?.modelId ? { modelId: dto.metadata.modelId } : {}),
			...(dto.metadata?.taskId?.trim()
				? { taskId: dto.metadata.taskId.trim() }
				: {}),
			...(dto.repoContext?.branch ? { branch: dto.repoContext.branch } : {}),
			...(dto.phase ? { phase: dto.phase } : {}),
			...(dto.metadata?.statusReason
				? { statusReason: dto.metadata.statusReason }
				: {}),
			...(dto.repoContext?.repoUrl ? { repoUrl: dto.repoContext.repoUrl } : {}),
			...((dto.organizationId ?? this.options.organizationId)
				? { organizationId: dto.organizationId ?? this.options.organizationId }
				: {}),
			...(dto.title ? { title: dto.title } : {}),
			...(createdAt !== undefined ? { createdAt } : {}),
			...(updatedAt !== undefined ? { updatedAt } : {}),
			...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
		};
	}

	async listRemoteSessions(
		options: { refreshProvisioning?: boolean } = {},
	): Promise<RemoteSession[]> {
		const url = new URL(`${this.options.apiBaseUrl}/api/v1/session`);
		if (this.options.organizationId) {
			url.searchParams.set("organizationId", this.options.organizationId);
		}
		const response = await this.doFetch(url.toString(), {
			method: "GET",
			headers: {
				Authorization: await this.authHeader(),
				"Content-Type": "application/json",
			},
			signal: timeoutSignal(
				this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
			),
		});
		const json = (await readJson(response)) as SessionEnvelope;
		if (!response.ok || !json.success) {
			const detail = errorDetail(json.error);
			throw new CloudSessionApiError(
				`Failed to list sessions: ${response.status}${detail ? ` - ${detail}` : ""}`,
				response.status,
			);
		}
		const rows = sessionListSchema.safeParse(json.data);
		if (!rows.success) {
			throw new CloudSessionResponseError(
				`Cline Cloud returned a session list this app cannot read: ${describeIssues(rows.error)}`,
				response.status,
			);
		}
		return Promise.all(
			rows.data.map(async (row) => {
				const session = this.toRemoteSession(row);
				if (!options.refreshProvisioning || session.status !== "provisioning")
					return session;
				// Match desktop discovery: status GET reconciles a stale Starting row;
				// it never resumes or creates a workspace. A failed probe preserves the row.
				try {
					return await this.readWorkspaceStatus(session);
				} catch {
					return session;
				}
			}),
		);
	}

	private async readWorkspaceStatus(
		session: RemoteSession,
	): Promise<RemoteSession> {
		const current = await this.lifecycleRequest(session.id, "status", "GET");
		const parsed = sessionStatusSchema.safeParse(current);
		if (!parsed.success || parsed.data.sessionId !== session.id)
			throw new CloudSessionResponseError(
				"Cline Cloud returned an invalid workspace status.",
				200,
			);
		return {
			...session,
			status: mapRemoteSessionStatus(parsed.data.status),
			phase: parsed.data.phase,
			statusReason: parsed.data.statusReason,
		};
	}

	/** No `GET /:id` exists in the REST API — resolve from the list (§4a). */
	async getRemoteSession(
		id: RemoteSessionId,
	): Promise<RemoteSession | undefined> {
		const all = await this.listRemoteSessions();
		const session = all.find((session) => session.id === id);
		// Opening checks live status; discovery above must never wake a sandbox.
		if (
			session?.sandboxType === "resumable" ||
			session?.status === "suspended"
		) {
			return this.readWorkspaceStatus(session);
		}
		return session;
	}

	/** Wake only the selected persistent workspace, never create a replacement. */
	async resumeSuspendedSession(
		id: RemoteSessionId,
		options: CloudSessionWaitOptions = {},
	): Promise<RemoteSession> {
		try {
			const data = await this.lifecycleRequest(
				id,
				"resume",
				"POST",
				options.signal,
			);
			const parsed = sessionDtoSchema.safeParse(data);
			if (!parsed.success || parsed.data.id !== id || !parsed.data.status)
				throw new CloudSessionResponseError(
					"Cline Cloud did not confirm the requested workspace resume.",
					200,
				);
			return this.toRemoteSession(parsed.data);
		} catch (error) {
			// A concurrent viewer may already have resumed this same workspace.
			if (!(error instanceof CloudSessionApiError) || error.status !== 409)
				throw error;
			throwIfCancelled(options.signal);
			const current = await this.getRemoteSession(id);
			if (current?.status === "running" || current?.status === "provisioning")
				return current;
			throw error;
		}
	}

	async suspendRemoteSession(id: RemoteSessionId): Promise<void> {
		const data = await this.lifecycleRequest(id, "suspend", "POST");
		const parsed = sessionDtoSchema.safeParse(data);
		if (
			!parsed.success ||
			parsed.data.id !== id ||
			parsed.data.status !== "suspended"
		)
			throw new CloudSessionResponseError(
				"Cline Cloud did not confirm that this workspace stopped. Refresh sessions to check its status.",
				200,
			);
	}

	private async lifecycleRequest(
		id: RemoteSessionId,
		action: "status" | "resume" | "suspend",
		method: "GET" | "POST",
		signal?: AbortSignal,
	): Promise<unknown> {
		throwIfCancelled(signal);
		const controller = new AbortController();
		const abort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(
			() => controller.abort(),
			this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		);
		try {
			const authorization = await this.authHeader();
			throwIfCancelled(signal);
			const response = await this.doFetch(
				`${this.proxyUrl(encodeURIComponent(id))}/${action}`,
				{
					method,
					headers: {
						Authorization: authorization,
						"Content-Type": "application/json",
					},
					signal: controller.signal,
				},
			);
			const json = (await readJson(response)) as SessionEnvelope;
			throwIfCancelled(signal);
			if (!response.ok || !json?.success)
				throw new CloudSessionApiError(
					errorDetail(json?.error) ||
						(action === "resume"
							? "Cline Cloud could not resume this workspace. Try again."
							: action === "suspend"
								? "Cline Cloud could not stop this workspace. Try again."
								: "Cline Cloud could not check this workspace. Try again."),
					response.status,
				);
			return json.data;
		} finally {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
		}
	}

	/**
	 * Create a sandbox, then poll the status endpoint until it is connectable.
	 * Current Cloud API returns immediately with `status: "provisioning"`;
	 * older deployments omitted status after waiting for readiness, which remains
	 * a safe success shape for backwards compatibility.
	 */
	async createRemoteSession(
		input: CreateRemoteSessionInput,
		options: CreateRemoteSessionOptions = {},
	): Promise<CreateRemoteSessionResult> {
		const organizationId = input.organizationId ?? this.options.organizationId;
		// Authentication failure happens before dispatch and is safe to retry.
		const authorization = await this.authHeader();
		throwIfCancelled(options.signal);
		const response = await this.doFetch(
			`${this.options.apiBaseUrl}/api/v1/session`,
			{
				method: "POST",
				headers: {
					Authorization: authorization,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					modelId: input.modelId,
					repoUrl: input.repoUrl,
					sandboxType: "resumable",
					...(organizationId ? { organizationId } : {}),
					...(input.title ? { title: input.title } : {}),
					...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
				}),
				signal: timeoutSignal(
					this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
				),
			},
		).catch(() => {
			throw new AmbiguousCloudSessionCreateError();
		});
		const body = await readJson(response);
		const json = (
			body && typeof body === "object" ? body : {}
		) as SessionEnvelope;
		if (response.status >= 500 || (response.ok && !json.success)) {
			throw new AmbiguousCloudSessionCreateError(undefined, response.status);
		}
		if (response.status === 412) {
			throw new GitHubIntegrationRequiredError(errorDetail(json.error));
		}
		if (!response.ok || !json.success) {
			const detail = errorDetail(json.error);
			throw new CloudSessionApiError(
				`Failed to create session: ${response.status}${detail ? ` - ${detail}` : ""}`,
				response.status,
			);
		}
		const parsed = sessionCreateSchema.safeParse(json.data);
		if (!parsed.success) {
			throw new AmbiguousCloudSessionCreateError(
				`Create session returned an invalid response (${describeIssues(parsed.error)}).`,
				response.status,
			);
		}
		const sessionId = asRemoteSessionId(parsed.data.sessionId);
		const created: CreatedRemoteSession = {
			sessionId,
			sandboxUrl: this.proxyUrl(sessionId),
			...(parsed.data.status ? { initialStatus: parsed.data.status } : {}),
		};
		await options.onCreated?.(created);
		if (parsed.data.status) {
			await this.waitUntilReady(sessionId, parsed.data.status, options);
		}
		return { sessionId: created.sessionId, sandboxUrl: created.sandboxUrl };
	}

	/** Continue waiting for a POST that already created its server-side session. */
	async resumeRemoteSession(
		created: CreatedRemoteSession,
		options: CloudSessionWaitOptions = {},
	): Promise<CreateRemoteSessionResult> {
		if (created.initialStatus) {
			await this.waitUntilReady(
				created.sessionId,
				created.initialStatus,
				options,
			);
		}
		return { sessionId: created.sessionId, sandboxUrl: created.sandboxUrl };
	}

	async waitUntilReady(
		sessionId: RemoteSessionId,
		initialStatus: string,
		options: CloudSessionWaitOptions = {},
	): Promise<void> {
		const timeoutMs =
			this.options.provisioningTimeoutMs ?? DEFAULT_PROVISIONING_TIMEOUT_MS;
		const pollMs =
			this.options.provisioningPollMs ?? DEFAULT_PROVISIONING_POLL_MS;
		const deadline = Date.now() + timeoutMs;
		let status = initialStatus;
		let reason: string | undefined;
		let phase: string | undefined;

		while (true) {
			throwIfCancelled(options.signal);
			options.onProgress?.({
				status,
				...(reason ? { statusReason: reason } : {}),
				...(phase ? { phase } : {}),
			});
			const normalized = status.trim().toLowerCase();
			if (["ready", "active", "running"].includes(normalized)) {
				return;
			}
			if (
				[
					"failed",
					"expired",
					"stopped",
					"stopping",
					"paused",
					"suspended",
					"error",
				].includes(normalized)
			) {
				throw new CloudSessionApiError(
					reason?.trim() ||
						`Cline Cloud could not start this workspace (${normalized}).`,
					409,
				);
			}
			if (Date.now() >= deadline) {
				throw new CloudSessionApiError(
					"Cline Cloud is still provisioning this workspace. Try opening it again shortly.",
					408,
				);
			}

			await this.sleep(
				Math.max(0, Math.min(pollMs, deadline - Date.now())),
				options.signal,
			);
			throwIfCancelled(options.signal);
			if (Date.now() >= deadline) continue;
			const controller = new AbortController();
			const abort = () => controller.abort(options.signal?.reason);
			options.signal?.addEventListener("abort", abort, { once: true });
			const timer = setTimeout(
				() => controller.abort(),
				Math.max(
					0,
					Math.min(
						this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
						deadline - Date.now(),
					),
				),
			);
			try {
				const response = await this.doFetch(
					`${this.options.apiBaseUrl}/api/v1/session/${sessionId}/status`,
					{
						method: "GET",
						headers: {
							Authorization: await this.authHeader(),
							"Content-Type": "application/json",
						},
						signal: controller.signal,
					},
				);
				const body = await readJson(response);
				const json = (
					body && typeof body === "object" ? body : {}
				) as SessionEnvelope;
				if (!response.ok || !json.success) {
					const detail = errorDetail(json.error);
					throw new CloudSessionApiError(
						`Failed to read session status: ${response.status}${detail ? ` - ${detail}` : ""}`,
						response.status,
					);
				}
				const parsed = sessionStatusSchema.safeParse(json.data);
				if (!parsed.success || parsed.data.sessionId !== sessionId) {
					throw new CloudSessionResponseError(
						parsed.success
							? "Session status response referred to a different session."
							: `Session status returned an invalid response (${describeIssues(parsed.error)}).`,
						response.status,
					);
				}
				status = parsed.data.status;
				reason = parsed.data.statusReason;
				phase = parsed.data.phase;
			} catch (error) {
				throwIfCancelled(options.signal);
				// Read-only status polling is safe to repeat; create is deliberately not.
				if (
					error instanceof CloudSessionApiError &&
					(error instanceof CloudSessionResponseError ||
						(![408, 429].includes(error.status) && error.status < 500))
				)
					throw error;
			} finally {
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", abort);
			}
		}
	}

	async readHistory(id: RemoteSessionId): Promise<unknown[] | undefined> {
		const response = await this.doFetch(
			`${this.proxyUrl(encodeURIComponent(id))}/history`,
			{
				method: "GET",
				headers: { Authorization: await this.authHeader() },
				signal: timeoutSignal(
					this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
				),
			},
		);
		if (response.status === 404) return undefined;
		const json = await readJson(response);
		if (!response.ok)
			throw new CloudSessionApiError(
				`Could not load archived conversation (${response.status}).`,
				response.status,
			);
		const parsed = z
			.object({ version: z.literal(1), messages: z.array(z.unknown()) })
			.safeParse(json);
		if (!parsed.success)
			throw new CloudSessionResponseError(
				"Cline Cloud returned an archive this app cannot read.",
				response.status,
			);
		return parsed.data.messages;
	}

	async updateTitle(id: RemoteSessionId, title: string): Promise<void> {
		const response = await this.doFetch(this.proxyUrl(encodeURIComponent(id)), {
			method: "PATCH",
			headers: {
				Authorization: await this.authHeader(),
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title: title.trim() }),
			signal: timeoutSignal(
				this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
			),
		});
		const json = (await readJson(response)) as SessionEnvelope;
		if (!response.ok || json.success === false)
			throw new CloudSessionApiError(
				`Could not rename this conversation (${response.status}).`,
				response.status,
			);
	}

	/** Delete a session the caller owns. 204 on success. */
	async deleteRemoteSession(id: RemoteSessionId): Promise<void> {
		const response = await this.doFetch(
			`${this.options.apiBaseUrl}/api/v1/session/${id}`,
			{
				method: "DELETE",
				headers: { Authorization: await this.authHeader() },
				signal: timeoutSignal(
					this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
				),
			},
		);
		if (response.status === 204) {
			return;
		}
		const json = (await readJson(response)) as SessionEnvelope;
		// A 200 body may still report failure (`{success:false,error}`), exactly like
		// list/create — treating that as success left the row on screen as deleted.
		if (!response.ok || json.success === false) {
			const detail = errorDetail(json.error);
			throw new CloudSessionApiError(
				`Failed to delete session: ${response.status}${detail ? ` - ${detail}` : ""}`,
				response.status,
			);
		}
	}
}
