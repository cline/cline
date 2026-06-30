"use client";

import {
	ChevronDown,
	Filter,
	GitFork,
	Loader2,
	MessageSquare,
	PanelLeftOpen,
	Pencil,
	Plus,
	Search,
	Settings,
	Trash2,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSidebar } from "@/components/ui/sidebar";
import { normalizeTitle } from "@/components/utils";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type {
	SessionHistoryItem,
	SessionHistoryStatus,
	SessionMetadata,
} from "@/lib/session-history";
import { getSessionMetadataTitle } from "@/lib/session-history";
import { cn } from "@/lib/utils";

type CliDiscoveredSession = Omit<SessionHistoryItem, "status"> & {
	status: string;
};

interface Thread {
	id: string;
	title: string;
	codebase: string;
	time: string;
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCostUsd?: number;
	status: SessionHistoryStatus;
	pinned?: boolean;
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

const filterOptions = ["All", "Running", "Recent", "Pinned"] as const;
type FilterOption = (typeof filterOptions)[number];
const INITIAL_HISTORY_FETCH_LIMIT = 300;
const INITIAL_VISIBLE_THREAD_COUNT = 10;

function parseTimestamp(value?: string): number {
	if (!value) return Number.NEGATIVE_INFINITY;
	const trimmed = value.trim();
	const maybeEpoch = Number(trimmed);
	if (Number.isFinite(maybeEpoch)) {
		// Treat 10-digit epochs as seconds; 13-digit as milliseconds.
		if (/^\d{10}$/.test(trimmed)) {
			return maybeEpoch * 1000;
		}
		return maybeEpoch;
	}
	const parsed = new Date(trimmed).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareSessionsByStartedAtDesc(
	a: SessionHistoryItem,
	b: SessionHistoryItem,
): number {
	const timeDelta = parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt);
	if (timeDelta !== 0) {
		return timeDelta;
	}
	return b.sessionId.localeCompare(a.sessionId);
}

function normalizeDiscoveredStatus(
	status?: string,
	prompt?: string,
): SessionHistoryStatus {
	const normalized = (status || "").toLowerCase();
	const hasPrompt = Boolean(prompt?.trim());
	if (normalized.includes("complete") || normalized.includes("done"))
		return "completed";
	if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("interrupt")
	)
		return "cancelled";
	if (normalized.includes("fail") || normalized.includes("error"))
		return "failed";
	if (normalized.includes("run") || normalized.includes("start"))
		return hasPrompt ? "running" : "idle";
	if (normalized === "idle") return "idle";
	return "idle";
}

function formatRelativeTime(value?: string): string {
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

function basenamePath(input?: string): string {
	if (!input) return "workspace";
	const trimmed = input.replace(/[\\/]+$/, "");
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || "workspace";
}

function toTitle(session: SessionHistoryItem): string {
	const metadataTitle = getSessionMetadataTitle(session.metadata);
	if (metadataTitle) {
		return metadataTitle.slice(0, 70);
	}
	const line = normalizeTitle(session.prompt).trim().split("\n")[0]?.trim();
	if (line) return line.slice(0, 70);
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
				return line.slice(0, 70);
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

function toThread(session: SessionHistoryItem): Thread {
	return {
		id: session.sessionId,
		title: toTitle(session),
		codebase: basenamePath(session.workspaceRoot || session.cwd),
		time: formatRelativeTime(session.endedAt || session.startedAt),
		provider: session.provider || "",
		model: session.model || "",
		status: normalizeDiscoveredStatus(session.status, session.prompt),
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

function formatTokenCount(
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

function formatCostUsd(value?: number): string | null {
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
			a.status !== b.status ||
			a.startedAt !== b.startedAt ||
			a.endedAt !== b.endedAt ||
			a.prompt !== b.prompt ||
			getSessionMetadataTitle(a.metadata) !==
				getSessionMetadataTitle(b.metadata) ||
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

function areThreadsEquivalent(current: Thread[], next: Thread[]): boolean {
	if (current.length !== next.length) {
		return false;
	}
	for (let i = 0; i < current.length; i += 1) {
		const a = current[i];
		const b = next[i];
		if (
			a.id !== b.id ||
			a.title !== b.title ||
			a.codebase !== b.codebase ||
			a.time !== b.time ||
			a.provider !== b.provider ||
			a.model !== b.model ||
			a.inputTokens !== b.inputTokens ||
			a.outputTokens !== b.outputTokens ||
			a.totalCostUsd !== b.totalCostUsd ||
			a.status !== b.status ||
			a.pinned !== b.pinned
		) {
			return false;
		}
	}
	return true;
}

function updateThreadById(
	current: Thread[],
	threadId: string,
	updater: (thread: Thread) => Thread,
): Thread[] {
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

export function AgentSidebar({
	onNewThread,
	onOpenSession,
	setView,
	activeSessionId,
}: {
	onNewThread?: () => void;
	onOpenSession?: (session: SessionHistoryItem) => void;
	setView: (view: "chat" | "settings") => void;
	activeSessionId?: string | null;
}) {
	const { isMobile, setOpen, state } = useSidebar();
	const isCollapsed = !isMobile && state === "collapsed";
	const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
	const [threads, setThreads] = useState<Thread[]>([]);
	const activeThread = activeSessionId ?? "";
	const [filter, setFilter] = useState<FilterOption>("All");
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [showMoreCount, setShowMoreCount] = useState(
		INITIAL_VISIBLE_THREAD_COUNT,
	);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [pendingAction, setPendingAction] = useState<{
		sessionId: string;
		action: "rename" | "fork" | "delete";
	} | null>(null);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [deleteConfirmThread, setDeleteConfirmThread] = useState<Thread | null>(
		null,
	);
	const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(
		() => new Set(),
	);
	const fetchLimitRef = useRef(INITIAL_HISTORY_FETCH_LIMIT);
	const usageLoadingRef = useRef<Set<string>>(new Set());
	const usageHydratedStatusRef = useRef<Map<string, SessionHistoryStatus>>(
		new Map(),
	);
	const titleLoadingRef = useRef<Set<string>>(new Set());
	const messageHydratedStatusRef = useRef<Map<string, SessionHistoryStatus>>(
		new Map(),
	);
	const sessionsRef = useRef<SessionHistoryItem[]>([]);
	const threadsRef = useRef<Thread[]>([]);
	const refreshTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		sessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		threadsRef.current = threads;
	}, [threads]);

	useEffect(() => {
		if (isCollapsed && searchOpen) {
			setSearchOpen(false);
		}
	}, [isCollapsed, searchOpen]);

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

	const refreshSessions = useCallback(async () => {
		const limit = fetchLimitRef.current;
		setIsLoadingHistory(true);
		try {
			const discovered = await desktopClient
				.invoke<CliDiscoveredSession[]>("list_discovered_sessions", { limit })
				.catch(() => []);
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
				.sort(compareSessionsByStartedAtDesc);
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
		} catch {
			// Ignore in browser mode or when tauri command is unavailable.
		} finally {
			setIsLoadingHistory(false);
		}
	}, []);

	const scheduleRefresh = useCallback(
		(delayMs = 0) => {
			if (refreshTimeoutRef.current !== null) {
				window.clearTimeout(refreshTimeoutRef.current);
			}
			refreshTimeoutRef.current = window.setTimeout(() => {
				refreshTimeoutRef.current = null;
				void refreshSessions();
			}, delayMs);
		},
		[refreshSessions],
	);

	useEffect(() => {
		let disposed = false;

		const runRefresh = () => {
			if (!disposed) {
				scheduleRefresh();
			}
		};

		runRefresh();
		const interval = window.setInterval(() => {
			if (document.hidden) {
				return;
			}
			runRefresh();
		}, 12000);

		return () => {
			disposed = true;
			window.clearInterval(interval);
			if (refreshTimeoutRef.current !== null) {
				window.clearTimeout(refreshTimeoutRef.current);
				refreshTimeoutRef.current = null;
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
			scheduleRefresh(50);
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
				if (
					!known ||
					record.status === "running" ||
					record.status === "starting" ||
					record.status === "idle"
				) {
					scheduleRefresh(50);
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
					scheduleRefresh(50);
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
					scheduleRefresh(50);
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

	const filteredThreads = useMemo(() => {
		let filtered = threads;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(t) =>
					t.title.toLowerCase().includes(q) ||
					t.codebase.toLowerCase().includes(q),
			);
		}
		switch (filter) {
			case "Running":
				return filtered.filter((t) => t.status === "running");
			case "Recent":
				return filtered.slice(0, 8);
			case "Pinned":
				return filtered.filter((t) => t.pinned);
			default:
				return filtered;
		}
	}, [filter, searchQuery, threads]);

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

	const openNewThread = useCallback(() => {
		setView("chat");
		onNewThread?.();
	}, [onNewThread, setView]);

	const startRenameThread = useCallback((thread: Thread) => {
		setEditingSessionId(thread.id);
		setEditingTitle(normalizeTitle(thread.title));
	}, []);

	const cancelRenameThread = useCallback(() => {
		setEditingSessionId(null);
		setEditingTitle("");
	}, []);

	const commitRenameThread = useCallback(
		async (thread: Thread) => {
			if (pendingAction?.action === "rename") {
				return;
			}
			const currentTitle = normalizeTitle(thread.title);
			const normalizedTitle = normalizeTitle(editingTitle).trim();
			if (normalizedTitle === currentTitle) {
				cancelRenameThread();
				return;
			}
			setPendingAction({ sessionId: thread.id, action: "rename" });
			try {
				await desktopClient.invoke("update_chat_session_title", {
					sessionId: thread.id,
					title: normalizedTitle,
				});
				window.dispatchEvent(
					new CustomEvent("cline:session-title-updated", {
						detail: {
							sessionId: thread.id,
							title: normalizedTitle,
						},
					}),
				);
				cancelRenameThread();
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Rename failed",
					description:
						error instanceof Error
							? error.message
							: "The session title could not be updated.",
				});
			} finally {
				setPendingAction(null);
			}
		},
		[cancelRenameThread, editingTitle, pendingAction],
	);

	const forkThread = useCallback(
		async (thread: Thread) => {
			const sourceSession = getSessionByThreadId(thread.id);
			setPendingAction({ sessionId: thread.id, action: "fork" });
			try {
				const payload = await desktopClient.invoke<{
					sessionId?: string;
					forkedFromSessionId?: string;
				}>("chat_session_command", {
					request: {
						action: "fork",
						sessionId: thread.id,
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
							forkedFromSessionId: payload.forkedFromSessionId || thread.id,
							forkedAt: new Date().toISOString(),
						},
					},
				};
				scheduleRefresh(50);
				onOpenSession?.(forkedSession);
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Fork failed",
					description:
						error instanceof Error
							? error.message
							: "The session could not be forked.",
				});
			} finally {
				setPendingAction(null);
			}
		},
		[getSessionByThreadId, onOpenSession, scheduleRefresh],
	);

	const requestDeleteThread = useCallback((thread: Thread) => {
		setDeleteConfirmThread(thread);
	}, []);

	const deleteThread = useCallback(async (thread: Thread) => {
		setPendingAction({ sessionId: thread.id, action: "delete" });
		try {
			console.error(
				`[webview:delete] invoke delete_chat_session sessionId=${thread.id}`,
			);
			const deleteResult = await desktopClient.invoke<
				boolean | { deleted?: boolean }
			>("delete_chat_session", {
				sessionId: thread.id,
			});
			const deleted =
				typeof deleteResult === "boolean"
					? deleteResult
					: deleteResult.deleted === true;
			console.error(
				`[webview:delete] invoke result sessionId=${thread.id} deleted=${deleted}`,
			);
			if (!deleted) {
				throw new Error("The session could not be removed from local history.");
			}
			window.dispatchEvent(
				new CustomEvent("cline:session-deleted", {
					detail: {
						sessionId: thread.id,
					},
				}),
			);
		} catch (error) {
			toast({
				variant: "destructive",
				title: "Delete failed",
				description:
					error instanceof Error
						? error.message
						: "The session could not be removed from local history.",
			});
		} finally {
			setDeleteConfirmThread(null);
			setPendingAction(null);
		}
	}, []);

	const pinnedThreads = useMemo(
		() => filteredThreads.filter((t) => t.pinned),
		[filteredThreads],
	);
	const sessionThreads = useMemo(
		() => filteredThreads.filter((t) => !t.pinned),
		[filteredThreads],
	);
	const displayedThreads =
		filter === "All" ? null : filteredThreads.slice(0, showMoreCount);
	// Show "Show more" if there are more to display locally, or if the backend
	// might have more (total fetched sessions reached the fetch limit).
	const mayHaveMoreSessions = sessions.length >= fetchLimitRef.current;
	const showShowMore =
		sessionThreads.length > showMoreCount || mayHaveMoreSessions;

	const filterMenu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Filter sessions"
					className="inline-flex size-6 items-center justify-center rounded-md m-0! p-0! text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
					variant="ghost"
					size="icon"
				>
					<Filter className="size-3 stroke-2" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36">
				<DropdownMenuRadioGroup
					onValueChange={(value) => {
						setFilter(value as FilterOption);
						setShowMoreCount(INITIAL_VISIBLE_THREAD_COUNT);
					}}
					value={filter}
				>
					{filterOptions.map((opt) => (
						<DropdownMenuRadioItem key={opt} value={opt}>
							{opt}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<>
			<div className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
				<div className="mt-2 flex w-full min-w-0 flex-col gap-1">
					<Button
						className={cn(
							"justify-start min-w-0",
							isCollapsed && "mx-auto size-9 justify-center px-0",
						)}
						aria-label="New Session"
						onClick={openNewThread}
						title="New Session"
						variant="sidebar"
					>
						{isCollapsed ? (
							<MessageSquare className="size-4" />
						) : (
							<Plus className="size-4" />
						)}
						{!isCollapsed ? "New Session" : null}
					</Button>
					{isCollapsed ? (
						<Button
							aria-label="Expand sidebar"
							className="mx-auto size-9 justify-center px-0"
							onClick={() => setOpen(true)}
							title="Expand sidebar"
							type="button"
							variant="sidebar"
						>
							<PanelLeftOpen className="size-4" />
						</Button>
					) : null}
				</div>

				{!isCollapsed ? (
					<div className="flex w-full min-w-0 flex-col gap-1">
						{searchOpen ? (
							<div className="flex min-w-0 items-center gap-2 overflow-hidden rounded-md bg-sidebar-accent px-2 py-1.5">
								<Search className="size-4 shrink-0" />
								<Input
									className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-muted-foreground"
									onBlur={() => {
										if (!searchQuery) setSearchOpen(false);
									}}
									autoFocus={true}
									onChange={(e) => setSearchQuery(e.target.value)}
									placeholder="Search sessions..."
									value={searchQuery}
								/>
							</div>
						) : (
							<Button
								className="py-1.5 min-w-0"
								onClick={() => setSearchOpen(true)}
								title="Search sessions"
								type="button"
								variant="sidebarItem"
							>
								<Search className="size-4 shrink-0" />
								<span>Search</span>
							</Button>
						)}
					</div>
				) : null}

				{!isCollapsed ? (
					<div className="mt-2 min-h-0 w-full flex-1">
						<ScrollArea className="h-full min-h-0 w-full min-w-0">
							<div className="flex min-w-0 flex-col gap-0.5 pb-3 px-3">
								{isLoadingHistory && threads.length === 0 ? (
									<div className="p-4 text-xs text-muted-foreground">
										Loading session history...
									</div>
								) : filter === "All" ? (
									<>
										{pinnedThreads.length > 0 && (
											<ThreadSection label="Pinned">
												{pinnedThreads.map((thread) => (
													<ThreadItem
														editTitle={editingTitle}
														editing={editingSessionId === thread.id}
														isActive={activeThread === thread.id}
														key={thread.id}
														onCancelRename={cancelRenameThread}
														onClick={() => openThread(thread.id)}
														onCommitRename={() =>
															void commitRenameThread(thread)
														}
														onDelete={() => requestDeleteThread(thread)}
														onEditTitleChange={setEditingTitle}
														onFork={() => void forkThread(thread)}
														onRename={() => startRenameThread(thread)}
														pendingAction={
															pendingAction?.sessionId === thread.id
																? pendingAction.action
																: null
														}
														thread={thread}
														unread={unreadSessionIds.has(thread.id)}
													/>
												))}
											</ThreadSection>
										)}

										{sessionThreads.length > 0 && (
											<ThreadSection action={filterMenu} label="Sessions">
												{sessionThreads
													.slice(0, showMoreCount)
													.map((thread) => (
														<ThreadItem
															editTitle={editingTitle}
															editing={editingSessionId === thread.id}
															isActive={activeThread === thread.id}
															key={thread.id}
															onCancelRename={cancelRenameThread}
															onClick={() => openThread(thread.id)}
															onCommitRename={() =>
																void commitRenameThread(thread)
															}
															onDelete={() => requestDeleteThread(thread)}
															onEditTitleChange={setEditingTitle}
															onFork={() => void forkThread(thread)}
															onRename={() => startRenameThread(thread)}
															pendingAction={
																pendingAction?.sessionId === thread.id
																	? pendingAction.action
																	: null
															}
															thread={thread}
															unread={unreadSessionIds.has(thread.id)}
														/>
													))}
											</ThreadSection>
										)}

										{filteredThreads.length === 0 && (
											<div className="p-4 text-xs text-muted-foreground">
												{searchQuery
													? "No sessions match your search."
													: "No sessions found in history."}
											</div>
										)}
									</>
								) : (
									<ThreadSection action={filterMenu} label={filter}>
										{displayedThreads?.map((thread) => (
											<ThreadItem
												editTitle={editingTitle}
												editing={editingSessionId === thread.id}
												isActive={activeThread === thread.id}
												key={thread.id}
												onCancelRename={cancelRenameThread}
												onClick={() => openThread(thread.id)}
												onCommitRename={() => void commitRenameThread(thread)}
												onDelete={() => requestDeleteThread(thread)}
												onEditTitleChange={setEditingTitle}
												onFork={() => void forkThread(thread)}
												onRename={() => startRenameThread(thread)}
												pendingAction={
													pendingAction?.sessionId === thread.id
														? pendingAction.action
														: null
												}
												thread={thread}
												unread={unreadSessionIds.has(thread.id)}
											/>
										))}
									</ThreadSection>
								)}
								{showShowMore && (
									<Button
										disabled={isLoadingMore}
										onClick={() => {
											const nextCount =
												showMoreCount + INITIAL_VISIBLE_THREAD_COUNT;
											setShowMoreCount(nextCount);
											if (fetchLimitRef.current < nextCount) {
												fetchLimitRef.current = nextCount;
												setIsLoadingMore(true);
												void refreshSessions().finally(() =>
													setIsLoadingMore(false),
												);
											}
										}}
										type="button"
										variant="sidebarText"
									>
										{isLoadingMore ? (
											<>
												<Loader2 className="size-3 animate-spin" />
												Loading...
											</>
										) : (
											<>
												Show more
												<ChevronDown className="size-3" />
											</>
										)}
									</Button>
								)}
							</div>
						</ScrollArea>
					</div>
				) : (
					<div className="min-h-0 w-full flex-1" />
				)}

				<div className="shrink-0 px-2 py-3">
					<Button
						type="button"
						variant="sidebarItem"
						className={cn(
							"justify-start min-w-0",
							isCollapsed && "mx-auto size-9 justify-center px-0",
						)}
						onClick={() => setView("settings")}
						title="Settings"
					>
						<Settings className="size-4" />
						{!isCollapsed ? "Settings" : null}
					</Button>
				</div>
			</div>
			<AlertDialog
				open={deleteConfirmThread !== null}
				onOpenChange={(open) => {
					if (!open && pendingAction?.action !== "delete") {
						setDeleteConfirmThread(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete session?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes "
							{normalizeTitle(deleteConfirmThread?.title ?? "this session")}"
							from local history.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pendingAction?.action === "delete"}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={
								!deleteConfirmThread || pendingAction?.action === "delete"
							}
							onClick={(event) => {
								event.preventDefault();
								if (deleteConfirmThread) {
									void deleteThread(deleteConfirmThread);
								}
							}}
						>
							{pendingAction?.action === "delete" ? (
								<>
									<Loader2 className="size-4 animate-spin" />
									Deleting...
								</>
							) : (
								"Delete"
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function ThreadSection({
	label,
	action,
	children,
}: {
	label: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className={cn("mb-1 min-w-0")}>
			<div className="flex w-full min-w-0 flex-nowrap items-center gap-1.5 py-1.5 text-xs tracking-wider text-foreground">
				{action ? (
					<div className="flex shrink-0 items-center">{action}</div>
				) : null}
				<div className="block min-w-0 shrink truncate">{label}</div>
			</div>
			{children}
		</div>
	);
}

function ThreadItem({
	thread,
	editTitle,
	editing,
	isActive,
	onClick,
	onCancelRename,
	onCommitRename,
	onEditTitleChange,
	onRename,
	onFork,
	onDelete,
	pendingAction,
	unread,
}: {
	thread: Thread;
	editTitle: string;
	editing: boolean;
	isActive: boolean;
	onClick: () => void;
	onCancelRename: () => void;
	onCommitRename: () => void;
	onEditTitleChange: (title: string) => void;
	onRename: () => void;
	onFork: () => void;
	onDelete: () => void;
	pendingAction: "rename" | "fork" | "delete" | null;
	unread: boolean;
}) {
	const tokenLabel = formatTokenCount(thread.inputTokens, thread.outputTokens);
	const costLabel = formatCostUsd(thread.totalCostUsd);
	const title = normalizeTitle(thread.title);
	const pending = pendingAction !== null;
	const statusDotClass = pending
		? "bg-yellow-400"
		: thread.status === "running"
			? "bg-green-500"
			: unread
				? "bg-blue-500"
				: "";
	const infoItems: Array<[string, string | null | undefined]> = [
		["Workspace", thread.codebase],
		["Status", thread.status],
		["Updated", thread.time],
		["Provider", thread.provider],
		["Model", thread.model],
		["Tokens", tokenLabel],
		["Cost", costLabel],
	].filter((item): item is [string, string] => Boolean(item[1]));

	if (editing) {
		return (
			<div
				className={cn(
					"grid h-8 w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-md px-2",
					isActive
						? "bg-sidebar-accent text-sidebar-accent-foreground"
						: "text-sidebar-foreground/80",
				)}
			>
				<EditableSessionTitle
					disabled={pendingAction === "rename"}
					onCancel={onCancelRename}
					onChange={onEditTitleChange}
					onCommit={onCommitRename}
					value={editTitle}
				/>
				{pendingAction === "rename" ? (
					<Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
				) : null}
			</div>
		);
	}

	return (
		<ContextMenu>
			<HoverCard openDelay={250} closeDelay={100}>
				<ContextMenuTrigger asChild>
					<HoverCardTrigger asChild>
						<button
							className={cn(
								"group grid h-8 w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm font-normal transition-colors",
								isActive
									? "bg-sidebar-accent text-sidebar-accent-foreground"
									: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
							)}
							disabled={pending}
							onClick={onClick}
							type="button"
						>
							<span className="block max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold leading-tight">
								{title}
							</span>
							{statusDotClass ? (
								<span
									aria-hidden="true"
									className={cn("size-2 rounded-full", statusDotClass)}
								/>
							) : null}
						</button>
					</HoverCardTrigger>
				</ContextMenuTrigger>
				<HoverCardContent
					align="start"
					avoidCollisions={false}
					className="w-72 p-3"
					side="right"
					sideOffset={8}
				>
					<div className="min-w-0 space-y-2">
						<div className="truncate text-sm font-medium">{title}</div>
						<div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
							{infoItems.map(([label, value]) => (
								<div className="contents" key={label}>
									<span className="text-muted-foreground">{label}</span>
									<span className="min-w-0 truncate font-mono">{value}</span>
								</div>
							))}
						</div>
					</div>
				</HoverCardContent>
			</HoverCard>
			<SessionContextMenuContent
				onDelete={onDelete}
				onFork={onFork}
				onRename={onRename}
				pendingAction={pendingAction}
			/>
		</ContextMenu>
	);
}

function EditableSessionTitle({
	value,
	disabled,
	onChange,
	onCommit,
	onCancel,
}: {
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
	onCommit: () => void;
	onCancel: () => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		const input = inputRef.current;
		if (!input) {
			return;
		}
		input.focus();
		input.setSelectionRange(0, 0);
		input.scrollLeft = 0;
	}, []);

	return (
		<Input
			ref={inputRef}
			className="h-6 max-w-full min-w-0 bg-background px-1.5 py-0 text-sm"
			disabled={disabled}
			onBlur={() => {
				if (!disabled) {
					onCommit();
				}
			}}
			onChange={(event) => onChange(event.target.value)}
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					onCommit();
				}
				if (event.key === "Escape") {
					event.preventDefault();
					onCancel();
				}
			}}
			value={value}
		/>
	);
}

function SessionContextMenuContent({
	onRename,
	onFork,
	onDelete,
	pendingAction,
}: {
	onRename: () => void;
	onFork: () => void;
	onDelete: () => void;
	pendingAction: "rename" | "fork" | "delete" | null;
}) {
	const pending = pendingAction !== null;
	return (
		<ContextMenuContent className="w-40">
			<ContextMenuItem disabled={pending} onSelect={onRename}>
				{pendingAction === "rename" ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Pencil className="size-4" />
				)}
				{pendingAction === "rename" ? "Renaming..." : "Rename"}
			</ContextMenuItem>
			<ContextMenuItem disabled={pending} onSelect={onFork}>
				{pendingAction === "fork" ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<GitFork className="size-4" />
				)}
				{pendingAction === "fork" ? "Forking..." : "Fork"}
			</ContextMenuItem>
			<ContextMenuItem
				disabled={pending}
				onSelect={onDelete}
				variant="destructive"
			>
				{pendingAction === "delete" ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<Trash2 className="size-4" />
				)}
				{pendingAction === "delete" ? "Deleting..." : "Delete"}
			</ContextMenuItem>
		</ContextMenuContent>
	);
}
