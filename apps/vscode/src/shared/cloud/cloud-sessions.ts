export type CloudExecutionTarget = "local" | "cloud"

/**
 * Lifecycle of a Cline Cloud session as shown in the extension.
 * - provisioning: the sandbox is being created
 * - running: the agent is working (known from a live hub connection)
 * - idle: the sandbox is up but the agent is not running a turn
 * - completed / failed: the last turn ended that way (known from a live hub connection)
 * - cancelled: the last turn was aborted, not successfully completed
 * - unknown: live agent status is being resolved or could not be confirmed
 * - expired: the sandbox is gone; only the archived transcript remains
 */
export type CloudSessionStatus =
	| "provisioning"
	| "running"
	| "idle"
	| "completed"
	| "failed"
	| "cancelled"
	| "unknown"
	| "expired"

/**
 * The last settled agent status confirmed over a live sandbox connection,
 * remembered across restarts so History does not show every finished cloud
 * task as unconfirmed until a socket re-learns it. `observedAt` is compared
 * with the control plane's `updatedAt`: a record updated well after the
 * observation invalidates it. Active statuses are never remembered.
 */
export interface RememberedCloudStatus {
	status: CloudSessionStatus
	observedAt: number
}

/** Remembered statuses keyed by outer cloud session id. */
export type RememberedCloudStatuses = Record<string, RememberedCloudStatus>

/**
 * What the user has chosen about where the next task runs. Only the user
 * writes this, one field per choice; nothing derived is stored. A missing
 * repository or branch means "whatever the extension resolves", see
 * CloudTaskTargetView.
 */
export interface CloudTaskTargetSelection {
	target: CloudExecutionTarget
	/** GitHub repository id the user picked; may belong to another account. */
	repositoryId?: number
	/** Branch the user picked for that repository. */
	branch?: string
}

/**
 * The Local/Cloud target as the extension resolves it from the stored
 * selection, the active account's repositories and the workspace's git
 * remote. Recomputed on every state post; the composer submits `repoUrl`
 * and `branch` from here, never from the stored selection.
 */
export interface CloudTaskTargetView {
	target: CloudExecutionTarget
	/** Repository a cloud task would clone: the stored one if this account can reach it, else the workspace's, else the first. */
	repoUrl?: string
	repositoryId?: number
	/** Branch a cloud task would check out: the user's, else the workspace's when GitHub has it, else the default. */
	branch?: string
	/** Normalized URL of the workspace's origin remote, when it is a GitHub repository. */
	workspaceRepoUrl?: string
}

/** Cloud-specific details of the task currently shown in the chat view. */
export interface CurrentCloudTaskInfo {
	sessionId: string
	repoUrl?: string
	branch?: string
	status: CloudSessionStatus
}

export const CLOUD_WORKSPACE_ROOT = "/workspace"

/**
 * Cloud sessions run in Act mode only, whatever Plan/Act mode the user has
 * saved for local tasks. The sandbox runtime, each turn sent to it and the
 * chat view all read this one value so they cannot disagree.
 */
export const CLOUD_SESSION_MODE = "act" as const

/**
 * Whether the resolved target names a sandbox that can be started: Cloud
 * with a repository. Cloud without a repository (none reachable, or not yet
 * loaded) is an incomplete selection, not a fallback to Local.
 */
export function isCloudTargetReady(view: CloudTaskTargetView | undefined): boolean {
	return view?.target === "cloud" && !!view.repoUrl
}

export const ACTIVE_CLOUD_STATUSES: ReadonlySet<CloudSessionStatus> = new Set(["provisioning", "running"])

export const CLOUD_PROVISIONING_ID_PREFIX = "cloud-provisioning-"

/** Whether an id names a control-plane record that other Cline surfaces can open. */
export function isPersistedCloudSessionId(id: string | undefined): boolean {
	return typeof id === "string" && id.trim().startsWith("ses-")
}

/** Outer Cline Cloud session ids (`ses-…`), plus the placeholder id used while a sandbox is provisioning. */
export function isCloudSessionId(id: string | undefined): boolean {
	if (typeof id !== "string") {
		return false
	}
	const trimmed = id.trim()
	return isPersistedCloudSessionId(trimmed) || trimmed.startsWith(CLOUD_PROVISIONING_ID_PREFIX)
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
	return path
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/i, "")
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
