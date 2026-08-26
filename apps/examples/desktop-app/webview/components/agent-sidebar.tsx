"use client";

import {
	ArrowLeft,
	ArrowRight,
	Blocks,
	Bot,
	ChevronDown,
	CircleUserRound,
	Clock3,
	Filter,
	FolderTree,
	GitFork,
	Loader2,
	Mic,
	PanelLeftOpen,
	Pencil,
	Pin,
	Plus,
	Radio,
	Search,
	Settings,
	SlidersHorizontal,
	Store,
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
import { AppUpdateIndicator } from "@/components/app-update-indicator";
import { ClineLogo } from "@/components/cline-logo";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	CommandDialog,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
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
import {
	CUSTOMIZATION_SECTION_LABELS,
	CUSTOMIZATION_SECTIONS,
	SETTINGS_SECTIONS,
	type SettingsSection,
} from "@/components/views/settings/sections";
import { useAccount } from "@/contexts/account-context";
import { useHasConnectedProvider } from "@/hooks/use-has-connected-provider";
import type {
	SessionThread,
	UseSessionHistoryResult,
} from "@/hooks/use-session-history";
import { formatCostUsd, formatTokenCount } from "@/hooks/use-session-history";
import {
	BETA_PRODUCT_NAME,
	isBetaVersion,
	productNameForVersion,
} from "@/lib/app-channel";
import { desktopClient } from "@/lib/desktop-client";
import {
	ALL_SESSION_SOURCES,
	filterSessionsBySource,
	getSessionSourceLabel,
	getSessionSources,
} from "@/lib/session-history";
import {
	groupThreadsByProject,
	INITIAL_VISIBLE_THREAD_COUNT,
	workspaceDisplayName,
} from "@/lib/sidebar-session-organization";
import { cn } from "@/lib/utils";

type Thread = SessionThread;
type AppView = "chat" | "sessions" | "settings";

const filterOptions = ["All", "Running"] as const;
type FilterOption = (typeof filterOptions)[number];
type SidebarSortMode = "time" | "project";
type SessionCategory = "pinned" | "scheduled" | "tasks";
type DesktopProcessContext = {
	appVersion?: unknown;
	hub?: {
		error?: unknown;
		status?: unknown;
		url?: unknown;
	};
};
type HubStatus = {
	connected: boolean;
	error: string | null;
	url: string | null;
};

function hubPort(url: string | null): string | null {
	if (!url) {
		return null;
	}
	try {
		return new URL(url).port || null;
	} catch {
		return null;
	}
}

const SETTINGS_SECTION_ICONS = {
	General: SlidersHorizontal,
	Models: Bot,
	Voice: Mic,
	Channels: Radio,
	Schedules: Clock3,
	Account: CircleUserRound,
	Customize: Blocks,
	Marketplace: Store,
} satisfies Record<SettingsSection, typeof Settings>;

// The Customize section is the installed inventory, so its nav row reads
// "Installed" (it sits under a "Customize" group header / next to the
// Marketplace row, which supplies the context).
function settingsSectionLabel(section: SettingsSection): string {
	return (
		CUSTOMIZATION_SECTION_LABELS[
			section as keyof typeof CUSTOMIZATION_SECTION_LABELS
		] ?? section
	);
}

function SettingsSectionNavigation({
	activeSection,
	collapsed,
	onSelect,
}: {
	activeSection: SettingsSection;
	collapsed: boolean;
	onSelect: (section: SettingsSection) => void;
}) {
	// Voice input only works with a connected model provider, so its section
	// stays disabled until one is set up (null = catalog still loading).
	const hasConnectedProvider = useHasConnectedProvider();
	const renderSectionButton = (section: SettingsSection) => {
		const Icon = SETTINGS_SECTION_ICONS[section];
		const label = settingsSectionLabel(section);
		const disabled = section === "Voice" && hasConnectedProvider === false;
		const button = (
			<Button
				aria-current={activeSection === section ? "page" : undefined}
				aria-label={label}
				className={cn(
					"min-w-0 justify-start",
					activeSection === section &&
						"bg-surface-hover text-sidebar-foreground",
					collapsed && "size-9 justify-center px-0",
					disabled && !collapsed && "w-full",
				)}
				disabled={disabled}
				key={disabled ? undefined : section}
				onClick={() => onSelect(section)}
				title={label}
				type="button"
				variant="sidebarItem"
			>
				<Icon className="size-4 shrink-0" />
				{!collapsed ? <span className="truncate">{label}</span> : null}
			</Button>
		);
		if (!disabled) {
			return button;
		}
		// Disabled buttons swallow pointer events, so the explanation lives on
		// a wrapping span for the native tooltip to work.
		return (
			<span
				className={cn("block", collapsed && "flex w-full justify-start")}
				key={section}
				title="Configure a model provider to set up voice input"
			>
				{button}
			</span>
		);
	};

	return (
		<nav
			aria-label="Settings sections"
			className={cn(
				"flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden",
				collapsed ? "w-full items-start" : "w-full",
			)}
		>
			{!collapsed ? (
				<p className="px-2 pb-2 text-sm font-medium text-muted-foreground">
					Settings
				</p>
			) : null}
			{/* Schedules and Customize already have dedicated rows at the top of
			    the expanded sidebar (Customize's Installed/Marketplace sub-tabs
			    render under that row), so the section nav skips them there.
			    The collapsed sidebar has no action rows and keeps them
			    reachable. */}
			{SETTINGS_SECTIONS.filter(
				(section) => collapsed || section !== "Schedules",
			).map(renderSectionButton)}
			{collapsed ? (
				<>
					<div className="my-2 h-px w-6 shrink-0 bg-sidebar-border" />
					{CUSTOMIZATION_SECTIONS.map(renderSectionButton)}
				</>
			) : null}
		</nav>
	);
}

export function AgentSidebar({
	canNavigateBack = false,
	canNavigateForward = false,
	newTaskActive = false,
	onHome,
	onNavigateBack,
	onNavigateForward,
	onSettingsSectionChange,
	setView,
	settingsSection,
	view,
	activeSessionId,
	sessionHistory,
}: {
	canNavigateBack?: boolean;
	canNavigateForward?: boolean;
	/** Highlights the New row while the fresh, not-yet-started task page is showing. */
	newTaskActive?: boolean;
	onHome: () => void;
	onNavigateBack?: () => void;
	onNavigateForward?: () => void;
	onSettingsSectionChange: (section: SettingsSection) => void;
	setView: (view: AppView) => void;
	settingsSection: SettingsSection;
	view: AppView;
	activeSessionId?: string | null;
	sessionHistory: UseSessionHistoryResult;
}) {
	const { isMobile, setOpen, setOpenMobile, state } = useSidebar();
	const isCollapsed = !isMobile && state === "collapsed";
	const { user, activeOrganization } = useAccount();
	const { displayName, email } = user || {};
	const username = displayName?.split(" ")?.[0] || email?.split("@")?.[0];
	const accountName = username?.trim() || "Cline Desktop";
	const accountScope = user
		? (activeOrganization?.name ?? "Personal")
		: undefined;
	const accountInitial = accountName.charAt(0).toUpperCase();
	const {
		deleteThread: deleteHistoryThread,
		forkThread: forkHistoryThread,
		hasLoadedHistory,
		isLoadingMore,
		loadAllSessions,
		loadOlderSessions,
		mayHaveMoreSessions,
		openThread: openHistoryThread,
		pendingAction,
		renameThread,
		setThreadPinned,
		threads,
		unreadSessionIds,
	} = sessionHistory;
	const activeThread = activeSessionId ?? "";
	const [filter, setFilter] = useState<FilterOption>("All");
	const [sourceFilter, setSourceFilter] = useState(ALL_SESSION_SOURCES);
	const [sortMode, setSortMode] = useState<SidebarSortMode>("time");
	const [searchOpen, setSearchOpen] = useState(false);
	const [showMoreCount, setShowMoreCount] = useState(
		INITIAL_VISIBLE_THREAD_COUNT,
	);
	const [scheduledVisibleCount, setScheduledVisibleCount] = useState(
		INITIAL_VISIBLE_THREAD_COUNT,
	);
	const [collapsedSections, setCollapsedSections] = useState<
		Set<SessionCategory>
	>(() => new Set());
	// Drives the gradient fade under the Sessions header once the list is
	// scrolled, so rows fade out instead of clipping against the header.
	const [sessionListScrolled, setSessionListScrolled] = useState(false);
	// The session-detail hover card is controlled from up here so scrolling
	// the list can dismiss it (Radix gets no pointer events during scroll).
	const [hoverCardThreadId, setHoverCardThreadId] = useState<string | null>(
		null,
	);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [deleteConfirmThread, setDeleteConfirmThread] = useState<Thread | null>(
		null,
	);
	const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
		() => new Set(),
	);
	const [projectVisibleCounts, setProjectVisibleCounts] = useState<
		Record<string, number>
	>({});
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [hubStatus, setHubStatus] = useState<HubStatus | null>(null);

	const loadProcessContext = useCallback(async () => {
		try {
			const context = await desktopClient.invoke<DesktopProcessContext>(
				"get_process_context",
			);
			const version =
				typeof context?.appVersion === "string"
					? context.appVersion.trim()
					: "";
			setAppVersion(version || null);
			const hubUrl =
				typeof context?.hub?.url === "string"
					? context.hub.url.trim() || null
					: null;
			setHubStatus({
				connected: context?.hub?.status === "connected",
				error:
					typeof context?.hub?.error === "string"
						? context.hub.error.trim() || null
						: null,
				url: hubUrl,
			});
		} catch (error) {
			setHubStatus({
				connected: false,
				error:
					error instanceof Error
						? error.message
						: "Unable to read Cline Hub status.",
				url: null,
			});
		}
	}, []);

	useEffect(() => {
		void loadProcessContext();
	}, [loadProcessContext]);

	const sourceOptions = useMemo(() => getSessionSources(threads), [threads]);
	const filteredThreads = useMemo(() => {
		const filtered = filterSessionsBySource(threads, sourceFilter);
		if (filter === "Running") {
			return filtered.filter((t) => t.status === "running");
		}
		return filtered;
	}, [filter, sourceFilter, threads]);
	const closeMobileSidebar = useCallback(() => {
		if (isMobile) setOpenMobile(false);
	}, [isMobile, setOpenMobile]);

	const openThread = useCallback(
		(threadId: string) => {
			openHistoryThread(threadId);
			closeMobileSidebar();
		},
		[closeMobileSidebar, openHistoryThread],
	);

	const openHome = useCallback(() => {
		onHome();
		closeMobileSidebar();
	}, [closeMobileSidebar, onHome]);
	const openSessions = useCallback(() => {
		setView("sessions");
		closeMobileSidebar();
	}, [closeMobileSidebar, setView]);
	// The gear is a shortcut to the General settings page rather than a
	// resume-last-section toggle.
	const openSettings = useCallback(() => {
		onSettingsSectionChange("General");
		closeMobileSidebar();
	}, [closeMobileSidebar, onSettingsSectionChange]);
	const openSettingsSection = useCallback(
		(section: SettingsSection) => {
			onSettingsSectionChange(section);
			closeMobileSidebar();
		},
		[closeMobileSidebar, onSettingsSectionChange],
	);
	const navigateBack = useCallback(() => {
		onNavigateBack?.();
	}, [onNavigateBack]);
	const navigateForward = useCallback(() => {
		onNavigateForward?.();
	}, [onNavigateForward]);
	const openSearch = useCallback(() => {
		setSearchOpen(true);
		// The sidebar only pages in recent history; pull the rest so older
		// sessions are searchable too.
		void loadAllSessions();
	}, [loadAllSessions]);
	const openSearchResult = useCallback(
		(threadId: string) => {
			setSearchOpen(false);
			openThread(threadId);
		},
		[openThread],
	);

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
			const renamed = await renameThread(thread.id, editingTitle);
			if (renamed) {
				cancelRenameThread();
			}
		},
		[cancelRenameThread, editingTitle, renameThread],
	);

	const forkThread = useCallback(
		async (thread: Thread) => {
			await forkHistoryThread(thread.id);
		},
		[forkHistoryThread],
	);

	const togglePinned = useCallback(
		async (thread: Thread) => {
			await setThreadPinned(thread.id, !thread.pinned);
		},
		[setThreadPinned],
	);

	const requestDeleteThread = useCallback((thread: Thread) => {
		setDeleteConfirmThread(thread);
	}, []);

	const deleteThread = useCallback(
		async (thread: Thread) => {
			await deleteHistoryThread(thread.id);
			setDeleteConfirmThread(null);
		},
		[deleteHistoryThread],
	);

	const pinnedThreads = useMemo(
		() => filteredThreads.filter((t) => t.pinned),
		[filteredThreads],
	);
	const scheduledThreads = useMemo(
		() => filteredThreads.filter((t) => !t.pinned && t.isScheduled),
		[filteredThreads],
	);
	const taskThreads = useMemo(
		() => filteredThreads.filter((t) => !t.pinned && !t.isScheduled),
		[filteredThreads],
	);
	// Category headers only appear once there is something to categorize;
	// a lone "Tasks" header over the whole list would be noise.
	const showCategorySections =
		pinnedThreads.length > 0 || scheduledThreads.length > 0;
	const showTimeShowMore =
		taskThreads.length > showMoreCount ||
		(filter === "All" && mayHaveMoreSessions);
	// A failed fetch leaves the task count and has-more state unchanged, which
	// are exactly the conditions the page-fill effect fires on; without this
	// halt it would retry a failing request (and re-toast the error) forever.
	// The next explicit "Show more" click clears the halt to retry.
	const pageFillFailedRef = useRef(false);
	// A "Show more" click can outpace the loaded history: showMoreCount counts
	// only Tasks rows while the backend limit counts all sessions, and a
	// fetched batch can consist entirely of pinned or scheduled sessions. Keep
	// growing the history window until the requested Tasks page fills or
	// history runs out, so every click makes visible progress. The
	// isLoadingMore dependency retriggers the check after each fetch settles.
	useEffect(() => {
		if (
			sortMode !== "time" ||
			filter !== "All" ||
			isLoadingMore ||
			!mayHaveMoreSessions ||
			showMoreCount <= INITIAL_VISIBLE_THREAD_COUNT ||
			taskThreads.length >= showMoreCount ||
			pageFillFailedRef.current
		) {
			return;
		}
		void loadOlderSessions().then((loaded) => {
			if (!loaded) {
				pageFillFailedRef.current = true;
			}
		});
	}, [
		filter,
		isLoadingMore,
		loadOlderSessions,
		mayHaveMoreSessions,
		showMoreCount,
		sortMode,
		taskThreads.length,
	]);
	// Pinned threads lead the concatenation, and groupThreadsByProject keeps
	// insertion order, so each project group reads pinned-by-recency first,
	// then the rest by recency.
	const projectGroups = useMemo(
		() =>
			groupThreadsByProject([
				...filteredThreads.filter((t) => t.pinned),
				...filteredThreads.filter((t) => !t.pinned),
			]),
		[filteredThreads],
	);
	const toggleSection = useCallback((section: SessionCategory) => {
		setCollapsedSections((current) => {
			const next = new Set(current);
			if (next.has(section)) next.delete(section);
			else next.add(section);
			return next;
		});
	}, []);
	const toggleProject = useCallback((project: string) => {
		setCollapsedProjects((current) => {
			const next = new Set(current);
			if (next.has(project)) next.delete(project);
			else next.add(project);
			return next;
		});
	}, []);
	const showMoreForProject = useCallback((project: string) => {
		setProjectVisibleCounts((current) => ({
			...current,
			[project]:
				(current[project] ?? INITIAL_VISIBLE_THREAD_COUNT) +
				INITIAL_VISIBLE_THREAD_COUNT,
		}));
	}, []);

	const filterMenu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Filter sessions"
					className="m-0! inline-flex size-8 items-center justify-center rounded-md p-0! text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground"
					variant="ghost"
					size="icon"
				>
					<Filter className="size-3 stroke-2" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36">
				<DropdownMenuLabel>Status</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					onValueChange={(value) => {
						setFilter(value as FilterOption);
						setShowMoreCount(INITIAL_VISIBLE_THREAD_COUNT);
						setScheduledVisibleCount(INITIAL_VISIBLE_THREAD_COUNT);
						setProjectVisibleCounts({});
					}}
					value={filter}
				>
					{filterOptions.map((opt) => (
						<DropdownMenuRadioItem key={opt} value={opt}>
							{opt}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				{sourceOptions.length > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Source</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							onValueChange={(value) => {
								setSourceFilter(value);
								setShowMoreCount(INITIAL_VISIBLE_THREAD_COUNT);
								setScheduledVisibleCount(INITIAL_VISIBLE_THREAD_COUNT);
								setProjectVisibleCounts({});
							}}
							value={sourceFilter}
						>
							<DropdownMenuRadioItem value={ALL_SESSION_SOURCES}>
								All sources
							</DropdownMenuRadioItem>
							{sourceOptions.map((source) => (
								<DropdownMenuRadioItem key={source} value={source}>
									{getSessionSourceLabel(source)}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
	// A single click flips straight to the other mode (a dropdown here would
	// cost an extra click for a two-option choice); the icon shows the mode
	// that is currently active.
	const sortToggle = (
		<Button
			aria-label={`Sort sessions: ${sortMode === "time" ? "Time" : "Project"}`}
			className="m-0! inline-flex size-8 items-center justify-center rounded-md p-0! text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground"
			onClick={() =>
				setSortMode((current) => (current === "time" ? "project" : "time"))
			}
			size="icon"
			title={
				sortMode === "time"
					? "Sorted by time — click to group by project"
					: "Grouped by project — click to sort by time"
			}
			variant="ghost"
		>
			{sortMode === "time" ? (
				<Clock3 className="size-3.5" />
			) : (
				<FolderTree className="size-3.5" />
			)}
		</Button>
	);
	const threadItem = (thread: Thread) => (
		<ThreadItem
			editTitle={editingTitle}
			editing={editingSessionId === thread.id}
			hoverCardOpen={hoverCardThreadId === thread.id}
			isActive={activeThread === thread.id}
			key={thread.id}
			onHoverCardOpenChange={(open) =>
				setHoverCardThreadId((current) =>
					open ? thread.id : current === thread.id ? null : current,
				)
			}
			onCancelRename={cancelRenameThread}
			onClick={() => openThread(thread.id)}
			onCommitRename={() => void commitRenameThread(thread)}
			onDelete={() => requestDeleteThread(thread)}
			onEditTitleChange={setEditingTitle}
			onFork={() => void forkThread(thread)}
			onRename={() => startRenameThread(thread)}
			onTogglePin={() => void togglePinned(thread)}
			pendingAction={
				pendingAction?.sessionId === thread.id ? pendingAction.action : null
			}
			thread={thread}
			unread={unreadSessionIds.has(thread.id)}
		/>
	);
	const customizeSectionOpen =
		view === "settings" &&
		(CUSTOMIZATION_SECTIONS as readonly SettingsSection[]).includes(
			settingsSection,
		);
	const timeShowMoreButton = (
		<Button
			className="px-2!"
			disabled={isLoadingMore}
			onClick={() => {
				// Raising the page size is enough: the page-fill effect fetches
				// older history whenever loaded tasks cannot fill the page. An
				// explicit click also retries after a failed fetch halted it.
				pageFillFailedRef.current = false;
				setShowMoreCount(showMoreCount + INITIAL_VISIBLE_THREAD_COUNT);
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
	);
	return (
		<>
			<div className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
				<div
					className={cn(
						"flex h-12 shrink-0 items-center justify-end gap-0.5 pr-2 pl-19",
						isCollapsed && "px-0",
					)}
					data-tauri-drag-region
				>
					{!isCollapsed ? (
						<>
							<Button
								aria-label="Previous page"
								className="size-8 text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground"
								disabled={!canNavigateBack}
								onClick={navigateBack}
								size="icon"
								title="Previous page"
								type="button"
								variant="ghost"
							>
								<ArrowLeft className="size-4.5" />
							</Button>
							<Button
								aria-label="Next page"
								className="size-8 text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground"
								disabled={!canNavigateForward}
								onClick={navigateForward}
								size="icon"
								title="Next page"
								type="button"
								variant="ghost"
							>
								<ArrowRight className="size-4.5" />
							</Button>
						</>
					) : null}
				</div>

				<div
					className={cn(
						"flex h-10 shrink-0 items-center justify-between px-2",
						isCollapsed && "px-1.5",
					)}
				>
					<div className="flex min-w-0 items-center gap-0.5">
						<HoverCard
							closeDelay={100}
							openDelay={0}
							onOpenChange={(open) => {
								if (open) {
									void loadProcessContext();
								}
							}}
						>
							<HoverCardTrigger asChild>
								<button
									aria-label="Cline home"
									className={cn(
										"flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
										isCollapsed && "size-9",
									)}
									onClick={openHome}
									title="Home"
									type="button"
								>
									<ClineLogo className="size-5" />
								</button>
							</HoverCardTrigger>
							<HoverCardContent
								align="start"
								className="w-64 p-3"
								// Clicking the trigger counts as a pointer-down outside the
								// card, which dismisses it — and the button's focus event
								// then reopens it, so the card flashes on every click.
								// Suppress the dismissal; the card still closes on pointer
								// leave like any hover card.
								onPointerDownOutside={(event) => event.preventDefault()}
								side="bottom"
							>
								<p className="text-sm font-medium">
									{productNameForVersion(appVersion)}
								</p>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{appVersion ? `Version ${appVersion}` : "Version unavailable"}
								</p>
								<div className="mt-3 border-border border-t pt-3">
									<div className="flex items-center gap-2 text-xs">
										<span
											aria-hidden="true"
											className={cn(
												"h-2 w-2 shrink-0 rounded-full",
												hubStatus?.connected
													? "bg-emerald-500"
													: "bg-muted-foreground",
											)}
										/>
										<span className="font-medium">
											Cline Hub @{hubPort(hubStatus?.url ?? null) ?? "unknown"}
										</span>
									</div>
									{hubStatus && !hubStatus.connected && (
										<p className="mt-1 text-[11px] text-destructive">
											{hubStatus.error ?? "Cline Hub is not connected."}
										</p>
									)}
								</div>
							</HoverCardContent>
						</HoverCard>
						{!isCollapsed && isBetaVersion(appVersion) ? (
							<Badge
								className="ml-0.5 px-1.5 py-0 text-[10px] uppercase tracking-wide"
								title={`${BETA_PRODUCT_NAME} — beta builds install side by side with the stable app and update from the beta channel`}
								variant="secondary"
							>
								Beta
							</Badge>
						) : null}
						{!isCollapsed ? <AppUpdateIndicator /> : null}
					</div>
					{!isCollapsed ? (
						<div className="flex items-center gap-1">
							<Button
								aria-label="Search sessions"
								className="size-8 shrink-0 justify-center px-0"
								onClick={openSearch}
								title="Search sessions"
								type="button"
								variant="sidebarItem"
							>
								<Search className="size-4" />
							</Button>
						</div>
					) : null}
				</div>

				{!isCollapsed ? (
					<nav
						aria-label="Sidebar actions"
						className="mt-1 flex shrink-0 flex-col gap-0.5 px-2"
					>
						<Button
							aria-current={newTaskActive ? "page" : undefined}
							aria-label="New"
							className={cn(
								newTaskActive && "bg-surface-hover text-sidebar-foreground",
							)}
							onClick={openHome}
							title="Start a new task"
							type="button"
							variant="sidebarItem"
						>
							<Plus className="size-4 shrink-0" />
							<span className="truncate">New</span>
						</Button>
						<Button
							aria-label="Schedule"
							className={cn(
								view === "settings" &&
									settingsSection === "Schedules" &&
									"bg-surface-hover text-sidebar-foreground",
							)}
							onClick={() => openSettingsSection("Schedules")}
							title="Schedules"
							type="button"
							variant="sidebarItem"
						>
							<Clock3 className="size-4 shrink-0" />
							<span className="truncate">Schedule</span>
						</Button>
						<Button
							aria-label="Customize"
							className={cn(
								customizeSectionOpen &&
									"bg-surface-hover-lighter text-sidebar-foreground",
							)}
							onClick={() => openSettingsSection("Customize")}
							title="Customize Cline with plugins, rules, and more"
							type="button"
							variant="sidebarItem"
						>
							<Blocks className="size-4 shrink-0" />
							<span className="truncate">Customize</span>
						</Button>
						{customizeSectionOpen
							? CUSTOMIZATION_SECTIONS.map((section) => (
									<Button
										aria-current={
											settingsSection === section ? "page" : undefined
										}
										aria-label={settingsSectionLabel(section)}
										className={cn(
											"pl-8!",
											settingsSection === section &&
												"bg-surface-hover text-sidebar-foreground",
										)}
										key={section}
										onClick={() => openSettingsSection(section)}
										title={settingsSectionLabel(section)}
										type="button"
										variant="sidebarItem"
									>
										<span className="truncate">
											{settingsSectionLabel(section)}
										</span>
									</Button>
								))
							: null}
					</nav>
				) : null}

				{isCollapsed ? (
					<div className="mt-2 flex min-h-0 flex-1 flex-col items-start gap-1 px-1.5">
						<AppUpdateIndicator className="mx-auto size-9" />
						{view === "settings" ? (
							<SettingsSectionNavigation
								activeSection={settingsSection}
								collapsed
								onSelect={openSettingsSection}
							/>
						) : null}
						<Button
							aria-label="Expand sidebar"
							className="mt-auto size-9 justify-center px-0"
							onClick={() => setOpen(true)}
							title="Expand sidebar"
							type="button"
							variant="sidebar"
						>
							<PanelLeftOpen className="size-4" />
						</Button>
					</div>
				) : view === "settings" ? (
					<div className="mt-5 min-h-0 flex-1 px-3">
						<SettingsSectionNavigation
							activeSection={settingsSection}
							collapsed={false}
							onSelect={openSettingsSection}
						/>
					</div>
				) : (
					<>
						<div className="mt-5 shrink-0 pl-4 pr-2">
							<div className="flex h-8 items-center justify-between gap-2">
								<button
									className={cn(
										"min-w-0 truncate text-sm font-medium text-muted-foreground",
										view === "sessions" && "text-sidebar-foreground",
									)}
									onClick={openSessions}
									type="button"
								>
									{sortMode === "time" ? "Sessions" : "Projects"}
								</button>
								<div className="flex shrink-0 items-center gap-0.5">
									{sortToggle}
									{filterMenu}
								</div>
							</div>
						</div>

						<div className="relative mt-1 min-h-0 w-full flex-1">
							<div
								aria-hidden="true"
								className={cn(
									"pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-sidebar via-sidebar/70 to-transparent transition-opacity duration-200",
									sessionListScrolled ? "opacity-100" : "opacity-0",
								)}
							/>
							<ScrollArea
								className="h-full min-h-0 w-full min-w-0"
								onScrollCapture={(event) => {
									const target = event.target as HTMLElement | null;
									if (target?.dataset.slot === "scroll-area-viewport") {
										setSessionListScrolled(target.scrollTop > 0);
									}
									setHoverCardThreadId(null);
								}}
							>
								<div className="flex min-w-0 flex-col gap-0.5 pb-3 px-2">
									{/* Empty-state copy is reserved for a definitive zero-
									    session answer from the backend: before the first
									    response (or while a failed fetch is being retried)
									    "No sessions found" would read as lost history. */}
									{!hasLoadedHistory && threads.length === 0 ? (
										<div className="p-4 text-sm text-muted-foreground">
											Loading session history...
										</div>
									) : (
										<>
											{sortMode === "time" ? (
												showCategorySections ? (
													<>
														{pinnedThreads.length > 0 ? (
															<CategorySection
																collapsed={collapsedSections.has("pinned")}
																count={pinnedThreads.length}
																label="Pinned"
																onToggle={() => toggleSection("pinned")}
															>
																{pinnedThreads.map(threadItem)}
															</CategorySection>
														) : null}
														{scheduledThreads.length > 0 ? (
															<CategorySection
																collapsed={collapsedSections.has("scheduled")}
																count={scheduledThreads.length}
																label="Scheduled"
																onToggle={() => toggleSection("scheduled")}
															>
																{scheduledThreads
																	.slice(0, scheduledVisibleCount)
																	.map(threadItem)}
																{scheduledThreads.length >
																scheduledVisibleCount ? (
																	<Button
																		className="px-2!"
																		onClick={() =>
																			setScheduledVisibleCount(
																				(current) =>
																					current +
																					INITIAL_VISIBLE_THREAD_COUNT,
																			)
																		}
																		type="button"
																		variant="sidebarText"
																	>
																		Show more
																		<ChevronDown className="size-3" />
																	</Button>
																) : null}
															</CategorySection>
														) : null}
														{taskThreads.length > 0 || showTimeShowMore ? (
															<CategorySection
																collapsed={collapsedSections.has("tasks")}
																count={taskThreads.length}
																label="Tasks"
																onToggle={() => toggleSection("tasks")}
															>
																{taskThreads
																	.slice(0, showMoreCount)
																	.map(threadItem)}
																{showTimeShowMore ? timeShowMoreButton : null}
															</CategorySection>
														) : null}
													</>
												) : (
													taskThreads.slice(0, showMoreCount).map(threadItem)
												)
											) : (
												projectGroups.map((project) => {
													const visibleCount =
														projectVisibleCounts[project.id] ??
														INITIAL_VISIBLE_THREAD_COUNT;
													return (
														<ProjectSection
															collapsed={collapsedProjects.has(project.id)}
															key={project.id}
															label={project.label}
															onToggle={() => toggleProject(project.id)}
														>
															{project.threads
																.slice(0, visibleCount)
																.map(threadItem)}
															{project.threads.length > visibleCount ? (
																<Button
																	className="max-w-full pl-2!"
																	onClick={() => showMoreForProject(project.id)}
																	type="button"
																	variant="sidebarText"
																>
																	<span className="min-w-0 truncate">
																		Show more in {project.label}
																	</span>
																	<ChevronDown className="size-3" />
																</Button>
															) : null}
														</ProjectSection>
													);
												})
											)}

											{(sortMode === "time"
												? filteredThreads.length === 0
												: projectGroups.length === 0) && (
												<div className="px-2 py-4 text-sm text-muted-foreground">
													No sessions found in history.
												</div>
											)}
										</>
									)}
									{sortMode === "time" &&
										!showCategorySections &&
										showTimeShowMore &&
										timeShowMoreButton}
									{sortMode === "project" &&
										filter === "All" &&
										mayHaveMoreSessions && (
											<Button
												className="px-2!"
												disabled={isLoadingMore}
												onClick={() => void loadOlderSessions()}
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
					</>
				)}

				<div
					className={cn(
						"shrink-0 border-t border-sidebar-border/70 py-3",
						isCollapsed ? "px-1.5" : "px-2",
					)}
				>
					{user && !isCollapsed ? (
						<div className="flex min-w-0 items-center gap-2">
							<button
								aria-label="Account settings"
								className={cn(
									"flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-2 text-left text-sidebar-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
									view === "settings" &&
										settingsSection === "Account" &&
										"bg-surface-hover text-sidebar-foreground",
								)}
								onClick={() => openSettingsSection("Account")}
								title={user.email || undefined}
								type="button"
							>
								<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
									{accountInitial}
								</span>
								<span className="flex min-w-0 flex-col leading-tight">
									<span className="truncate text-sm font-medium">
										{accountName}
									</span>
									{accountScope ? (
										<span className="truncate text-[11px] text-muted-foreground">
											{accountScope}
										</span>
									) : null}
								</span>
							</button>
							<Button
								aria-label="Settings"
								className={cn(
									"size-9 shrink-0 justify-center px-0",
									view === "settings" &&
										settingsSection !== "Account" &&
										"bg-surface-hover text-sidebar-foreground",
								)}
								onClick={openSettings}
								title="Settings"
								type="button"
								variant="sidebarItem"
							>
								<Settings className="size-4" />
							</Button>
						</div>
					) : (
						<Button
							aria-label="Settings"
							className={cn(
								"min-w-0 justify-start",
								isCollapsed && "size-9 justify-center px-0",
								view === "settings" &&
									"bg-surface-hover text-sidebar-foreground",
							)}
							onClick={openSettings}
							title="Settings"
							type="button"
							variant="sidebarItem"
						>
							<Settings className="size-4" />
							{!isCollapsed ? "Settings" : null}
						</Button>
					)}
				</div>
			</div>
			<CommandDialog
				description="Search sessions by title, project, or path"
				onOpenChange={setSearchOpen}
				open={searchOpen}
				title="Search sessions"
			>
				<CommandInput placeholder="Search sessions..." />
				<CommandList>
					<CommandEmpty>
						{isLoadingMore
							? "Searching older sessions..."
							: "No sessions found."}
					</CommandEmpty>
					{threads.map((thread) => (
						<CommandItem
							key={thread.id}
							onSelect={() => openSearchResult(thread.id)}
							value={`${normalizeTitle(thread.title)} ${thread.codebase} ${thread.workspacePath} ${thread.id}`}
						>
							<span className="min-w-0 flex-1 truncate">
								{normalizeTitle(thread.title)}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">
								{thread.time}
							</span>
						</CommandItem>
					))}
				</CommandList>
			</CommandDialog>
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

function CategorySection({
	label,
	count,
	collapsed,
	onToggle,
	children,
}: {
	label: string;
	count: number;
	collapsed: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<div className="mb-1 min-w-0">
			<button
				aria-expanded={!collapsed}
				className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-sm font-medium text-sidebar-foreground hover:bg-surface-hover-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
				onClick={onToggle}
				title={label}
				type="button"
			>
				<ChevronDown
					className={cn(
						"size-3.5 shrink-0 transition-transform",
						collapsed && "-rotate-90",
					)}
				/>
				<span className="block min-w-0 truncate">{label}</span>
				<span className="ml-auto pr-1 text-xs tabular-nums text-muted-foreground">
					{count}
				</span>
			</button>
			{!collapsed ? (
				<div className="flex min-w-0 flex-col gap-0.5">{children}</div>
			) : null}
		</div>
	);
}

function ProjectSection({
	label,
	collapsed,
	onToggle,
	children,
}: {
	label: string;
	collapsed: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<div className="mb-1 min-w-0">
			<button
				aria-expanded={!collapsed}
				className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-sm font-medium text-sidebar-foreground hover:bg-surface-hover-lighter focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
				onClick={onToggle}
				title={label}
				type="button"
			>
				<ChevronDown
					className={cn(
						"size-3.5 shrink-0 transition-transform",
						collapsed && "-rotate-90",
					)}
				/>
				<span className="block min-w-0 truncate">{label}</span>
			</button>
			{!collapsed ? <div className="pl-3">{children}</div> : null}
		</div>
	);
}

function ThreadItem({
	thread,
	editTitle,
	editing,
	hoverCardOpen,
	isActive,
	onClick,
	onHoverCardOpenChange,
	onCancelRename,
	onCommitRename,
	onEditTitleChange,
	onRename,
	onTogglePin,
	onFork,
	onDelete,
	pendingAction,
	unread,
}: {
	thread: Thread;
	editTitle: string;
	editing: boolean;
	hoverCardOpen: boolean;
	isActive: boolean;
	onClick: () => void;
	onHoverCardOpenChange: (open: boolean) => void;
	onCancelRename: () => void;
	onCommitRename: () => void;
	onEditTitleChange: (title: string) => void;
	onRename: () => void;
	onTogglePin: () => void;
	onFork: () => void;
	onDelete: () => void;
	pendingAction: "rename" | "fork" | "delete" | null;
	unread: boolean;
}) {
	const title = normalizeTitle(thread.title);
	const overviewTitle = getSessionOverviewTitle(title);
	const pending = pendingAction !== null;
	const statusDotClass = pending
		? "bg-yellow-400"
		: thread.status === "running"
			? "bg-green-500"
			: unread
				? "bg-blue-500"
				: "";
	const infoItems = getSessionOverviewItems(thread);

	if (editing) {
		return (
			<div
				className={cn(
					"grid h-8 w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-md px-2",
					isActive
						? "bg-surface-hover text-sidebar-foreground"
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
			<HoverCard
				closeDelay={100}
				onOpenChange={onHoverCardOpenChange}
				open={hoverCardOpen}
				openDelay={0}
			>
				<ContextMenuTrigger asChild>
					<HoverCardTrigger asChild>
						<button
							className={cn(
								"group grid h-8 w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 overflow-hidden rounded-md px-2 text-left text-sm font-normal",
								isActive
									? "bg-surface-hover text-sidebar-foreground"
									: "text-sidebar-foreground/80 hover:bg-surface-hover",
							)}
							disabled={pending}
							onClick={onClick}
							type="button"
						>
							<span className="flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden">
								{thread.isScheduled ? (
									<Clock3
										aria-label="Scheduled"
										className="size-3 shrink-0 text-muted-foreground"
									/>
								) : null}
								<span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-normal leading-tight">
									{title}
								</span>
							</span>
							<span className="flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground">
								{statusDotClass ? (
									<span
										aria-hidden="true"
										className={cn("size-1.5 rounded-full", statusDotClass)}
									/>
								) : null}
								{thread.pinned ? (
									<Pin aria-label="Pinned" className="size-3 fill-current" />
								) : null}
								<span>{thread.time}</span>
							</span>
						</button>
					</HoverCardTrigger>
				</ContextMenuTrigger>
				<HoverCardContent
					align="start"
					avoidCollisions={false}
					className="w-72 p-3"
					// Same flash-on-click suppression as the logo hover card: a
					// click on the row is a pointer-down outside the card, and the
					// dismiss + refocus cycle makes the card blink.
					onPointerDownOutside={(event) => event.preventDefault()}
					side="right"
					sideOffset={8}
				>
					<div className="min-w-0 space-y-2">
						<div className="wrap-break-word text-sm font-medium">
							{overviewTitle}
						</div>
						<div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
							{infoItems.map(([label, value, fullValue]) => (
								<div className="contents" key={label}>
									<span className="text-muted-foreground">{label}</span>
									<span
										className="min-w-0 truncate font-mono text-foreground"
										title={fullValue}
									>
										{value}
									</span>
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
				onTogglePin={onTogglePin}
				pendingAction={pendingAction}
				pinned={Boolean(thread.pinned)}
			/>
		</ContextMenu>
	);
}

export function getSessionOverviewTitle(title: string): string {
	const firstLine = title.split(/\r?\n/, 1)[0] ?? "";
	return normalizeTitle(firstLine);
}

export function getSessionOverviewItems(
	thread: SessionThread,
): Array<[string, string, string?]> {
	// Updated time is already visible in the sidebar item.
	const workspacePath = thread.workspacePath || thread.codebase;
	const items: Array<[string, string | null | undefined, string?]> = [
		[
			"Workspace",
			workspaceDisplayName(workspacePath),
			workspacePath || undefined,
		],
		["Branch", thread.gitBranch],
		["Provider", thread.provider],
		["Model", thread.model],
		["Tokens", formatTokenCount(thread.inputTokens, thread.outputTokens)],
		["Cost", formatCostUsd(thread.totalCostUsd)],
		["Source", thread.source],
	];
	return items.filter((item): item is [string, string, string?] =>
		Boolean(item[1]),
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
	pinned,
	onRename,
	onTogglePin,
	onFork,
	onDelete,
	pendingAction,
}: {
	pinned: boolean;
	onRename: () => void;
	onTogglePin: () => void;
	onFork: () => void;
	onDelete: () => void;
	pendingAction: "rename" | "fork" | "delete" | null;
}) {
	const pending = pendingAction !== null;
	return (
		<ContextMenuContent className="w-40">
			<ContextMenuItem disabled={pending} onSelect={onTogglePin}>
				<Pin className={cn("size-4", pinned && "fill-current")} />
				{pinned ? "Unpin" : "Pin"}
			</ContextMenuItem>
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
