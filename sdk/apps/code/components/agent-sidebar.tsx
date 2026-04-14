"use client";

import {
	ChevronDown,
	Filter,
	Loader2,
	MessageSquare,
	Plus,
	Search,
	Settings,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSidebar } from "@/components/ui/sidebar";
import { normalizeTitle } from "@/components/utils";
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
	const { isMobile, state } = useSidebar();
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
		};

		window.addEventListener(
			"cline:session-title-updated",
			handleTitleUpdated as EventListener,
		);
		window.addEventListener(
			"cline:session-deleted",
			handleSessionDeleted as EventListener,
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
		};
	}, []);

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

	useEffect(() => {
		let disposed = false;

		const runRefresh = () => {
			if (!disposed) {
				void refreshSessions();
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
		};
	}, [refreshSessions]);

	useEffect(() => {
		const recent = sessions.slice(0, 24);
		for (const session of recent) {
			const sessionId = session.sessionId;
			if (!sessionId) {
				continue;
			}
			if (usageLoadingRef.current.has(sessionId)) {
				continue;
			}
			const existing = threadsRef.current.find((item) => item.id === sessionId);
			const hasUsage =
				existing?.inputTokens !== undefined ||
				existing?.outputTokens !== undefined;
			const lastHydratedStatus = usageHydratedStatusRef.current.get(sessionId);
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
	}, [sessions]);

	useEffect(() => {
		const recent = sessions.slice(0, 24);
		for (const session of recent) {
			const sessionId = session.sessionId;
			if (!sessionId) {
				continue;
			}
			if (titleLoadingRef.current.has(sessionId)) {
				continue;
			}
			const existing = threadsRef.current.find((item) => item.id === sessionId);
			if (!existing) {
				continue;
			}
			const lastHydratedStatus =
				messageHydratedStatusRef.current.get(sessionId);
			const shouldHydrateTitle = existing.title.startsWith("Session ");
			const hasManualTitle = Boolean(getSessionMetadataTitle(session.metadata));
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
					const nextTitle = hasManualTitle ? null : titleFromMessages(messages);
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
							const nextStatus = inferStatusFromMessages(item.status, messages);
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
	}, [sessions]);

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

	const pinnedThreads = useMemo(
		() => filteredThreads.filter((t) => t.pinned),
		[filteredThreads],
	);
	const runningThreads = useMemo(
		() => filteredThreads.filter((t) => t.status === "running" && !t.pinned),
		[filteredThreads],
	);
	const recentThreads = useMemo(
		() => filteredThreads.filter((t) => t.status !== "running" && !t.pinned),
		[filteredThreads],
	);
	const displayedThreads =
		filter === "All" ? null : filteredThreads.slice(0, showMoreCount);
	// Show "Show more" if there are more to display locally, or if the backend
	// might have more (total fetched sessions reached the fetch limit).
	const mayHaveMoreSessions = sessions.length >= fetchLimitRef.current;
	const showShowMore =
		recentThreads.length + filteredThreads.length > showMoreCount ||
		mayHaveMoreSessions;

	const filterMenu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Filter sessions"
					className="inline-flex items-center justify-center rounded-md m-0! p-0! text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
		<div className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
			<div className="mt-2 flex w-full min-w-0 flex-col gap-1">
				<Button
					className={cn(
						"justify-start min-w-0",
						isCollapsed && "mx-auto size-9 justify-center px-0",
					)}
					onClick={() => onNewThread?.()}
					title="New Session"
					variant="sidebar"
				>
					<Plus className="size-4" />
					{!isCollapsed ? "New Session" : null}
				</Button>
			</div>

			<div className="flex w-full min-w-0 flex-col gap-1">
				{searchOpen && !isCollapsed ? (
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
						className={cn(
							"py-1.5 min-w-0",
							isCollapsed && "mx-auto size-9 justify-center px-0",
						)}
						onClick={() => setSearchOpen(true)}
						title="Search sessions"
						type="button"
						variant="sidebarItem"
					>
						<Search className="size-4 shrink-0" />
						{!isCollapsed ? <span>Search</span> : null}
					</Button>
				)}
			</div>

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
									<ThreadSection collapsed={isCollapsed} label="Pinned">
										{pinnedThreads.map((thread) => (
											<ThreadItem
												collapsed={isCollapsed}
												isActive={activeThread === thread.id}
												key={thread.id}
												onClick={() => {
													const session = sessions.find(
														(item) => item.sessionId === thread.id,
													);
													if (session) {
														onOpenSession?.(session);
													}
												}}
												thread={thread}
											/>
										))}
									</ThreadSection>
								)}

								{runningThreads.length > 0 && (
									<ThreadSection collapsed={isCollapsed} label="Running">
										{runningThreads.map((thread) => (
											<ThreadItem
												collapsed={isCollapsed}
												isActive={activeThread === thread.id}
												key={thread.id}
												onClick={() => {
													const session = sessions.find(
														(item) => item.sessionId === thread.id,
													);
													if (session) {
														onOpenSession?.(session);
													}
												}}
												thread={thread}
											/>
										))}
									</ThreadSection>
								)}

								{recentThreads.length > 0 && (
									<ThreadSection
										action={filterMenu}
										collapsed={isCollapsed}
										label="Sessions"
									>
										{recentThreads.slice(0, showMoreCount).map((thread) => (
											<ThreadItem
												collapsed={isCollapsed}
												isActive={activeThread === thread.id}
												key={thread.id}
												onClick={() => {
													const session = sessions.find(
														(item) => item.sessionId === thread.id,
													);
													if (session) {
														onOpenSession?.(session);
													}
												}}
												thread={thread}
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
							<ThreadSection
								action={filterMenu}
								collapsed={isCollapsed}
								label={filter}
							>
								{displayedThreads?.map((thread) => (
									<ThreadItem
										collapsed={isCollapsed}
										isActive={activeThread === thread.id}
										key={thread.id}
										onClick={() => {
											const session = sessions.find(
												(item) => item.sessionId === thread.id,
											);
											if (session) {
												onOpenSession?.(session);
											}
										}}
										thread={thread}
									/>
								))}
							</ThreadSection>
						)}
						{showShowMore && (
							<Button
								className={cn(
									isCollapsed && "mx-auto justify-center rounded-md p-0",
								)}
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
										{!isCollapsed ? "Loading..." : null}
									</>
								) : (
									<>
										{!isCollapsed ? "Show more" : null}
										<ChevronDown className="size-3" />
									</>
								)}
							</Button>
						)}
					</div>
				</ScrollArea>
			</div>

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
	);
}

function ThreadSection({
	label,
	collapsed,
	action,
	children,
}: {
	label: string;
	collapsed?: boolean;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className={cn("mb-1 min-w-0")}>
			<div
				className={cn(
					"flex w-full min-w-0 flex-nowrap items-center gap-2 py-1.5 text-xs uppercase tracking-wider text-muted-foreground",
					collapsed && "hidden",
				)}
			>
				<div className="block min-w-0 flex-1 truncate">{label}</div>
				{action ? (
					<div className="shrink-0 flex justify-end">{action}</div>
				) : null}
			</div>
			{children}
		</div>
	);
}

function ThreadItem({
	thread,
	collapsed,
	isActive,
	onClick,
}: {
	thread: Thread;
	collapsed?: boolean;
	isActive: boolean;
	onClick: () => void;
}) {
	const tokenLabel = formatTokenCount(thread.inputTokens, thread.outputTokens);
	const costLabel = formatCostUsd(thread.totalCostUsd);
	if (collapsed) {
		return (
			<Button
				className={cn(
					"mx-auto inline-flexitems-center justify-center rounded-md p-0",
					isActive
						? "bg-sidebar-accent text-sidebar-accent-foreground"
						: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
				)}
				onClick={onClick}
				title={normalizeTitle(thread.title)}
				type="button"
				variant="ghost"
			>
				<MessageSquare className="size-3" />
			</Button>
		);
	}

	return (
		<button
			className={cn(
				"group flex h-auto w-full min-w-0 items-start justify-start rounded-md py-2 px-0 text-left text-sm font-normal transition-colors",
				isActive
					? "bg-sidebar-accent text-sidebar-accent-foreground"
					: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
			)}
			onClick={onClick}
			type="button"
		>
			<div className="flex w-full min-w-0 flex-col gap-1.5 overflow-hidden">
				<div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-2">
					<div className="block min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold leading-tight">
						{normalizeTitle(thread.title)}
					</div>
					<span className="ml-2 shrink-0 whitespace-nowrap text-right text-[10px] text-muted-foreground tabular-nums">
						{thread.time}
					</span>
				</div>
				<div className="flex w-full min-w-0 flex-nowrap items-center gap-1 overflow-hidden text-xs text-muted-foreground">
					<span className="block min-w-0 max-w-[40%] shrink truncate rounded bg-secondary px-1 py-0.5 font-mono text-xs">
						{thread.codebase}
					</span>
					{thread.model && (
						<span className="block min-w-0 max-w-[55%] shrink truncate rounded border border-sidebar-border px-1 py-0.5 font-mono text-[10px]">
							{thread.model}
						</span>
					)}
					{tokenLabel ? (
						<span className="block min-w-0 shrink truncate rounded border border-sidebar-border px-1 py-0.5 font-mono text-[10px]">
							{tokenLabel}
						</span>
					) : null}
					{costLabel ? (
						<span className="block min-w-0 shrink truncate rounded border border-sidebar-border px-1 py-0.5 font-mono text-[10px]">
							{costLabel}
						</span>
					) : null}
				</div>
			</div>
		</button>
	);
}
