export type SessionHistoryStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "idle";

export type SessionMetadata = {
	title?: string;
	/**
	 * Pinned sessions. Stored in session metadata rather than desktop-local
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
	/**
	 * Provenance the cron runner stamps onto sessions it starts (see
	 * `buildRunSessionMetadata` in @cline/core). The sidebar groups a
	 * schedule's runs by `scheduleId` and labels each with `scheduleRunNumber`.
	 */
	scheduleId?: string;
	scheduleName?: string;
	scheduleExecutionId?: string;
	scheduleRunNumber?: number;
	[key: string]: unknown;
};

export interface SessionScheduleInfo {
	scheduleId?: string;
	scheduleName?: string;
	runNumber?: number;
}

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

export function getSessionMetadataSchedule(
	metadata?: SessionMetadata,
): SessionScheduleInfo {
	const scheduleId =
		typeof metadata?.scheduleId === "string" ? metadata.scheduleId.trim() : "";
	const scheduleName =
		typeof metadata?.scheduleName === "string"
			? metadata.scheduleName.trim()
			: "";
	const runNumber = metadata?.scheduleRunNumber;
	return {
		...(scheduleId ? { scheduleId } : {}),
		...(scheduleName ? { scheduleName } : {}),
		...(typeof runNumber === "number" &&
		Number.isInteger(runNumber) &&
		runNumber > 0
			? { runNumber }
			: {}),
	};
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
