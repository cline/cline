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

/**
 * Client-side ids for cloud sessions still provisioning (no server record
 * yet). Shared by the sidecar (which mints them) and the webview (which
 * gates rename/delete/attach affordances on them).
 */
export const CLOUD_PROVISIONING_SESSION_ID_PREFIX = "cloud-provisioning-";

export function isCloudProvisioningSessionId(sessionId: string): boolean {
	return sessionId.startsWith(CLOUD_PROVISIONING_SESSION_ID_PREFIX);
}

export function normalizeCloudRepositoryUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

/** Short "owner/repo" display label for any repository URL form. */
export function cloudRepositoryLabel(repoUrl: string, fallback = ""): string {
	const parts = normalizeCloudRepositoryUrl(repoUrl)
		.replace(/\.git$/i, "")
		.split(/[/:]/)
		.filter(Boolean);
	return parts.slice(-2).join("/") || fallback;
}

export function isGitHubRepositoryUrl(value: string): boolean {
	const normalized = normalizeCloudRepositoryUrl(value);
	if (!normalized) return false;
	try {
		const url = new URL(normalized);
		const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
		return (
			url.protocol === "https:" &&
			url.hostname.toLowerCase() === "github.com" &&
			parts.length === 2 &&
			parts.every(Boolean)
		);
	} catch {
		return false;
	}
}

export function preferredCloudBranch(
	branches: string[],
	defaultBranch: string,
): string {
	const preferred = defaultBranch.trim();
	if (preferred && branches.includes(preferred)) return preferred;
	if (branches.includes("main")) return "main";
	if (branches.includes("master")) return "master";
	return branches[0]?.trim() ?? preferred;
}
