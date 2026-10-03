import type {
	CloudBranchListOptions,
	CloudBranchListResult,
} from "@cline/core/cloud";

export type {
	CloudBranchListOptions,
	CloudBranchListResult,
	CloudRepositoryListResult,
	CloudRepositoryOption,
} from "@cline/core/cloud";

type CloudRepositorySelection = { repoUrl: string; branch: string };
const SELECTION_KEY = "cline.code.cloud-repository.v1:";

export function readCloudRepositorySelection(
	scope: string,
): CloudRepositorySelection | null {
	try {
		const value = JSON.parse(
			window.localStorage.getItem(SELECTION_KEY + scope) ?? "null",
		);
		return typeof value?.repoUrl === "string" &&
			typeof value?.branch === "string"
			? {
					repoUrl: normalizeCloudRepositoryUrl(value.repoUrl),
					branch: value.branch.trim(),
				}
			: null;
	} catch {
		return null;
	}
}

export function writeCloudRepositorySelection(
	scope: string,
	selection: CloudRepositorySelection,
): void {
	try {
		window.localStorage.setItem(
			SELECTION_KEY + scope,
			JSON.stringify(selection),
		);
	} catch {
		// Ignore localStorage persistence failures, as with local workspace memory.
	}
}

/** Resolve a saved branch without treating an incomplete page as a deletion. */
export async function resolveRememberedCloudBranch(
	repositoryId: number,
	branch: string,
	defaultBranch: string,
	listBranches: (
		id: number,
		options: CloudBranchListOptions,
	) => Promise<CloudBranchListResult>,
): Promise<string> {
	if (!branch || branch === defaultBranch) return defaultBranch;
	let cursor: string | undefined;
	do {
		const result = await listBranches(repositoryId, { query: branch, cursor });
		if (!result.available) return defaultBranch;
		if (result.branches.includes(branch)) return branch;
		cursor = result.nextToken;
	} while (cursor);
	return defaultBranch;
}

export function normalizeCloudRepositoryUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

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
