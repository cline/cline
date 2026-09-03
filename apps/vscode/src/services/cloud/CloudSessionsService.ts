// REST client for the Cline Cloud control plane: GitHub App integration,
// repository/branch lookup, and the outer `ses-…` sandbox records. The agent
// conversation inside a sandbox is reached separately over the Hub WebSocket
// proxy (see CloudSessionHost). Mirrors the contract the desktop app's
// sidecar uses (apps/examples/desktop-app/sidecar/cloud-sessions.ts).

import { ClineEnv } from "@/config"
import { Logger } from "@/shared/services/Logger"

const REQUEST_TIMEOUT_MS = 15_000
const PROVISIONING_POLL_MS = 3_000
const CREATE_TIMEOUT_MS = 610_000

export type CloudSessionErrorCode =
	| "authentication_required"
	| "github_not_connected"
	| "session_not_found"
	| "session_expired"
	| "session_failed"
	| "request_failed"

export class CloudSessionError extends Error {
	constructor(
		readonly code: CloudSessionErrorCode,
		message: string,
		readonly connectUrl?: string,
		readonly status?: number,
	) {
		super(message)
		this.name = "CloudSessionError"
	}
}

export interface CloudSessionRecord {
	id: string
	status: string
	title?: string
	sandboxUrl?: string
	repoContext: { repoUrl?: string; branch?: string }
	metadata: { modelId?: string; statusReason?: string }
	expiredAt?: string | null
	createdAt: string
	updatedAt: string
}

export interface CloudRepository {
	id: number
	name: string
	fullName: string
	url: string
	defaultBranch: string
}

export interface GitHubConnectionResult {
	connected: boolean
	connectUrl: string
	repositories: CloudRepository[]
}

export interface CreateCloudSessionInput {
	modelId: string
	repoUrl: string
	branch?: string
	organizationId?: string
}

type ApiEnvelope<T> = { success?: boolean; data?: T; error?: string }

function readApiError(payload: unknown, fallback: string): string {
	if (payload && typeof payload === "object") {
		const error = (payload as { error?: unknown }).error
		if (typeof error === "string" && error.trim()) {
			return error.trim()
		}
	}
	return fallback
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "")
}

export function isCloudSessionExpired(record: Pick<CloudSessionRecord, "expiredAt" | "status">): boolean {
	if (record.status === "expired") {
		return true
	}
	const expiredAt = record.expiredAt ? Date.parse(record.expiredAt) : Number.NaN
	return Number.isFinite(expiredAt) && expiredAt <= Date.now()
}

export interface CloudSessionsServiceOptions {
	getAuthToken: () => Promise<string | null | undefined>
	getActiveOrganizationId: () => string | null | undefined
	fetch?: typeof fetch
}

export class CloudSessionsService {
	private readonly fetchImpl: typeof fetch

	constructor(private readonly options: CloudSessionsServiceOptions) {
		this.fetchImpl = options.fetch ?? fetch
	}

	get apiBaseUrl(): string {
		return trimTrailingSlash(ClineEnv.config().apiBaseUrl)
	}

	get appBaseUrl(): string {
		return trimTrailingSlash(ClineEnv.config().appBaseUrl)
	}

	dashboardUrl(sessionId: string): string {
		return `${this.appBaseUrl}/agents?sessionId=${encodeURIComponent(sessionId)}`
	}

	/** WebSocket endpoint the sandbox's Hub is proxied on. */
	sessionSocketUrl(sessionId: string): string {
		const url = new URL(`/api/v1/session/${encodeURIComponent(sessionId)}`, this.apiBaseUrl)
		url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
		return url.toString()
	}

	githubConnectUrl(): string {
		return this.options.getActiveOrganizationId()
			? `${this.appBaseUrl}/dashboard/organization/integrations`
			: `${this.appBaseUrl}/dashboard/integrations`
	}

	private async requireToken(): Promise<string> {
		const token = (await this.options.getAuthToken())?.trim()
		if (!token) {
			throw new CloudSessionError("authentication_required", "Sign in to Cline to use cloud sessions.")
		}
		return token
	}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const token = await this.requireToken()
		const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
			...init,
			signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...(init.headers as Record<string, string> | undefined),
			},
		})
		const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined)
		if (!response.ok) {
			throw this.errorForResponse(response.status, payload)
		}
		return (payload as ApiEnvelope<T> | undefined)?.data as T
	}

	private errorForResponse(status: number, payload: unknown): CloudSessionError {
		const message = readApiError(payload, `Cloud session request failed (${status})`)
		switch (status) {
			case 401:
				return new CloudSessionError("authentication_required", message, undefined, status)
			case 404:
				return new CloudSessionError("session_not_found", message, undefined, status)
			case 410:
				return new CloudSessionError("session_expired", message, undefined, status)
			case 412:
				return new CloudSessionError("github_not_connected", message, this.githubConnectUrl(), status)
			case 403:
				return new CloudSessionError(
					"request_failed",
					"Your active account or organization cannot use cloud sessions. Switch to Personal or another organization in the Account view and try again.",
					undefined,
					status,
				)
			default:
				return new CloudSessionError("request_failed", message, undefined, status)
		}
	}

	private orgScopedPath(personal: string, org: (orgId: string) => string): string {
		const orgId = this.options.getActiveOrganizationId()?.trim()
		return orgId ? org(encodeURIComponent(orgId)) : personal
	}

	// ---- GitHub integration ----

	async getGitHubConnection(): Promise<GitHubConnectionResult> {
		const connectUrl = this.githubConnectUrl()
		const path = this.orgScopedPath(
			"/api/v1/integrations/github/repositories",
			(orgId) => `/api/v1/organizations/${orgId}/integrations/github/repositories`,
		)
		try {
			const rows =
				(await this.request<
					Array<{
						id?: unknown
						name?: unknown
						full_name?: unknown
						html_url?: unknown
						clone_url?: unknown
						default_branch?: unknown
					}>
				>(path)) ?? []
			const repositories = rows.flatMap((row): CloudRepository[] => {
				const id = Number(row.id)
				const url = String(row.html_url ?? row.clone_url ?? "").trim()
				if (!Number.isSafeInteger(id) || id <= 0 || !url) {
					return []
				}
				const name = String(row.name ?? "").trim()
				return [
					{
						id,
						name,
						fullName: String(row.full_name ?? (name || url)).trim(),
						url,
						defaultBranch: String(row.default_branch ?? "").trim(),
					},
				]
			})
			repositories.sort((a, b) => a.fullName.localeCompare(b.fullName))
			return { connected: true, connectUrl, repositories }
		} catch (error) {
			if (
				error instanceof CloudSessionError &&
				(error.code === "github_not_connected" || error.code === "session_not_found")
			) {
				return { connected: false, connectUrl: error.connectUrl ?? connectUrl, repositories: [] }
			}
			throw error
		}
	}

	/** Resolves the GitHub App install URL (the API answers with a redirect to github.com). */
	async getGitHubInstallUrl(): Promise<string> {
		const token = await this.requireToken()
		const installUrl = new URL("/api/v1/integrations/github/install", this.apiBaseUrl)
		installUrl.searchParams.set("redirect", new URL("/dashboard/integrations", this.appBaseUrl).toString())
		const response = await this.fetchImpl(installUrl, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		const location = response.headers.get("location")?.trim()
		if (response.status >= 300 && response.status < 400 && location) {
			const resolved = new URL(location, installUrl)
			if (resolved.protocol === "https:" && resolved.hostname === "github.com") {
				return resolved.toString()
			}
		}
		// Fall back to the dashboard, which hosts the same connect flow.
		Logger.warn(`[CloudSessions] GitHub install URL unavailable (status ${response.status}); opening dashboard instead`)
		return this.githubConnectUrl()
	}

	async listBranches(repositoryId: number, query?: string): Promise<string[]> {
		if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
			return []
		}
		const base = this.orgScopedPath(
			`/api/v1/integrations/github/repositories/${repositoryId}/branches`,
			(orgId) => `/api/v1/organizations/${orgId}/integrations/github/repositories/${repositoryId}/branches`,
		)
		const search = new URLSearchParams()
		const trimmedQuery = query?.trim()
		if (trimmedQuery) {
			search.set("query", trimmedQuery)
		}
		const payload = await this.request<Array<{ name?: unknown }> | { items?: Array<{ name?: unknown }> }>(
			search.size > 0 ? `${base}?${search}` : base,
		)
		const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []
		const lowered = trimmedQuery?.toLowerCase()
		return rows.flatMap((row) => {
			const name = String(row.name ?? "").trim()
			if (!name) {
				return []
			}
			// Array responses are unfiltered by the server; apply the query locally.
			return Array.isArray(payload) && lowered && !name.toLowerCase().includes(lowered) ? [] : [name]
		})
	}

	// ---- Sessions ----

	async listSessions(): Promise<CloudSessionRecord[]> {
		const orgId = this.options.getActiveOrganizationId()?.trim()
		const query = orgId ? `?organizationId=${encodeURIComponent(orgId)}` : ""
		const rows = (await this.request<CloudSessionRecord[]>(`/api/v1/session${query}`)) ?? []
		return rows.flatMap((row) => {
			if (!row || typeof row !== "object" || typeof row.id !== "string") {
				return []
			}
			return [
				{
					...row,
					repoContext: row.repoContext && typeof row.repoContext === "object" ? row.repoContext : {},
					metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
				},
			]
		})
	}

	async getSession(sessionId: string): Promise<CloudSessionRecord | undefined> {
		const sessions = await this.listSessions()
		return sessions.find((session) => session.id === sessionId)
	}

	async getStatus(sessionId: string, signal?: AbortSignal): Promise<{ status?: string; statusReason?: string }> {
		return (await this.request(`/api/v1/session/${encodeURIComponent(sessionId)}/status`, { signal })) ?? {}
	}

	/**
	 * Creates a sandbox and resolves once it is ready to accept a Hub connection.
	 * `onProvisioning` fires as soon as the record exists so the UI can show progress.
	 */
	async createSession(
		input: CreateCloudSessionInput,
		onProvisioning?: (sessionId: string) => void,
	): Promise<CloudSessionRecord> {
		const orgId = input.organizationId ?? this.options.getActiveOrganizationId()?.trim()
		const created = await this.request<{ sessionId: string; sandboxUrl?: string; status?: string }>("/api/v1/session", {
			method: "POST",
			body: JSON.stringify({
				modelId: input.modelId,
				repoUrl: input.repoUrl,
				...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
				...(orgId ? { organizationId: orgId } : {}),
			}),
			// Provisioning can take a while when the API blocks on sandbox creation.
			signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
		})
		const sessionId = created?.sessionId?.trim()
		if (!sessionId) {
			throw new CloudSessionError("request_failed", "The cloud session service returned no session id.")
		}
		onProvisioning?.(sessionId)
		if (created.status === "provisioning" || !created.sandboxUrl?.trim()) {
			try {
				await this.waitUntilReady(sessionId)
			} catch (error) {
				if (error instanceof CloudSessionError && error.code === "session_failed") {
					await this.deleteSession(sessionId).catch(() => undefined)
				}
				throw error
			}
		}
		const record = await this.getSession(sessionId)
		return (
			record ?? {
				id: sessionId,
				status: created.status ?? "active",
				sandboxUrl: created.sandboxUrl,
				repoContext: { repoUrl: input.repoUrl, branch: input.branch },
				metadata: { modelId: input.modelId },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}
		)
	}

	async waitUntilReady(sessionId: string, timeoutMs = CREATE_TIMEOUT_MS): Promise<void> {
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			let result: { status?: string; statusReason?: string } | undefined
			try {
				result = await this.getStatus(sessionId)
			} catch (error) {
				if (error instanceof CloudSessionError && error.code !== "request_failed") {
					throw error
				}
				await new Promise((resolve) => setTimeout(resolve, PROVISIONING_POLL_MS))
				continue
			}
			const status = result?.status?.trim().toLowerCase()
			if (status === "ready" || status === "active") {
				return
			}
			if (status === "failed") {
				throw new CloudSessionError(
					"session_failed",
					result?.statusReason?.trim() || "The cloud sandbox could not be prepared.",
				)
			}
			await new Promise((resolve) => setTimeout(resolve, PROVISIONING_POLL_MS))
		}
		throw new CloudSessionError("request_failed", "Timed out waiting for the cloud sandbox to become ready.")
	}

	async deleteSession(sessionId: string): Promise<void> {
		await this.request(`/api/v1/session/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		await this.request(`/api/v1/session/${encodeURIComponent(sessionId)}`, {
			method: "PATCH",
			body: JSON.stringify({ title }),
		})
	}

	/** Archived transcript of an expired sandbox; null when no archive exists. */
	async getHistory(sessionId: string): Promise<unknown[] | null> {
		const token = await this.requireToken()
		const response = await this.fetchImpl(`${this.apiBaseUrl}/api/v1/session/${encodeURIComponent(sessionId)}/history`, {
			headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		})
		if (response.status === 404) {
			return null
		}
		const payload = await response.json().catch(() => undefined)
		if (!response.ok) {
			throw this.errorForResponse(response.status, payload)
		}
		const messages =
			(payload as { messages?: unknown } | undefined)?.messages ??
			(payload as { data?: { messages?: unknown } } | undefined)?.data?.messages
		return Array.isArray(messages) ? messages : []
	}
}
