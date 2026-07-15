"use client";

import {
	ChevronDown,
	Filter,
	GitFork,
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
import { cn } from "@/lib/utils";

type Thread = SessionThread;

const filterOptions = ["All", "Running", "Recent", "Pinned"] as const;
type FilterOption = (typeof filterOptions)[number];
const INITIAL_VISIBLE_THREAD_COUNT = 10;

export function AgentSidebar({
	onNewThread,
	setView,
	activeSessionId,
	sessionHistory,
}: {
	onNewThread?: () => void;
	setView: (view: "chat" | "sessions" | "settings") => void;
	activeSessionId?: string | null;
	sessionHistory: UseSessionHistoryResult;
}) {
	const { isMobile, setOpen, state } = useSidebar();
	const isCollapsed = !isMobile && state === "collapsed";
	const {
		deleteThread: deleteHistoryThread,
		forkThread: forkHistoryThread,
		isLoadingHistory,
		isLoadingMore,
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

	const openThread = useCallback(
		(threadId: string) => {
			setView("chat");
			openHistoryThread(threadId);
		},
		[openHistoryThread, setView],
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
	const showShowMore =
		sessionThreads.length > showMoreCount || mayHaveMoreSessions;

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
								) : (
									<>
										{displayedThreads.length > 0 && (
											<ThreadSection
												action={filterMenu}
												label={filter === "All" ? "Sessions" : filter}
												onClick={() => setView("sessions")}
											>
												{displayedThreads.map((thread) => (
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

										{displayedThreads.length === 0 && (
											<div className="p-4 text-xs text-muted-foreground">
												{searchQuery
													? "No sessions match your search."
													: "No sessions found in history."}
											</div>
										)}
									</>
								)}
								{showShowMore && (
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
	onClick,
	children,
}: {
	label: string;
	action?: ReactNode;
	onClick?: () => void;
	children: ReactNode;
}) {
	return (
		<div className={cn("mb-1 min-w-0")}>
			<div className="flex h-9 w-full min-w-0 flex-nowrap items-center gap-1 text-sm font-medium text-muted-foreground">
				<button
					aria-label={`Open ${label} sessions view`}
					className="flex min-w-0 flex-1 items-center self-stretch rounded-md pl-0 pr-2 text-left transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onClick}
					type="button"
				>
					<span className="block min-w-0 shrink truncate">{label}</span>
				</button>
				{action ? (
					<div className="flex shrink-0 items-center">{action}</div>
				) : null}
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
		["ID", thread.id],
		["Workspace", thread.codebase],
		["Branch", thread.gitBranch],
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
							{thread.pinned ? (
								<Pin
									aria-label="Pinned"
									className="size-3 shrink-0 text-muted-foreground"
								/>
							) : statusDotClass ? (
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
