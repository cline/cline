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

export function normalizeCloudRepositoryUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
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
