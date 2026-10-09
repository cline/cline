// The extension's view of the Cline Cloud control plane: GitHub App
// integration, repository/branch lookup, and the outer `ses-…` sandbox
// records. The protocol (endpoints, create recovery, readiness polling,
// resume, archived history) is the SDK's shared `CloudSessionApi`, the same
// client the desktop app uses; this wrapper adds the VS Code host's account
// scope and endpoints, and errors whose messages can be shown to the user.
// The agent conversation inside a sandbox is reached separately over the Hub
// WebSocket proxy (see CloudSessionHost).

import {
	type CloudProvisioningPhase,
	type CloudRepositoryListResult,
	type CloudRepositoryOption,
	CloudSessionApi,
	type CloudSessionRecord,
	CloudSessionError as SdkCloudSessionError,
} from "@cline/core/cloud"
import { ClineEnv } from "@/config"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"

const REQUEST_TIMEOUT_MS = 15_000

export type { CloudProvisioningPhase, CloudSessionRecord }
export type CloudRepository = CloudRepositoryOption
export type GitHubConnectionResult = CloudRepositoryListResult

export type CloudSessionErrorCode =
	| "authentication_required"
	| "github_not_connected"
	| "session_not_found"
	| "session_expired"
	| "session_failed"
	| "request_failed"

/** A control-plane failure whose message is fit to show the user. */
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

/** The SDK error's `message` is a machine-readable envelope; surface its detail instead. */
function toCloudSessionError(error: unknown): unknown {
	return error instanceof SdkCloudSessionError
		? new CloudSessionError(error.code, error.detail, error.connectUrl, error.status)
		: error
}

async function translated<T>(request: Promise<T>): Promise<T> {
	try {
		return await request
	} catch (error) {
		throw toCloudSessionError(error)
	}
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

export interface CreateCloudSessionInput {
	modelId: string
	repoUrl: string
	branch?: string
	organizationId?: string
}

export interface CloudSessionsServiceOptions {
	getAuthToken: () => Promise<string | null | undefined>
	getActiveOrganizationId: () => string | null | undefined
	fetch?: typeof fetch
	/** Explicit endpoints for hermetic hosts and tests. Production uses ClineEnv. */
	apiBaseUrl?: string
	appBaseUrl?: string
}

export class CloudSessionsService {
	private readonly fetchImpl: typeof fetch
	private apiClient: { api: CloudSessionApi; apiBaseUrl: string; appBaseUrl: string } | undefined

	constructor(private readonly options: CloudSessionsServiceOptions) {
		this.fetchImpl = options.fetch ?? fetch
	}

	get apiBaseUrl(): string {
		return trimTrailingSlash(this.options.apiBaseUrl ?? ClineEnv.config().apiBaseUrl)
	}

	get appBaseUrl(): string {
		return trimTrailingSlash(this.options.appBaseUrl ?? ClineEnv.config().appBaseUrl)
	}

	/** Rebuilt when the environment's endpoints change, so requests never reach a stale host. */
	private get api(): CloudSessionApi {
		const { apiBaseUrl, appBaseUrl } = this
		if (this.apiClient?.apiBaseUrl !== apiBaseUrl || this.apiClient.appBaseUrl !== appBaseUrl) {
			this.apiClient = {
				apiBaseUrl,
				appBaseUrl,
				api: new CloudSessionApi({
					apiBaseUrl,
					appBaseUrl,
					getAuthToken: async () => (await this.options.getAuthToken())?.trim() || undefined,
					fetch: this.fetchImpl,
				}),
			}
		}
		return this.apiClient.api
	}

	private organizationId(): string | undefined {
		return this.options.getActiveOrganizationId()?.trim() || undefined
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
		return this.organizationId()
			? `${this.appBaseUrl}/dashboard/organization/integrations`
			: `${this.appBaseUrl}/dashboard/integrations`
	}

	// ---- GitHub integration ----

	async getGitHubConnection(): Promise<GitHubConnectionResult> {
		try {
			const result = await translated(this.api.listRepositories(this.organizationId()))
			return {
				...result,
				repositories: [...result.repositories].sort((a, b) => a.fullName.localeCompare(b.fullName)),
			}
		} catch (error) {
			// The SDK's 412 link is always Personal's; an organization connects from its own page.
			if (error instanceof CloudSessionError && error.code === "github_not_connected") {
				return { connected: false, connectUrl: this.githubConnectUrl(), repositories: [] }
			}
			throw error
		}
	}

	/** Resolves the GitHub App install URL (the API answers with a redirect to github.com). */
	async getGitHubInstallUrl(): Promise<string> {
		const token = (await this.options.getAuthToken())?.trim()
		if (!token) {
			throw new CloudSessionError("authentication_required", "Sign in to Cline to use cloud sessions.")
		}
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
		const result = await translated(this.api.listBranches(repositoryId, this.organizationId(), { query }))
		return result.branches
	}

	// ---- Sessions ----

	async listSessions(): Promise<CloudSessionRecord[]> {
		return translated(this.api.list(this.organizationId()))
	}

	async getSession(sessionId: string): Promise<CloudSessionRecord | undefined> {
		const sessions = await this.listSessions()
		return sessions.find((session) => session.id === sessionId)
	}

	async getStatus(
		sessionId: string,
		signal?: AbortSignal,
	): Promise<{ status?: string; statusReason?: string; phase?: CloudProvisioningPhase }> {
		return (await translated(this.api.status(sessionId, { signal }))) ?? {}
	}

	/**
	 * Creates a resumable sandbox and resolves once it is ready to accept a Hub
	 * connection. A create whose response is lost is recovered from the account's
	 * session list rather than provisioned twice. `onProvisioning` fires as soon
	 * as the record exists so the UI can show progress; providing it transfers
	 * cleanup ownership to the caller, including when readiness or the record
	 * lookup fails. Aborting `signal` stops the readiness poll; the record already
	 * created stays the caller's to delete.
	 */
	async createSession(
		input: CreateCloudSessionInput,
		onProvisioning?: (sessionId: string) => void,
		signal?: AbortSignal,
		onPhase?: (phase: CloudProvisioningPhase) => void,
	): Promise<CloudSessionRecord> {
		const created = await translated(
			this.api.create({
				modelId: input.modelId,
				repoUrl: input.repoUrl,
				branch: input.branch,
				organizationId: input.organizationId ?? this.organizationId(),
				sandboxType: "resumable",
			}),
		)
		const sessionId = created.sessionId
		onProvisioning?.(sessionId)
		if (created.status === "provisioning" || !created.sandboxUrl) {
			try {
				await this.waitUntilReady(sessionId, signal, onPhase)
			} catch (error) {
				if (!onProvisioning && error instanceof CloudSessionError && error.code === "session_failed") {
					await this.deleteSession(sessionId)
				}
				throw error
			}
		}
		const record = await this.getSession(sessionId)
		return (
			record ?? {
				id: sessionId,
				status: created.status || "active",
				sandboxType: "resumable",
				sandboxUrl: created.sandboxUrl,
				repoContext: { repoUrl: input.repoUrl, branch: input.branch },
				metadata: { modelId: input.modelId, sandboxType: "resumable" },
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}
		)
	}

	/**
	 * Polls until the sandbox accepts connections. Aborting the signal stops the
	 * poll at once (the caller then deletes the unused record) instead of after
	 * the sandbox comes up.
	 */
	async waitUntilReady(
		sessionId: string,
		signal?: AbortSignal,
		onPhase?: (phase: CloudProvisioningPhase) => void,
	): Promise<void> {
		await translated(
			this.api.waitUntilReady(sessionId, signal ?? new AbortController().signal, ({ phase }) => {
				if (phase) onPhase?.(phase)
			}),
		)
	}

	/**
	 * Wakes a suspended (resumable) sandbox and resolves once it accepts
	 * connections again. The control plane refuses sockets to a suspended
	 * sandbox with 409 until it has been resumed.
	 */
	async resumeSession(sessionId: string, onPhase?: (phase: CloudProvisioningPhase) => void): Promise<void> {
		let status: string | undefined
		try {
			status = (await translated(this.api.resume(sessionId)))?.status
		} catch (error) {
			// 409: another client resumed it first, or its resume is still in flight.
			if (!(error instanceof CloudSessionError) || error.status !== 409) throw error
			status = (await this.getStatus(sessionId)).status
			if (status !== "provisioning" && status !== "ready" && status !== "active") throw error
		}
		if (status !== "ready" && status !== "active") {
			await this.waitUntilReady(sessionId, undefined, onPhase)
		}
	}

	async deleteSession(sessionId: string): Promise<void> {
		await translated(this.api.delete(sessionId))
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		await translated(this.api.updateTitle(sessionId, title))
	}

	/** Archived transcript of an expired sandbox; null when no archive exists. */
	async getHistory(sessionId: string): Promise<unknown[] | null> {
		return translated(this.api.history(sessionId))
	}
}
