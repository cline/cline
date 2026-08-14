export type SessionHistoryStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "idle";

export type SessionMetadata = {
	title?: string;
	/**
	 * Favorited sessions. Stored in session metadata rather than desktop-local
	 * state so every client reading the session sees the same flag.
	 */
	pinned?: boolean;
	git?: {
		url?: string;
		branch?: string;
	};
	sessionHistoryOrigin?: {
		mode?: string;
		version?: string;
		trigger?: string;
	};
	[key: string]: unknown;
};

export const PINNED_METADATA_KEY = "pinned";

export interface SessionHistoryItem {
	sessionId: string;
	source?: string;
	status: SessionHistoryStatus;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	parentSessionId?: string;
	isSubagent?: boolean;
	prompt?: string;
	startedAt: string;
	endedAt?: string;
	metadata?: SessionMetadata;
}

export const SCHEDULED_SESSION_SOURCE = "hub-schedule";
export const ALL_SESSION_SOURCES = "__all_session_sources__";

export function getSessionSource(
	session: Pick<SessionHistoryItem, "source" | "metadata">,
): string {
	const source = session.source?.trim();
	if (source) {
		return source;
	}
	return typeof session.metadata?.source === "string"
		? session.metadata.source.trim()
		: "";
}

export function getSessionSourceLabel(source: string): string {
	const knownLabel = {
		cli: "CLI",
		desktop: "Desktop",
		vscode: "VS Code",
		"vscode-webview": "VS Code",
	}[source.trim().toLowerCase()];
	if (knownLabel) {
		return knownLabel;
	}
	return source
		.trim()
		.split(/[-_\s]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function getSessionSources<T extends { source?: string }>(
	sessions: readonly T[],
): string[] {
	return [
		...new Set(
			sessions
				.map((session) => session.source?.trim())
				.filter((source): source is string => Boolean(source)),
		),
	].sort((a, b) => a.localeCompare(b));
}

export function filterSessionsBySource<T extends { source?: string }>(
	sessions: readonly T[],
	source: string,
): T[] {
	if (source === ALL_SESSION_SOURCES) {
		return [...sessions];
	}
	return sessions.filter((session) => session.source?.trim() === source);
}

export function getSessionMetadataTitle(metadata?: SessionMetadata): string {
	if (!metadata) {
		return "";
	}
	return typeof metadata.title === "string" ? metadata.title.trim() : "";
}

export function getSessionMetadataPinned(metadata?: SessionMetadata): boolean {
	return metadata?.[PINNED_METADATA_KEY] === true;
}

export function getSessionMetadataIsScheduled(
	metadata?: SessionMetadata,
): boolean {
	const origin = metadata?.sessionHistoryOrigin;
	if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
		return false;
	}
	return (
		typeof origin.trigger === "string" &&
		origin.trigger.trim() === SCHEDULED_SESSION_SOURCE
	);
}

export function getSessionMetadataGitBranch(
	metadata?: SessionMetadata,
): string {
	const git = metadata?.git;
	if (!git || typeof git !== "object" || Array.isArray(git)) {
		return "";
	}
	return typeof git.branch === "string" ? git.branch.trim() : "";
}
