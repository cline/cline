export type CloudExecutionTarget = "local" | "cloud"

/**
 * Lifecycle of a Cline Cloud session as shown in the extension.
 * - provisioning: the sandbox is being created
 * - running: the agent is working (known from a live hub connection)
 * - idle: the sandbox is up but the agent is not running a turn
 * - completed / failed: the last turn ended that way (known from a live hub connection)
 * - expired: the sandbox is gone; only the archived transcript remains
 */
export type CloudSessionStatus = "provisioning" | "running" | "idle" | "completed" | "failed" | "expired"

/** The user's persisted Local/Cloud choice for new tasks. */
export interface CloudTaskTargetSelection {
	target: CloudExecutionTarget
	repoUrl?: string
	repositoryId?: number
	branch?: string
}

/** Cloud-specific details of the task currently shown in the chat view. */
export interface CurrentCloudTaskInfo {
	sessionId: string
	repoUrl?: string
	branch?: string
	status: CloudSessionStatus
	dashboardUrl: string
}

export const CLOUD_WORKSPACE_ROOT = "/workspace"

export const ACTIVE_CLOUD_STATUSES: ReadonlySet<CloudSessionStatus> = new Set(["provisioning", "running"])

export const CLOUD_PROVISIONING_ID_PREFIX = "cloud-provisioning-"

/** Outer Cline Cloud session ids (`ses-…`), plus the placeholder id used while a sandbox is provisioning. */
export function isCloudSessionId(id: string | undefined): boolean {
	if (typeof id !== "string") {
		return false
	}
	const trimmed = id.trim()
	return trimmed.startsWith("ses-") || trimmed.startsWith(CLOUD_PROVISIONING_ID_PREFIX)
}

export function isGitHubRepositoryUrl(url: string | undefined): boolean {
	return !!normalizeGitHubRemoteUrl(url ?? "")
}

/** Formats https://github.com/owner/repo as owner/repo for compact display. */
export function formatRepoLabel(repoUrl: string | undefined): string {
	if (!repoUrl) {
		return ""
	}
	const normalized = normalizeGitHubRemoteUrl(repoUrl)
	return normalized ? normalized.replace(/^https:\/\/github\.com\//, "") : repoUrl
}

function trimGitSuffix(path: string): string {
	return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "")
}

/**
 * Normalizes any GitHub remote form (https, ssh scp-style, ssh://, git://) into
 * https://github.com/owner/repo. Returns null for non-GitHub or malformed remotes.
 */
export function normalizeGitHubRemoteUrl(remoteUrl: string): string | null {
	const value = remoteUrl.trim()
	if (!value) {
		return null
	}
	const scpMatch = value.match(/^(?:[^@/\s]+@)?github\.com:([^\s]+)$/i)
	if (scpMatch?.[1]) {
		const path = trimGitSuffix(scpMatch[1])
		return path.split("/").length === 2 ? `https://github.com/${path}` : null
	}
	try {
		const url = new URL(value)
		if (url.hostname.toLowerCase() !== "github.com") {
			return null
		}
		if (!new Set(["https:", "http:", "ssh:", "git:"]).has(url.protocol)) {
			return null
		}
		const path = trimGitSuffix(url.pathname)
		return path.split("/").length === 2 ? `https://github.com/${path}` : null
	} catch {
		return null
	}
}
