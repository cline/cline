export type SessionHistoryStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "idle";

export type SessionMetadata = {
	title?: string;
	git?: {
		url?: string;
		branch?: string;
	};
	[key: string]: unknown;
};

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

export function getSessionMetadataTitle(metadata?: SessionMetadata): string {
	if (!metadata) {
		return "";
	}
	return typeof metadata.title === "string" ? metadata.title.trim() : "";
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
