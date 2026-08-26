"use client";

import { isChatWorkspacePath } from "@cline/shared/browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeTitle } from "@/components/utils";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type {
	SessionHistoryItem,
	SessionHistoryStatus,
	SessionMetadata,
} from "@/lib/session-history";
import {
	getSessionMetadataGitBranch,
	getSessionMetadataIsScheduled,
	getSessionMetadataPinned,
	getSessionMetadataTitle,
	getSessionSource,
	PINNED_METADATA_KEY,
} from "@/lib/session-history";

type CliDiscoveredSession = Omit<SessionHistoryItem, "status"> & {
	status: string;
};

export interface SessionThread {
	id: string;
	title: string;
	source?: string;
	codebase: string;
	workspacePath: string;
	time: string;
	provider: string;
	model: string;
	gitBranch?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCostUsd?: number;
	status: SessionHistoryStatus;
	pinned?: boolean;
	isScheduled: boolean;
}

type SessionHookEvent = {
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
};

type SessionMessageMeta = {
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	providerId?: string;
	modelId?: string;
};

type SessionMessage = {
	id?: string;
	role?: string;
	content?: string;
	meta?: SessionMessageMeta;
};

type SessionTitleUpdatedEvent = CustomEvent<{
	sessionId: string;
	title: string;
}>;

type SessionDeletedEvent = CustomEvent<{
	sessionId: string;
}>;

type SidecarSessionStateEvent = {
	sessionId?: string;
	status?: string;
};

type SidecarChatEvent = {
	sessionId?: string;
	stream?: string;
};

export type SessionPendingAction = {
	sessionId: string;
	action: "rename" | "fork" | "delete";
} | null;

export type UseSessionHistoryOptions = {
	activeSessionId?: string | null;
	onOpenSession?: (session: SessionHistoryItem) => void;
	onDeleteSession?: (sessionId: string) => void;
	onUpdateSessionMetadata?: (
		sessionId: string,
		metadata: SessionMetadata,
	) => void;
};

// Kept small on purpose: the sidebar shows 10 threads and the sessions view
// pages 10 at a time, so the mount fetch (and every 12s poll after it) only
// needs enough rows for the first few pages. Older pages are fetched on demand.
const INITIAL_HISTORY_FETCH_LIMIT = 50;
const HISTORY_REFRESH_INTERVAL_MS = 12_000;
const MIN_EVENT_HISTORY_REFRESH_INTERVAL_MS = 2_000;
const HISTORY_EVENT_REFRESH_DELAY_MS = 1_000;
const HISTORY_FAST_REFRESH_DELAY_MS = 50;
const HISTORY_TERMINAL_REFRESH_DELAY_MS = 250;

export function parseTimestamp(value?: string): number {
	if (!value) return Number.NEGATIVE_INFINITY;
	const trimmed = value.trim();
	const maybeEpoch = Number(trimmed);
	if (Number.isFinite(maybeEpoch)) {
		if (/^\d{10}$/.test(trimmed)) {
			return maybeEpoch * 1000;
		}
		return maybeEpoch;
	}
	const parsed = new Date(trimmed).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function sessionActivityTimestamp(session: SessionHistoryItem): number {
	const endedAt = parseTimestamp(session.endedAt);
	const startedAt = parseTimestamp(session.startedAt);
	return Math.max(endedAt, startedAt);
}

// Order by last activity, not by start time: a long-running session that was
// resumed today must outrank one that started later but has been idle for
// days. This is also the timestamp both the sidebar and the sessions view
// render, so the list order matches the "1d"/"3d" labels next to each row.
function compareSessionsByActivityDesc(
	a: SessionHistoryItem,
	b: SessionHistoryItem,
): number {
	const timeDelta = sessionActivityTimestamp(b) - sessionActivityTimestamp(a);
	if (timeDelta !== 0) {
		return timeDelta;
	}
	return b.sessionId.localeCompare(a.sessionId);
}

export function normalizeDiscoveredStatus(
	status?: string,
	prompt?: string,
): SessionHistoryStatus {
	const normalized = (status || "").toLowerCase();
	const hasPrompt = Boolean(prompt?.trim());
	if (normalized.includes("complete") || normalized.includes("done")) {
		return "completed";
	}
	if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("interrupt")
	) {
		return "cancelled";
	}
	if (normalized.includes("fail") || normalized.includes("error")) {
		return "failed";
	}
	if (normalized.includes("run") || normalized.includes("start")) {
		return hasPrompt ? "running" : "idle";
	}
	if (normalized === "idle") return "idle";
	return "idle";
}

function isTerminalHistoryStatus(status: SessionHistoryStatus): boolean {
	return (
		status === "completed" || status === "failed" || status === "cancelled"
	);
}

export function formatRelativeTime(value?: string): string {
	if (!value) return "just now";
	const timestamp = parseTimestamp(value);
	const date = Number.isFinite(timestamp)
		? new Date(timestamp)
		: new Date(value);
	if (Number.isNaN(date.getTime())) return "";

	const diffMs = Date.now() - date.getTime();
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diffMs < minute) return "now";
	if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m`;
	if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))}h`;
	return `${Math.max(1, Math.floor(diffMs / day))}d`;
}

export function basenamePath(input?: string): string {
	if (!input) return "workspace";
	if (isChatWorkspacePath(input)) return "Chat";
	const trimmed = input.replace(/[\\/]+$/, "");
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || "workspace";
}

function toTitle(session: SessionHistoryItem): string {
	const metadataTitle = getSessionMetadataTitle(session.metadata);
	if (metadataTitle) {
		return metadataTitle;
	}
	const line = normalizeTitle(session.prompt).trim().split("\n")[0]?.trim();
	if (line) return line;
	return `Session ${session.sessionId.slice(-6)}`;
}

function titleFromMessages(messages: SessionMessage[]): string | null {
	for (const role of ["user", "assistant"] as const) {
		for (const message of messages) {
			if (message.role !== role) {
				continue;
			}
			const content =
				typeof message.content === "string" ? message.content : "";
			const line = normalizeTitle(content).trim().split("\n")[0]?.trim();
			if (line) {
				return line;
			}
		}
	}
	return null;
}

function inferStatusFromMessages(
	status: SessionHistoryStatus,
	messages: SessionMessage[],
): SessionHistoryStatus {
	const meaningfulMessages = messages.filter((message) => {
		if (message.role !== "user" && message.role !== "assistant") {
			return false;
		}
		const content = typeof message.content === "string" ? message.content : "";
		return content.trim().length > 0;
	});
	if (meaningfulMessages.length === 0) {
		return status === "running" ? "running" : "idle";
	}
	const lastMeaningful = meaningfulMessages[meaningfulMessages.length - 1];
	if (status === "failed" && lastMeaningful.role === "assistant") {
		return "completed";
	}
	return status;
}

function toThread(session: SessionHistoryItem): SessionThread {
	const workspacePath = (session.workspaceRoot || session.cwd).trim();
	return {
		id: session.sessionId,
		title: toTitle(session),
		source: getSessionSource(session) || undefined,
		codebase: basenamePath(workspacePath),
		workspacePath,
		time: formatRelativeTime(session.endedAt || session.startedAt),
		provider: session.provider || "",
		model: session.model || "",
		gitBranch: getSessionMetadataGitBranch(session.metadata) || undefined,
		status: normalizeDiscoveredStatus(session.status, session.prompt),
		pinned: getSessionMetadataPinned(session.metadata),
		isScheduled: getSessionMetadataIsScheduled(session.metadata),
	};
}

function isKnownModelField(value?: string): boolean {
	const trimmed = value?.trim().toLowerCase() ?? "";
	return trimmed.length > 0 && trimmed !== "unknown";
}

function isValidHistorySession(session: SessionHistoryItem): boolean {
	return (
		Boolean(session.sessionId.trim()) &&
		isKnownModelField(session.provider) &&
		isKnownModelField(session.model)
	);
}

export function formatTokenCount(
	inputTokens?: number,
	outputTokens?: number,
): string | null {
	const inCount = inputTokens ?? 0;
	const outCount = outputTokens ?? 0;
	const total = inCount + outCount;
	if (total <= 0) {
		return null;
	}
	if (total >= 1000) {
		return `${(total / 1000).toFixed(total >= 10000 ? 0 : 1)}k`;
	}
	return `${total}`;
}

export function formatCostUsd(value?: number): string | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	if (value < 0.01) {
		return `$${value.toFixed(4)}`;
	}
	if (value < 1) {
		return `$${value.toFixed(3)}`;
	}
	return `$${value.toFixed(2)}`;
}

function summarizeUsageFromMessages(messages: SessionMessage[]): {
	inputTokens: number;
	outputTokens: number;
	totalCostUsd: number;
} | null {
	let inputTokens = 0;
	let outputTokens = 0;
	let totalCostUsd = 0;
	let hasUsage = false;

	for (const message of messages) {
		const meta = message.meta;
		if (!meta) {
			continue;
		}
		if (typeof meta.inputTokens === "number") {
			inputTokens += meta.inputTokens;
			hasUsage = true;
		}
		if (typeof meta.outputTokens === "number") {
			outputTokens += meta.outputTokens;
			hasUsage = true;
		}
		if (typeof meta.totalCost === "number") {
			totalCostUsd += meta.totalCost;
			hasUsage = true;
		}
	}

	if (!hasUsage) {
		return null;
	}
	return { inputTokens, outputTokens, totalCostUsd };
}

function areSessionsEquivalent(
	current: SessionHistoryItem[],
	next: SessionHistoryItem[],
): boolean {
	if (current.length !== next.length) {
		return false;
	}
	for (let i = 0; i < current.length; i += 1) {
		const a = current[i];
		const b = next[i];
		if (
			a.sessionId !== b.sessionId ||
			getSessionSource(a) !== getSessionSource(b) ||
			a.status !== b.status ||
			a.startedAt !== b.startedAt ||
			a.endedAt !== b.endedAt ||
			a.prompt !== b.prompt ||
			getSessionMetadataIsScheduled(a.metadata) !==
				getSessionMetadataIsScheduled(b.metadata) ||
			getSessionMetadataGitBranch(a.metadata) !==
				getSessionMetadataGitBranch(b.metadata) ||
			getSessionMetadataTitle(a.metadata) !==
				getSessionMetadataTitle(b.metadata) ||
			getSessionMetadataPinned(a.metadata) !==
				getSessionMetadataPinned(b.metadata) ||
			a.workspaceRoot !== b.workspaceRoot ||
			a.cwd !== b.cwd ||
			a.provider !== b.provider ||
			a.model !== b.model
		) {
			return false;
		}
	}
	return true;
}

function areThreadsEquivalent(
	current: SessionThread[],
	next: SessionThread[],
): boolean {
	if (current.length !== next.length) {
		return false;
	}
	for (let i = 0; i < current.length; i += 1) {
		const a = current[i];
		const b = next[i];
		if (
			a.id !== b.id ||
			a.title !== b.title ||
			a.source !== b.source ||
			a.codebase !== b.codebase ||
			a.workspacePath !== b.workspacePath ||
			a.time !== b.time ||
			a.provider !== b.provider ||
			a.model !== b.model ||
			a.gitBranch !== b.gitBranch ||
			a.inputTokens !== b.inputTokens ||
			a.outputTokens !== b.outputTokens ||
			a.totalCostUsd !== b.totalCostUsd ||
			a.status !== b.status ||
			a.pinned !== b.pinned ||
			a.isScheduled !== b.isScheduled
		) {
			return false;
		}
	}
	return true;
}

function updateThreadById(
	current: SessionThread[],
	threadId: string,
	updater: (thread: SessionThread) => SessionThread,
): SessionThread[] {
	let changed = false;
	const next = current.map((thread) => {
		if (thread.id !== threadId) {
			return thread;
		}
		const updated = updater(thread);
		if (updated !== thread) {
			changed = true;
		}
		return updated;
	});
	return changed ? next : current;
}

function updateSessionById(
	current: SessionHistoryItem[],
	sessionId: string,
	updater: (session: SessionHistoryItem) => SessionHistoryItem,
): SessionHistoryItem[] {
	let changed = false;
	const next = current.map((session) => {
		if (session.sessionId !== sessionId) {
			return session;
		}
		const updated = updater(session);
		if (updated !== session) {
			changed = true;
		}
		return updated;
	});
	return changed ? next : current;
}

function mergeDiscoveredSessions(
	current: SessionHistoryItem[],
	discovered: SessionHistoryItem[],
): SessionHistoryItem[] {
	if (current.length === 0) {
		return discovered;
	}
	const currentById = new Map(
		current.map((session) => [session.sessionId, session]),
	);
	return discovered.map((session) => {
		const existing = currentById.get(session.sessionId);
		if (!existing) {
			return session;
		}
		const existingTitle = getSessionMetadataTitle(existing.metadata);
		if (!existingTitle) {
			return session;
		}
		const incomingTitle = getSessionMetadataTitle(session.metadata);
		if (incomingTitle === existingTitle) {
			return session;
		}
		return {
			...session,
			metadata: {
				...(session.metadata ?? {}),
				title: existingTitle,
			},
		};
	});
}

export function useSessionHistory({
	activeSessionId,
	onOpenSession,
	onDeleteSession,
	onUpdateSessionMetadata,
}: UseSessionHistoryOptions) {
	const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
	const [threads, setThreads] = useState<SessionThread[]>([]);
	// False until the backend has answered a history request at least once.
	// Consumers use this to tell "still loading" apart from "loaded, zero
	// sessions": an empty-state copy shown before the first response reads as
	// lost history whenever fetching takes more than an instant.
	const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [mayHaveMoreSessions, setMayHaveMoreSessions] = useState(false);
	const [pendingAction, setPendingAction] =
		useState<SessionPendingAction>(null);
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	// Session ids that schedule executions report as their own. Scheduled runs
	// executed by the local hub do not reliably carry the "hub-schedule"
	// origin trigger in their session metadata (the runtime that claims the
	// run doesn't always stamp provenance), so the metadata check alone would
	// miss them; the executions list is the authoritative link.
	const [scheduledSessionIds, setScheduledSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const fetchLimitRef = useRef(INITIAL_HISTORY_FETCH_LIMIT);
	// Limit of the most recent refresh that actually returned sessions. Failed
	// attempts roll back to this rather than to a caller-local snapshot, which
	// may itself name a batch that was never fetched.
	const loadedLimitRef = useRef(0);
	const mayHaveMoreSessionsRef = useRef(false);
	const usageLoadingRef = useRef<Set<string>>(new Set());
	const usageHydratedStatusRef = useRef<Map<string, SessionHistoryStatus>>(
		new Map(),
	);
	const titleLoadingRef = useRef<Set<string>>(new Set());
	const messageHydratedStatusRef = useRef<Map<string, SessionHistoryStatus>>(
		new Map(),
	);
	const sessionsRef = useRef<SessionHistoryItem[]>([]);
	const threadsRef = useRef<SessionThread[]>([]);
	const refreshTimeoutRef = useRef<number | null>(null);
	const scheduledRefreshAtRef = useRef<number | null>(null);
	const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
	const refreshLimitRef = useRef(0);
	const loadAllPromiseRef = useRef<Promise<boolean> | null>(null);
	const lastRefreshStartedAtRef = useRef(0);
	// Guards scheduleRefresh against continuations that settle after unmount
	// (e.g. the fast retry of a failed initial fetch), which would otherwise
	// re-arm a timer the cleanup has already cleared and poll forever.
	const disposedRef = useRef(false);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		threadsRef.current = threads;
	}, [threads]);

	useEffect(() => {
		if (!activeSessionId) {
			return;
		}
		setUnreadSessionIds((current) => {
			if (!current.has(activeSessionId)) {
				return current;
			}
			const next = new Set(current);
			next.delete(activeSessionId);
			return next;
		});
	}, [activeSessionId]);

	useEffect(() => {
		let cancelled = false;
		const collectScheduledSessionIds = async () => {
			const response = await desktopClient
				.invoke<{
					activeExecutions?: Array<{ sessionId?: unknown }>;
					lastExecutions?: Array<{ sessionId?: unknown }>;
				}>("list_routine_schedules")
				.catch(() => null);
			if (cancelled || !response) {
				return;
			}
			const ids = new Set<string>();
			for (const execution of [
				...(response.activeExecutions ?? []),
				...(response.lastExecutions ?? []),
			]) {
				const sessionId =
					typeof execution?.sessionId === "string"
						? execution.sessionId.trim()
						: "";
				if (sessionId) {
					ids.add(sessionId);
				}
			}
			setScheduledSessionIds((current) => {
				// Merge instead of replace: the executions list is a rolling
				// window, so ids that fell out of it are still scheduled runs.
				const next = new Set(current);
				for (const id of ids) {
					next.add(id);
				}
				return next.size === current.size ? current : next;
			});
		};
		void collectScheduledSessionIds();
		const interval = window.setInterval(
			() => void collectScheduledSessionIds(),
			2 * 60 * 1000,
		);
		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, []);

	const refreshSessions = useCallback(async () => {
		// Reuse an in-flight refresh only when it already asked for at least as
		// many sessions as we need now. "Load more" raises the limit and then
		// awaits a refresh; sharing a request that captured the smaller limit
		// would resolve without the larger batch ever being fetched.
		while (refreshPromiseRef.current) {
			const pending = refreshPromiseRef.current;
			if (refreshLimitRef.current >= fetchLimitRef.current) {
				return pending;
			}
			await pending;
		}

		const refreshPromise = (async (): Promise<boolean> => {
			lastRefreshStartedAtRef.current = Date.now();
			const limit = fetchLimitRef.current;
			refreshLimitRef.current = limit;
			try {
				const discovered = await desktopClient
					.invoke<CliDiscoveredSession[]>("list_discovered_sessions", { limit })
					.catch(() => null);
				// A rejected request is not an empty history. Treating it as one
				// would blank the list (the merge below is keyed off the response)
				// and mark the backend exhausted, hiding sessions that still exist
				// and disabling "load more" until some later poll happened to work.
				if (!Array.isArray(discovered)) {
					return false;
				}
				// Ask the raw response, not the filtered list: subagents and
				// sessions without a known model are dropped below, so a filtered
				// count under the limit does not mean the backend is exhausted.
				const hasMoreSessions = discovered.length >= limit;
				mayHaveMoreSessionsRef.current = hasMoreSessions;
				setMayHaveMoreSessions(hasMoreSessions);
				const topLevelSessions = discovered
					.map((session) => {
						const normalized: SessionHistoryItem = {
							...session,
							sessionId: String(session.sessionId ?? "").trim(),
							status: normalizeDiscoveredStatus(session.status, session.prompt),
							provider: session.provider || "",
							model: session.model || "",
							cwd: session.cwd || "",
							workspaceRoot: session.workspaceRoot || session.cwd || "",
							startedAt: String(session.startedAt ?? ""),
							metadata:
								session.metadata && typeof session.metadata === "object"
									? (session.metadata as SessionMetadata)
									: undefined,
						};
						return normalized;
					})
					.filter((session) => Boolean(session.sessionId))
					.filter(isValidHistorySession)
					.filter((session) => !session.isSubagent && !session.parentSessionId)
					.sort(compareSessionsByActivityDesc);
				const mergedSessions = mergeDiscoveredSessions(
					sessionsRef.current,
					topLevelSessions,
				);

				setSessions((current) =>
					areSessionsEquivalent(current, mergedSessions)
						? current
						: mergedSessions,
				);
				const mapped = mergedSessions.map(toThread);
				const metadataTitleById = new Map(
					mergedSessions.map((session) => [
						session.sessionId,
						getSessionMetadataTitle(session.metadata),
					]),
				);
				setThreads((current) => {
					const existingById = new Map(
						current.map((thread) => [thread.id, thread]),
					);
					const usageById = new Map(
						current.map((thread) => [
							thread.id,
							{
								inputTokens: thread.inputTokens,
								outputTokens: thread.outputTokens,
								totalCostUsd: thread.totalCostUsd,
							},
						]),
					);
					const next = mapped.map((thread) => {
						const existing = existingById.get(thread.id);
						const incomingMetadataTitle = metadataTitleById.get(thread.id);
						const keepExistingTitle =
							Boolean(existing) &&
							!incomingMetadataTitle &&
							!(existing?.title.startsWith("Session ") ?? true);
						return {
							...thread,
							title:
								keepExistingTitle && existing ? existing.title : thread.title,
							...usageById.get(thread.id),
						};
					});
					return areThreadsEquivalent(current, next) ? current : next;
				});
				loadedLimitRef.current = Math.max(loadedLimitRef.current, limit);
				setHasLoadedHistory(true);
				return true;
			} catch {
				// Ignore in browser mode or when tauri command is unavailable.
				return false;
			}
		})();

		refreshPromiseRef.current = refreshPromise;
		// Release the slot from the promise itself rather than from this caller,
		// so a waiter in the loop above always observes a cleared ref when it
		// resumes instead of spinning on a settled promise.
		refreshPromise.finally(() => {
			if (refreshPromiseRef.current === refreshPromise) {
				refreshPromiseRef.current = null;
			}
		});
		return await refreshPromise;
	}, []);

	const scheduleRefresh = useCallback(
		(delayMs = 0, options: { force?: boolean } = {}) => {
			if (disposedRef.current) {
				return;
			}
			const now = Date.now();
			const minTarget = options.force
				? now
				: lastRefreshStartedAtRef.current +
					MIN_EVENT_HISTORY_REFRESH_INTERVAL_MS;
			const target = Math.max(now + delayMs, minTarget);
			if (
				refreshTimeoutRef.current !== null &&
				scheduledRefreshAtRef.current !== null &&
				scheduledRefreshAtRef.current <= target
			) {
				return;
			}
			if (refreshTimeoutRef.current !== null) {
				window.clearTimeout(refreshTimeoutRef.current);
			}
			scheduledRefreshAtRef.current = target;
			refreshTimeoutRef.current = window.setTimeout(
				() => {
					refreshTimeoutRef.current = null;
					scheduledRefreshAtRef.current = null;
					void refreshSessions().then((loaded) => {
						// Until something has loaded the UI has nothing but a
						// loading state to show, so a failed fetch (e.g. the
						// websocket losing the race with a webview reload) retries
						// on the short event cadence instead of stranding the
						// sidebar until the periodic poll fires.
						if (!loaded && loadedLimitRef.current === 0) {
							scheduleRefresh(MIN_EVENT_HISTORY_REFRESH_INTERVAL_MS);
						}
					});
				},
				Math.max(0, target - now),
			);
		},
		[refreshSessions],
	);

	useEffect(() => {
		let disposed = false;
		disposedRef.current = false;

		const runRefresh = () => {
			if (!disposed) {
				scheduleRefresh(0, { force: true });
			}
		};

		runRefresh();
		const interval = window.setInterval(() => {
			if (document.hidden) {
				return;
			}
			runRefresh();
		}, HISTORY_REFRESH_INTERVAL_MS);

		return () => {
			disposed = true;
			disposedRef.current = true;
			window.clearInterval(interval);
			if (refreshTimeoutRef.current !== null) {
				window.clearTimeout(refreshTimeoutRef.current);
				refreshTimeoutRef.current = null;
				scheduledRefreshAtRef.current = null;
			}
		};
	}, [scheduleRefresh]);

	useEffect(() => {
		const recent = sessions
			.filter((session) => session.sessionId !== activeSessionId)
			.slice(0, 4);
		let cancelled = false;
		const timer = window.setTimeout(() => {
			for (const session of recent) {
				if (cancelled) {
					return;
				}
				const sessionId = session.sessionId;
				if (!sessionId) {
					continue;
				}
				if (usageLoadingRef.current.has(sessionId)) {
					continue;
				}
				const existing = threadsRef.current.find(
					(item) => item.id === sessionId,
				);
				const hasUsage =
					existing?.inputTokens !== undefined ||
					existing?.outputTokens !== undefined;
				const lastHydratedStatus =
					usageHydratedStatusRef.current.get(sessionId);
				const shouldFetch =
					!hasUsage ||
					session.status === "running" ||
					lastHydratedStatus !== session.status;
				if (!shouldFetch) {
					continue;
				}
				usageLoadingRef.current.add(sessionId);
				void desktopClient
					.invoke<SessionMessage[]>("read_session_messages", {
						sessionId,
						maxMessages: 1200,
					})
					.then(async (sessionMessages) => {
						const usage = summarizeUsageFromMessages(sessionMessages);
						if (!usage) {
							const events = await desktopClient.invoke<SessionHookEvent[]>(
								"read_session_hooks",
								{
									sessionId,
									limit: 1200,
								},
							);
							return {
								inputTokens: events.reduce(
									(sum, event) => sum + (event.inputTokens ?? 0),
									0,
								),
								outputTokens: events.reduce(
									(sum, event) => sum + (event.outputTokens ?? 0),
									0,
								),
								totalCostUsd: events.reduce(
									(sum, event) => sum + (event.totalCost ?? 0),
									0,
								),
							};
						}
						return usage;
					})
					.then(({ inputTokens, outputTokens, totalCostUsd }) => {
						setThreads((current) =>
							updateThreadById(current, sessionId, (thread) => {
								if (
									thread.inputTokens === inputTokens &&
									thread.outputTokens === outputTokens &&
									thread.totalCostUsd === totalCostUsd
								) {
									return thread;
								}
								return { ...thread, inputTokens, outputTokens, totalCostUsd };
							}),
						);
					})
					.catch(() => {
						if (!hasUsage) {
							setThreads((current) =>
								updateThreadById(current, sessionId, (thread) => {
									if (
										thread.inputTokens === 0 &&
										thread.outputTokens === 0 &&
										(thread.totalCostUsd ?? 0) === 0
									) {
										return thread;
									}
									return {
										...thread,
										inputTokens: 0,
										outputTokens: 0,
										totalCostUsd: 0,
									};
								}),
							);
						}
					})
					.finally(() => {
						usageHydratedStatusRef.current.set(sessionId, session.status);
						usageLoadingRef.current.delete(sessionId);
					});
			}
		}, 800);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [activeSessionId, sessions]);

	useEffect(() => {
		const handleTitleUpdated = (event: Event) => {
			const detail = (event as SessionTitleUpdatedEvent).detail;
			const sessionId = detail?.sessionId?.trim();
			if (!sessionId) {
				return;
			}
			const nextTitle = detail.title.trim();
			setSessions((current) =>
				updateSessionById(current, sessionId, (session) => ({
					...session,
					metadata: {
						...(session.metadata ?? {}),
						title: nextTitle || undefined,
					},
				})),
			);
			setThreads((current) =>
				updateThreadById(current, sessionId, (thread) => ({
					...thread,
					title: nextTitle || `Session ${sessionId.slice(-6)}`,
				})),
			);
		};

		const handleSessionDeleted = (event: Event) => {
			const detail = (event as SessionDeletedEvent).detail;
			const sessionId = detail?.sessionId?.trim();
			if (!sessionId) {
				return;
			}
			usageLoadingRef.current.delete(sessionId);
			titleLoadingRef.current.delete(sessionId);
			usageHydratedStatusRef.current.delete(sessionId);
			messageHydratedStatusRef.current.delete(sessionId);
			setSessions((current) =>
				current.filter((session) => session.sessionId !== sessionId),
			);
			setThreads((current) =>
				current.filter((thread) => thread.id !== sessionId),
			);
			scheduleRefresh(HISTORY_FAST_REFRESH_DELAY_MS, { force: true });
		};

		window.addEventListener(
			"cline:session-title-updated",
			handleTitleUpdated as EventListener,
		);
		window.addEventListener(
			"cline:session-deleted",
			handleSessionDeleted as EventListener,
		);
		const unsubscribeTransportDelete = desktopClient.subscribe(
			"session_deleted",
			(payload) => {
				if (!payload || typeof payload !== "object") {
					return;
				}
				const sessionId =
					typeof (payload as { sessionId?: unknown }).sessionId === "string"
						? (payload as { sessionId: string }).sessionId.trim()
						: "";
				if (!sessionId) {
					return;
				}
				handleSessionDeleted(
					new CustomEvent("cline:session-deleted", {
						detail: { sessionId },
					}),
				);
			},
		);
		const unsubscribeTransportStatus = desktopClient.subscribe(
			"chat_session_status",
			(payload) => {
				if (!payload || typeof payload !== "object") {
					return;
				}
				const record = payload as SidecarSessionStateEvent;
				const sessionId = record.sessionId?.trim();
				if (!sessionId) {
					return;
				}
				const known = sessionsRef.current.some(
					(session) => session.sessionId === sessionId,
				);
				const status = normalizeDiscoveredStatus(record.status);
				if (!known) {
					scheduleRefresh(HISTORY_EVENT_REFRESH_DELAY_MS);
				} else if (isTerminalHistoryStatus(status)) {
					scheduleRefresh(HISTORY_TERMINAL_REFRESH_DELAY_MS, {
						force: true,
					});
				}
				if (sessionId !== activeSessionId) {
					setUnreadSessionIds((current) => {
						const next = new Set(current);
						next.add(sessionId);
						return next;
					});
				}
			},
		);
		const unsubscribeTransportEnded = desktopClient.subscribe(
			"chat_session_ended",
			(payload) => {
				if (!payload || typeof payload !== "object") {
					return;
				}
				const record = payload as SidecarSessionStateEvent;
				if (record.sessionId?.trim()) {
					scheduleRefresh(HISTORY_TERMINAL_REFRESH_DELAY_MS, {
						force: true,
					});
					const sessionId = record.sessionId.trim();
					if (sessionId !== activeSessionId) {
						setUnreadSessionIds((current) => {
							const next = new Set(current);
							next.add(sessionId);
							return next;
						});
					}
				}
			},
		);
		const unsubscribeTransportChatEvent = desktopClient.subscribe(
			"chat_event",
			(payload) => {
				if (!payload || typeof payload !== "object") {
					return;
				}
				const record = payload as SidecarChatEvent;
				const sessionId = record.sessionId?.trim();
				if (!sessionId) {
					return;
				}
				const known = sessionsRef.current.some(
					(session) => session.sessionId === sessionId,
				);
				if (!known) {
					scheduleRefresh(HISTORY_EVENT_REFRESH_DELAY_MS);
				}
				if (sessionId !== activeSessionId) {
					setUnreadSessionIds((current) => {
						const next = new Set(current);
						next.add(sessionId);
						return next;
					});
				}
			},
		);
		return () => {
			window.removeEventListener(
				"cline:session-title-updated",
				handleTitleUpdated as EventListener,
			);
			window.removeEventListener(
				"cline:session-deleted",
				handleSessionDeleted as EventListener,
			);
			unsubscribeTransportDelete();
			unsubscribeTransportStatus();
			unsubscribeTransportEnded();
			unsubscribeTransportChatEvent();
		};
	}, [activeSessionId, scheduleRefresh]);

	useEffect(() => {
		const recent = sessions
			.filter((session) => session.sessionId !== activeSessionId)
			.slice(0, 4);
		let cancelled = false;
		const timer = window.setTimeout(() => {
			for (const session of recent) {
				if (cancelled) {
					return;
				}
				const sessionId = session.sessionId;
				if (!sessionId) {
					continue;
				}
				if (titleLoadingRef.current.has(sessionId)) {
					continue;
				}
				const existing = threadsRef.current.find(
					(item) => item.id === sessionId,
				);
				if (!existing) {
					continue;
				}
				const lastHydratedStatus =
					messageHydratedStatusRef.current.get(sessionId);
				const shouldHydrateTitle = existing.title.startsWith("Session ");
				const hasManualTitle = Boolean(
					getSessionMetadataTitle(session.metadata),
				);
				const shouldHydrateStatus =
					existing.status === "failed" ||
					existing.status === "completed" ||
					existing.status === "idle" ||
					lastHydratedStatus !== session.status;
				if ((!shouldHydrateTitle || hasManualTitle) && !shouldHydrateStatus) {
					continue;
				}
				titleLoadingRef.current.add(sessionId);
				void desktopClient
					.invoke<SessionMessage[]>("read_session_messages", {
						sessionId,
						maxMessages: 80,
					})
					.then((messages) => {
						const nextTitle = hasManualTitle
							? null
							: titleFromMessages(messages);
						setThreads((current) =>
							updateThreadById(current, sessionId, (thread) => {
								const nextStatus = inferStatusFromMessages(
									thread.status,
									messages,
								);
								const title = nextTitle ?? thread.title;
								if (title === thread.title && nextStatus === thread.status) {
									return thread;
								}
								return { ...thread, title, status: nextStatus };
							}),
						);
						setSessions((current) =>
							updateSessionById(current, sessionId, (item) => {
								const nextStatus = inferStatusFromMessages(
									item.status,
									messages,
								);
								if (nextStatus === item.status) {
									return item;
								}
								return { ...item, status: nextStatus };
							}),
						);
					})
					.catch(() => {
						// Ignore sessions that cannot be hydrated.
					})
					.finally(() => {
						messageHydratedStatusRef.current.set(sessionId, session.status);
						titleLoadingRef.current.delete(sessionId);
					});
			}
		}, 1200);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [activeSessionId, sessions]);

	const getSessionByThreadId = useCallback(
		(threadId: string) =>
			sessionsRef.current.find((session) => session.sessionId === threadId),
		[],
	);

	const openThread = useCallback(
		(threadId: string) => {
			const session = getSessionByThreadId(threadId);
			if (session) {
				setUnreadSessionIds((current) => {
					if (!current.has(threadId)) {
						return current;
					}
					const next = new Set(current);
					next.delete(threadId);
					return next;
				});
				onOpenSession?.(session);
			}
		},
		[getSessionByThreadId, onOpenSession],
	);

	const renameThread = useCallback(
		async (threadId: string, title: string) => {
			if (pendingAction?.action === "rename") {
				return false;
			}
			const thread = threadsRef.current.find((item) => item.id === threadId);
			const currentTitle = normalizeTitle(thread?.title ?? "");
			const normalizedTitle = normalizeTitle(title).trim();
			if (normalizedTitle === currentTitle) {
				return true;
			}
			setPendingAction({ sessionId: threadId, action: "rename" });
			try {
				await desktopClient.invoke("update_chat_session_title", {
					sessionId: threadId,
					title: normalizedTitle,
				});
				const sourceSession = getSessionByThreadId(threadId);
				const metadata = {
					...(sourceSession?.metadata ?? {}),
					title: normalizedTitle || undefined,
				};
				onUpdateSessionMetadata?.(threadId, metadata);
				window.dispatchEvent(
					new CustomEvent("cline:session-title-updated", {
						detail: {
							sessionId: threadId,
							title: normalizedTitle,
						},
					}),
				);
				return true;
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Rename failed",
					description:
						error instanceof Error
							? error.message
							: "The session title could not be updated.",
				});
				return false;
			} finally {
				setPendingAction(null);
			}
		},
		[getSessionByThreadId, onUpdateSessionMetadata, pendingAction],
	);

	const setThreadPinned = useCallback(
		async (threadId: string, pinned: boolean) => {
			const applyPinned = (next: boolean) => {
				setThreads((current) =>
					updateThreadById(current, threadId, (thread) =>
						thread.pinned === next ? thread : { ...thread, pinned: next },
					),
				);
				setSessions((current) =>
					updateSessionById(current, threadId, (session) => ({
						...session,
						metadata: {
							...(session.metadata ?? {}),
							[PINNED_METADATA_KEY]: next || undefined,
						},
					})),
				);
			};

			// Pinning is a single click, so apply it locally first and roll back
			// if the write fails rather than blocking the row on a round trip.
			applyPinned(pinned);
			try {
				await desktopClient.invoke("update_chat_session_metadata", {
					sessionId: threadId,
					metadata: { [PINNED_METADATA_KEY]: pinned ? true : null },
				});
				const sourceSession = getSessionByThreadId(threadId);
				onUpdateSessionMetadata?.(threadId, {
					...(sourceSession?.metadata ?? {}),
					[PINNED_METADATA_KEY]: pinned || undefined,
				});
				scheduleRefresh(HISTORY_FAST_REFRESH_DELAY_MS);
				return true;
			} catch (error) {
				applyPinned(!pinned);
				toast({
					variant: "destructive",
					title: pinned ? "Pin failed" : "Unpin failed",
					description:
						error instanceof Error
							? error.message
							: "The session could not be updated.",
				});
				return false;
			}
		},
		[getSessionByThreadId, onUpdateSessionMetadata, scheduleRefresh],
	);

	const forkThread = useCallback(
		async (threadId: string) => {
			const thread = threadsRef.current.find((item) => item.id === threadId);
			if (!thread) {
				return false;
			}
			const sourceSession = getSessionByThreadId(threadId);
			setPendingAction({ sessionId: threadId, action: "fork" });
			try {
				const payload = await desktopClient.invoke<{
					sessionId?: string;
					forkedFromSessionId?: string;
				}>("chat_session_command", {
					request: {
						action: "fork",
						sessionId: threadId,
						config: {
							provider: sourceSession?.provider || thread.provider,
							model: sourceSession?.model || thread.model,
							cwd: sourceSession?.cwd || sourceSession?.workspaceRoot || "",
							workspaceRoot:
								sourceSession?.workspaceRoot || sourceSession?.cwd || "",
						},
					},
				});
				const newSessionId = payload.sessionId?.trim();
				if (!newSessionId) {
					throw new Error("Fork did not return a new session id.");
				}
				const forkedSession: SessionHistoryItem = {
					sessionId: newSessionId,
					status: "completed",
					provider: sourceSession?.provider || thread.provider,
					model: sourceSession?.model || thread.model,
					cwd: sourceSession?.cwd || "",
					workspaceRoot:
						sourceSession?.workspaceRoot || sourceSession?.cwd || "",
					startedAt: new Date().toISOString(),
					metadata: {
						fork: {
							forkedFromSessionId: payload.forkedFromSessionId || threadId,
							forkedAt: new Date().toISOString(),
						},
					},
				};
				scheduleRefresh(HISTORY_FAST_REFRESH_DELAY_MS);
				onOpenSession?.(forkedSession);
				return true;
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Fork failed",
					description:
						error instanceof Error
							? error.message
							: "The session could not be forked.",
				});
				return false;
			} finally {
				setPendingAction(null);
			}
		},
		[getSessionByThreadId, onOpenSession, scheduleRefresh],
	);

	const deleteThread = useCallback(
		async (threadId: string) => {
			setPendingAction({ sessionId: threadId, action: "delete" });
			try {
				const deleteResult = await desktopClient.invoke<
					boolean | { deleted?: boolean }
				>("delete_chat_session", {
					sessionId: threadId,
				});
				const deleted =
					typeof deleteResult === "boolean"
						? deleteResult
						: deleteResult.deleted === true;
				if (!deleted) {
					throw new Error(
						"The session could not be removed from local history.",
					);
				}
				onDeleteSession?.(threadId);
				window.dispatchEvent(
					new CustomEvent("cline:session-deleted", {
						detail: {
							sessionId: threadId,
						},
					}),
				);
				return true;
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Delete failed",
					description:
						error instanceof Error
							? error.message
							: "The session could not be removed from local history.",
				});
				return false;
			} finally {
				setPendingAction(null);
			}
		},
		[onDeleteSession],
	);

	const loadMoreSessions = useCallback(
		async (nextLimit: number) => {
			if (loadedLimitRef.current >= nextLimit) {
				return true;
			}
			const requestedLimit = Math.max(fetchLimitRef.current, nextLimit);
			fetchLimitRef.current = requestedLimit;
			setIsLoadingMore(true);
			try {
				const loaded = await refreshSessions();
				// Roll back to what was last fetched so a retry asks for this batch
				// again instead of skipping past it — but only when no overlapping
				// call has raised the limit further in the meantime, since lowering
				// it would make that call fetch a smaller batch than it asked for
				// and still report success.
				if (!loaded && fetchLimitRef.current === requestedLimit) {
					fetchLimitRef.current = loadedLimitRef.current;
				}
				if (!loaded) {
					toast({
						variant: "destructive",
						title: "Could not load more sessions",
						description: "Session history is unavailable right now.",
					});
				}
				return loaded;
			} finally {
				setIsLoadingMore(false);
			}
		},
		[refreshSessions],
	);
	const loadOlderSessions = useCallback(
		() => loadMoreSessions(fetchLimitRef.current + INITIAL_HISTORY_FETCH_LIMIT),
		[loadMoreSessions],
	);
	const loadAllSessions = useCallback(() => {
		if (loadAllPromiseRef.current) {
			return loadAllPromiseRef.current;
		}
		const loadAllPromise = (async () => {
			// A global search, filter, or oldest-first sort can be selected while
			// the mount request is still in flight. Wait for that request before
			// deciding whether there is any older history to fetch.
			if (loadedLimitRef.current === 0 && !(await refreshSessions())) {
				return false;
			}
			// Grow exponentially so complete-history operations need only
			// logarithmically many requests while ordinary paging stays in
			// predictable 50-session increments.
			while (mayHaveMoreSessionsRef.current) {
				const currentLimit = Math.max(
					fetchLimitRef.current,
					loadedLimitRef.current,
					INITIAL_HISTORY_FETCH_LIMIT,
				);
				const nextLimit = Math.max(
					currentLimit + INITIAL_HISTORY_FETCH_LIMIT,
					currentLimit * 2,
				);
				if (!(await loadMoreSessions(nextLimit))) {
					return false;
				}
			}
			return true;
		})();
		loadAllPromiseRef.current = loadAllPromise;
		loadAllPromise.finally(() => {
			if (loadAllPromiseRef.current === loadAllPromise) {
				loadAllPromiseRef.current = null;
			}
		});
		return loadAllPromise;
	}, [loadMoreSessions, refreshSessions]);

	const sessionById = useMemo(
		() => new Map(sessions.map((session) => [session.sessionId, session])),
		[sessions],
	);

	const threadsWithScheduled = useMemo(() => {
		if (scheduledSessionIds.size === 0) {
			return threads;
		}
		return threads.map((thread) =>
			!thread.isScheduled && scheduledSessionIds.has(thread.id)
				? { ...thread, isScheduled: true }
				: thread,
		);
	}, [scheduledSessionIds, threads]);

	return {
		getSessionByThreadId,
		hasLoadedHistory,
		isLoadingMore,
		loadAllSessions,
		loadOlderSessions,
		loadMoreSessions,
		mayHaveMoreSessions,
		openThread,
		pendingAction,
		refreshSessions,
		renameThread,
		setThreadPinned,
		deleteThread,
		forkThread,
		sessionById,
		sessions,
		threads: threadsWithScheduled,
		unreadSessionIds,
	};
}

export type UseSessionHistoryResult = ReturnType<typeof useSessionHistory>;
