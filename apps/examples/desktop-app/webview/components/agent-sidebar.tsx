"use client";

import {
	ArrowDownUp,
	ChevronDown,
	Clock3,
	Filter,
	FolderTree,
	GitFork,
	Home,
	Loader2,
	MessageSquare,
	PanelLeftOpen,
	Pencil,
	Pin,
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
import type {
	SessionThread,
	UseSessionHistoryResult,
} from "@/hooks/use-session-history";
import { formatCostUsd, formatTokenCount } from "@/hooks/use-session-history";
import {
	groupThreadsByProject,
	INITIAL_VISIBLE_THREAD_COUNT,
	workspaceDisplayName,
} from "@/lib/sidebar-session-organization";
import { cn } from "@/lib/utils";

type Thread = SessionThread;
type AppView = "chat" | "sessions" | "settings";

const filterOptions = ["All", "Running", "Recent", "Pinned"] as const;
type FilterOption = (typeof filterOptions)[number];
type SidebarSortMode = "time" | "project";

export function AgentSidebar({
	isHomeActive,
	onHome,
	onNewThread,
	setView,
	view,
	activeSessionId,
	sessionHistory,
}: {
	isHomeActive: boolean;
	onHome: () => void;
	onNewThread?: () => void;
	setView: (view: AppView) => void;
	view: AppView;
	activeSessionId?: string | null;
	sessionHistory: UseSessionHistoryResult;
}) {
	const { isMobile, setOpen, setOpenMobile, state } = useSidebar();
	const isCollapsed = !isMobile && state === "collapsed";
	const {
		deleteThread: deleteHistoryThread,
		forkThread: forkHistoryThread,
		isLoadingHistory,
		isLoadingMore,
		loadOlderSessions,
		loadMoreSessions,
		mayHaveMoreSessions,
		openThread: openHistoryThread,
		pendingAction,
		renameThread,
		threads,
		unreadSessionIds,
	} = sessionHistory;
	const activeThread = activeSessionId ?? "";
	const [filter, setFilter] = useState<FilterOption>("All");
	const [sortMode, setSortMode] = useState<SidebarSortMode>("time");
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [showMoreCount, setShowMoreCount] = useState(
		INITIAL_VISIBLE_THREAD_COUNT,
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

	useEffect(() => {
		if (isCollapsed && searchOpen) {
			setSearchOpen(false);
		}
	}, [isCollapsed, searchOpen]);

	const filteredThreads = useMemo(() => {
		let filtered = threads;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(t) =>
					t.title.toLowerCase().includes(q) ||
					t.codebase.toLowerCase().includes(q) ||
					t.workspacePath.toLowerCase().includes(q),
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
	const closeMobileSidebar = useCallback(() => {
		if (isMobile) setOpenMobile(false);
	}, [isMobile, setOpenMobile]);

	const openThread = useCallback(
		(threadId: string) => {
			setView("chat");
			openHistoryThread(threadId);
			closeMobileSidebar();
		},
		[closeMobileSidebar, openHistoryThread, setView],
	);

	const openNewThread = useCallback(() => {
		setView("chat");
		onNewThread?.();
		closeMobileSidebar();
	}, [closeMobileSidebar, onNewThread, setView]);
	const openHome = useCallback(() => {
		onHome();
		closeMobileSidebar();
	}, [closeMobileSidebar, onHome]);
	const openSessions = useCallback(() => {
		setView("sessions");
		closeMobileSidebar();
	}, [closeMobileSidebar, setView]);
	const openSettings = useCallback(() => {
		setView("settings");
		closeMobileSidebar();
	}, [closeMobileSidebar, setView]);

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
	const sessionThreads = useMemo(
		() => filteredThreads.filter((t) => !t.pinned),
		[filteredThreads],
	);
	const displayedThreads = useMemo(
		() =>
			filter === "All"
				? [...pinnedThreads, ...sessionThreads.slice(0, showMoreCount)]
				: [...pinnedThreads, ...sessionThreads].slice(0, showMoreCount),
		[filter, pinnedThreads, sessionThreads, showMoreCount],
	);
	const showTimeShowMore =
		sessionThreads.length > showMoreCount ||
		(filter === "All" && !searchQuery && mayHaveMoreSessions);
	const projectGroups = useMemo(
		() => groupThreadsByProject([...pinnedThreads, ...sessionThreads]),
		[pinnedThreads, sessionThreads],
	);

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
					className="m-0! inline-flex size-8 items-center justify-center rounded-md p-0! text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
	const sortMenu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`Sort sessions: ${sortMode === "time" ? "Time" : "Project"}`}
					className="m-0! inline-flex size-8 items-center justify-center rounded-md p-0! text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
					size="icon"
					title={sortMode === "time" ? "Sort by time" : "Sort by project"}
					variant="ghost"
				>
					<ArrowDownUp className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuRadioGroup
					onValueChange={(value) => {
						if (value === "time" || value === "project") {
							setSortMode(value);
						}
					}}
					value={sortMode}
				>
					<DropdownMenuRadioItem value="time">
						<Clock3 className="size-4" />
						Sort by time
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="project">
						<FolderTree className="size-4" />
						Sort by project
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
	const threadItem = (thread: Thread) => (
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
				pendingAction?.sessionId === thread.id ? pendingAction.action : null
			}
			thread={thread}
			unread={unreadSessionIds.has(thread.id)}
		/>
	);

	return (
		<>
			<div className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
				<div
					className={cn(
						"flex h-16 shrink-0 items-center px-4",
						isCollapsed && "justify-center px-0",
					)}
				>
					<button
						aria-label="Cline home"
						className="rounded-md p-1 text-sidebar-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
						onClick={openHome}
						type="button"
					>
						<ClineLogo className="h-6 w-6" />
					</button>
				</div>

				<div className={cn("shrink-0 px-3", isCollapsed && "px-1.5")}>
					<Button
						className={cn(
							"min-w-0 justify-start",
							view === "chat" &&
								isHomeActive &&
								"bg-sidebar-accent text-sidebar-accent-foreground",
							isCollapsed && "mx-auto size-9 justify-center px-0",
						)}
						aria-label="Home"
						onClick={openHome}
						title="Home"
						variant="sidebarItem"
					>
						<Home className="size-4" />
						{!isCollapsed ? "Home" : null}
					</Button>
				</div>

				{isCollapsed ? (
					<div className="mt-2 flex min-h-0 flex-1 flex-col items-center gap-1 px-1.5">
						<Button
							aria-label="New session"
							className="mx-auto size-9 justify-center px-0"
							onClick={openNewThread}
							title="New session"
							type="button"
							variant="sidebarItem"
						>
							<MessageSquare className="size-4" />
						</Button>
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
					</div>
				) : (
					<>
						<div className="mt-5 shrink-0 px-3">
							<div className="flex h-8 items-center justify-between gap-2">
								<button
									className={cn(
										"min-w-0 truncate text-sm font-medium text-muted-foreground transition-colors hover:text-sidebar-foreground",
										view === "sessions" && "text-sidebar-foreground",
									)}
									onClick={openSessions}
									type="button"
								>
									{sortMode === "time" ? "Sessions" : "Projects"}
								</button>
								<div className="flex shrink-0 items-center gap-0.5">
									<Button
										aria-label="Search sessions"
										className="m-0! size-8 p-0! text-muted-foreground hover:text-sidebar-foreground"
										onClick={() => setSearchOpen((current) => !current)}
										size="icon"
										title="Search sessions"
										type="button"
										variant="ghost"
									>
										<Search className="size-3.5" />
									</Button>
									{sortMenu}
									{filterMenu}
									<Button
										aria-label="New session"
										className="m-0! size-8 p-0! text-muted-foreground hover:text-sidebar-foreground"
										onClick={openNewThread}
										size="icon"
										title="New session"
										type="button"
										variant="ghost"
									>
										<Plus className="size-4" />
									</Button>
								</div>
							</div>
							{searchOpen ? (
								<div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden rounded-md border border-sidebar-border bg-background/70 px-2 py-1">
									<Search className="size-4 shrink-0" />
									<Input
										className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm text-sidebar-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-0"
										autoFocus={true}
										onChange={(e) => setSearchQuery(e.target.value)}
										placeholder="Search sessions..."
										value={searchQuery}
									/>
								</div>
							) : null}
						</div>

						<div className="mt-1 min-h-0 w-full flex-1">
							<ScrollArea className="h-full min-h-0 w-full min-w-0">
								<div className="flex min-w-0 flex-col gap-0.5 pb-3 px-3">
									{isLoadingHistory && threads.length === 0 ? (
										<div className="p-4 text-xs text-muted-foreground">
											Loading session history...
										</div>
									) : (
										<>
											{sortMode === "time"
												? displayedThreads.map(threadItem)
												: projectGroups.map((project) => {
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
																		className="pl-2"
																		onClick={() =>
																			showMoreForProject(project.id)
																		}
																		type="button"
																		variant="sidebarText"
																	>
																		Show more in {project.label}
																		<ChevronDown className="size-3" />
																	</Button>
																) : null}
															</ProjectSection>
														);
													})}

											{(sortMode === "time"
												? displayedThreads.length === 0
												: projectGroups.length === 0) && (
												<div className="px-2 py-4 text-xs text-muted-foreground">
													{searchQuery
														? "No sessions match your search."
														: "No sessions found in history."}
												</div>
											)}
										</>
									)}
									{sortMode === "time" && showTimeShowMore && (
										<Button
											className="pl-0"
											disabled={isLoadingMore}
											onClick={() => {
												const nextCount =
													showMoreCount + INITIAL_VISIBLE_THREAD_COUNT;
												setShowMoreCount(nextCount);
												void loadMoreSessions(nextCount);
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
									{sortMode === "project" &&
										filter === "All" &&
										!searchQuery &&
										mayHaveMoreSessions && (
											<Button
												className="pl-0"
												disabled={isLoadingMore}
												onClick={() => void loadOlderSessions()}
												type="button"
												variant="sidebarText"
											>
												{isLoadingMore ? (
													<>
														<Loader2 className="size-3 animate-spin" />
														Loading older projects...
													</>
												) : (
													<>
														Load older projects
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

				<div className="shrink-0 border-t border-sidebar-border/70 px-2 py-3">
					<Button
						type="button"
						variant="sidebarItem"
						className={cn(
							"min-w-0 justify-start",
							view === "settings" &&
								"bg-sidebar-accent text-sidebar-accent-foreground",
							isCollapsed && "mx-auto size-9 justify-center px-0",
						)}
						onClick={openSettings}
						title="Settings"
					>
						<Settings className="size-4" />
						{!isCollapsed ? "Settings" : null}
					</Button>
					{!isCollapsed ? (
						<div className="mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sidebar-foreground">
							<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
								C
							</span>
							<span className="min-w-0">
								<span className="block truncate text-sm font-medium">
									Cline Desktop
								</span>
								<span className="block text-[11px] text-muted-foreground">
									Local
								</span>
							</span>
						</div>
					) : null}
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
				className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-1 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
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
	const workspacePath = thread.workspacePath || thread.codebase;
	const statusDotClass = pending
		? "bg-yellow-400"
		: thread.status === "running"
			? "bg-green-500"
			: unread
				? "bg-blue-500"
				: "";
	const infoItems: Array<[string, string | null | undefined, string?]> = [
		["ID", thread.id],
		[
			"Workspace",
			workspaceDisplayName(workspacePath),
			workspacePath || undefined,
		],
		["Status", thread.status],
		["Updated", thread.time],
		["Provider", thread.provider],
		["Model", thread.model],
		["Tokens", tokenLabel],
		["Cost", costLabel],
	].filter((item): item is [string, string, string?] => Boolean(item[1]));

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
							<span className="block max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-normal leading-tight">
								{title}
							</span>
							<span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
								{thread.pinned ? (
									<Pin aria-label="Pinned" className="size-3" />
								) : statusDotClass ? (
									<span
										aria-hidden="true"
										className={cn("size-1.5 rounded-full", statusDotClass)}
									/>
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
					side="right"
					sideOffset={8}
				>
					<div className="min-w-0 space-y-2">
						<div className="truncate text-sm font-medium">{title}</div>
						<div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
							{infoItems.map(([label, value, fullValue]) => (
								<div className="contents" key={label}>
									<span className="text-muted-foreground">{label}</span>
									<span
										className="min-w-0 truncate font-mono"
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
