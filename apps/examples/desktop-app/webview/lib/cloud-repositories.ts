export const CLOUD_REPOSITORIES_STORAGE_KEY =
	"cline.code.cloud-repositories.v1";

const MAX_RECENT_CLOUD_REPOSITORIES = 5;

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

export function parseRecentCloudRepositories(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const repositories: string[] = [];
		for (const value of parsed) {
			if (typeof value !== "string") continue;
			const normalized = normalizeCloudRepositoryUrl(value);
			if (!isGitHubRepositoryUrl(normalized) || seen.has(normalized)) continue;
			seen.add(normalized);
			repositories.push(normalized);
			if (repositories.length === MAX_RECENT_CLOUD_REPOSITORIES) break;
		}
		return repositories;
	} catch {
		return [];
	}
}

export function readRecentCloudRepositories(): string[] {
	if (typeof window === "undefined") return [];
	try {
		return parseRecentCloudRepositories(
			window.localStorage.getItem(CLOUD_REPOSITORIES_STORAGE_KEY),
		);
	} catch {
		return [];
	}
}

export function rememberCloudRepository(value: string): string[] {
	const normalized = normalizeCloudRepositoryUrl(value);
	if (!isGitHubRepositoryUrl(normalized)) return readRecentCloudRepositories();
	const repositories = [
		normalized,
		...readRecentCloudRepositories().filter((item) => item !== normalized),
	].slice(0, MAX_RECENT_CLOUD_REPOSITORIES);
	try {
		window.localStorage.setItem(
			CLOUD_REPOSITORIES_STORAGE_KEY,
			JSON.stringify(repositories),
		);
	} catch {
		// Recents are a convenience; selection still works without persistence.
	}
	return repositories;
}
