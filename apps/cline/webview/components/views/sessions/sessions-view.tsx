"use client";

import { SessionStatus } from "@cline/ui";
import {
	ArrowUpDown,
	Check,
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	Filter,
	Folder,
	GitFork,
	Loader2,
	MoreHorizontal,
	Pencil,
	Search,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
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
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	basenamePath,
	formatCostUsd,
	formatRelativeTime,
	type SessionThread,
	sessionActivityTimestamp,
	type UseSessionHistoryResult,
} from "@/hooks/use-session-history";
import type { SessionHistoryItem } from "@/lib/session-history";
import { sessionStatusColor, sessionStatusTone } from "@/lib/session-status";
import { cn } from "@/lib/utils";

type SessionsViewProps = {
	activeSessionId?: string | null;
	history: UseSessionHistoryResult;
};

const PAGE_SIZE = 10;

function modelLabel(thread: SessionThread): string {
	if (thread.provider && thread.model) {
		return `${thread.provider}:${thread.model}`;
	}
	return thread.model || thread.provider || "No model";
}

export function formatCompactTokens(value: number): string {
	if (!Number.isFinite(value) || value < 0) {
		return "0";
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}m`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return `${value}`;
}

const MAX_PAGE_BUTTONS = 7;

/**
 * Page buttons for a 1-indexed pager: every page while the list is short, and
 * first/last plus a window around the current page once it grows.
 */
export function paginationItems(
	currentPage: number,
	pageCount: number,
): Array<number | "gap-start" | "gap-end"> {
	if (pageCount <= MAX_PAGE_BUTTONS) {
		return Array.from({ length: pageCount }, (_, index) => index + 1);
	}
	const windowStart = Math.max(
		2,
		Math.min(currentPage - 1, pageCount - MAX_PAGE_BUTTONS + 3),
	);
	const windowEnd = Math.min(
		pageCount - 1,
		Math.max(currentPage + 1, MAX_PAGE_BUTTONS - 2),
	);
	const items: Array<number | "gap-start" | "gap-end"> = [1];
	if (windowStart > 2) {
		items.push("gap-start");
	}
	for (let page = windowStart; page <= windowEnd; page += 1) {
		items.push(page);
	}
	if (windowEnd < pageCount - 1) {
		items.push("gap-end");
	}
	items.push(pageCount);
	return items;
}

function tokensLabel(thread: SessionThread): string {
	if (thread.inputTokens == null && thread.outputTokens == null) {
		return "-";
	}
	const input = formatCompactTokens(thread.inputTokens ?? 0);
	const output = formatCompactTokens(thread.outputTokens ?? 0);
	return `${input}/${output}`;
}

function sessionFilterDetails(
	thread: SessionThread,
	session?: SessionHistoryItem,
): string[] {
	const workspacePath = session?.workspaceRoot || session?.cwd || "";
	const workspace = workspacePath ? basenamePath(workspacePath) : "";
	return [
		thread.pinned ? "favorite:yes" : undefined,
		workspace ? `workspace:${workspace}` : undefined,
		thread.status ? `status:${thread.status}` : undefined,
		thread.provider ? `provider:${thread.provider}` : undefined,
		thread.model ? `model:${thread.model}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function sortTimestamp(session?: SessionHistoryItem) {
	if (!session) {
		return 0;
	}
	const timestamp = sessionActivityTimestamp(session);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

export function SessionsView({ activeSessionId, history }: SessionsViewProps) {
	const [query, setQuery] = useState("");
	const [sessionFilters, setSessionFilters] = useState<string[]>([]);
	const [sortDirection, setSortDirection] = useState<"newest" | "oldest">(
		"newest",
	);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [deleteCandidate, setDeleteCandidate] = useState<SessionThread | null>(
		null,
	);
	const [page, setPage] = useState(0);
	const requiresCompleteHistory =
		query.trim().length > 0 ||
		sessionFilters.length > 0 ||
		sortDirection === "oldest";

	useEffect(() => {
		if (!requiresCompleteHistory || !history.mayHaveMoreSessions) {
			return;
		}
		void history.loadAllSessions();
	}, [
		history.loadAllSessions,
		history.mayHaveMoreSessions,
		requiresCompleteHistory,
	]);

	const filterOptions = useMemo(
		() =>
			Array.from(
				new Set(
					history.threads.flatMap((thread) =>
						sessionFilterDetails(thread, history.sessionById.get(thread.id)),
					),
				),
			).sort((a, b) => a.localeCompare(b)),
		[history.sessionById, history.threads],
	);

	const filteredThreads = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase();
		const selected = new Set(sessionFilters);
		const filtered = history.threads.filter((thread) => {
			const session = history.sessionById.get(thread.id);
			const details = sessionFilterDetails(thread, session);
			const matchesFilters =
				selected.size === 0 || details.some((detail) => selected.has(detail));
			if (!matchesFilters) {
				return false;
			}
			if (!normalizedQuery) {
				return true;
			}
			const searchable = [
				thread.title,
				thread.codebase,
				thread.provider,
				thread.model,
				session?.workspaceRoot,
				session?.cwd,
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return searchable.includes(normalizedQuery);
		});
		return [...filtered].sort((a, b) => {
			const aTime = sortTimestamp(history.sessionById.get(a.id));
			const bTime = sortTimestamp(history.sessionById.get(b.id));
			return sortDirection === "newest" ? bTime - aTime : aTime - bTime;
		});
	}, [
		history.sessionById,
		history.threads,
		query,
		sessionFilters,
		sortDirection,
	]);

	const pageCount = Math.max(1, Math.ceil(filteredThreads.length / PAGE_SIZE));
	const currentPage = Math.min(page, pageCount - 1);
	const pageStart = currentPage * PAGE_SIZE;
	const visibleThreads = useMemo(
		() => filteredThreads.slice(pageStart, pageStart + PAGE_SIZE),
		[filteredThreads, pageStart],
	);
	const canGoNext =
		currentPage + 1 < pageCount ||
		(history.mayHaveMoreSessions && !requiresCompleteHistory);

	// Snap back when a page disappears (filters changed, or "next" asked the
	// backend for older sessions and there were none left).
	useEffect(() => {
		setPage((current) => Math.min(current, pageCount - 1));
	}, [pageCount]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: restart paging whenever the result set changes
	useEffect(() => {
		setPage(0);
	}, [query, sessionFilters, sortDirection]);

	const goToNextPage = async () => {
		const nextPage = currentPage + 1;
		if (
			nextPage >= pageCount &&
			history.mayHaveMoreSessions &&
			!requiresCompleteHistory
		) {
			// Only page boundaries hit the backend; the mount fetch stays small.
			// Stay put when the fetch fails so the user keeps the page they can
			// see and the same click retries.
			if (!(await history.loadOlderSessions())) {
				return;
			}
		}
		setPage(nextPage);
	};

	const toggleFilter = (detail: string, checked: boolean) => {
		setSessionFilters((current) => {
			if (checked) {
				return current.includes(detail) ? current : [...current, detail];
			}
			return current.filter((item) => item !== detail);
		});
	};

	const openRow = (thread: SessionThread) => {
		if (history.pendingAction?.sessionId === thread.id) {
			return;
		}
		// Don't open the session when the click only finished a text selection.
		if (window.getSelection()?.toString()) {
			return;
		}
		history.openThread(thread.id);
	};

	const startRename = (thread: SessionThread) => {
		setEditingSessionId(thread.id);
		setEditingTitle(thread.title);
	};

	const cancelRename = () => {
		setEditingSessionId(null);
		setEditingTitle("");
	};

	const submitRename = async (thread: SessionThread) => {
		const renamed = await history.renameThread(thread.id, editingTitle);
		if (renamed) {
			cancelRename();
		}
	};

	const confirmDelete = async () => {
		if (!deleteCandidate) {
			return;
		}
		const deleted = await history.deleteThread(deleteCandidate.id);
		if (deleted) {
			setDeleteCandidate(null);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
			<header className="flex shrink-0 items-end justify-between gap-6 px-18 pb-7 pt-10 max-[1200px]:px-8 max-md:pl-12 max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:pr-4 max-[720px]:pt-5">
				<div className="min-w-0">
					<h1 className="text-3xl font-semibold">Sessions</h1>
					<p className="mt-3 text-base leading-6 text-muted-foreground">
						Recent sessions across clients and workspaces.
					</p>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<div className="relative min-w-44 max-w-72 flex-1">
						<Search className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 size-4 text-muted-foreground" />
						<Input
							aria-label="Search sessions"
							className="h-8 pl-8"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search"
							value={query}
						/>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label="Sort sessions"
								className="h-8 rounded-md px-2.5"
								size="sm"
								title="Sort sessions"
								type="button"
								variant="outline"
							>
								<ArrowUpDown className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" sideOffset={6}>
							<DropdownMenuItem onClick={() => setSortDirection("newest")}>
								Newest first
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setSortDirection("oldest")}>
								Oldest first
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<DropdownMenu
						onOpenChange={(open) => {
							// Filter choices are derived from the loaded rows, so
							// complete the history as soon as the user opens this
							// menu. This keeps both the options and their results
							// global rather than limited to the newest batch.
							if (open && history.mayHaveMoreSessions) {
								void history.loadAllSessions();
							}
						}}
					>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label="Filter sessions"
								className="h-8 rounded-md px-2.5"
								size="sm"
								title="Filter sessions"
								type="button"
								variant={sessionFilters.length > 0 ? "default" : "outline"}
							>
								<Filter className="size-4" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="max-h-72 w-72">
							<DropdownMenuGroup>
								<DropdownMenuLabel>Filter sessions</DropdownMenuLabel>
								{sessionFilters.length > 0 ? (
									<>
										<DropdownMenuItem onClick={() => setSessionFilters([])}>
											Clear filters
										</DropdownMenuItem>
										<DropdownMenuSeparator />
									</>
								) : null}
								{filterOptions.length === 0 ? (
									<DropdownMenuItem disabled>
										No filters available
									</DropdownMenuItem>
								) : (
									filterOptions.map((detail) => (
										<DropdownMenuCheckboxItem
											checked={sessionFilters.includes(detail)}
											key={detail}
											onCheckedChange={(checked) =>
												toggleFilter(detail, checked === true)
											}
										>
											<span className="truncate" title={detail}>
												{detail}
											</span>
										</DropdownMenuCheckboxItem>
									))
								)}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			<section className="min-h-0 flex-1 overflow-auto px-18 pb-10 max-[1200px]:px-8 max-[720px]:px-4">
				<div className="min-w-240 overflow-hidden rounded-lg border bg-card">
					<div className="grid grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem_1.75rem] gap-x-4 bg-muted/40 px-4 py-3 text-sm font-medium text-muted-foreground">
						<span>Title</span>
						<span>Workspace</span>
						<span>Model</span>
						<span>Tokens</span>
						<span>Cost</span>
						<span>Time</span>
						<span className="sr-only">Actions</span>
					</div>
					<div>
						{history.isLoadingHistory && history.threads.length === 0 ? (
							<div className="flex items-center gap-2 border-t px-4 py-8 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading session history...
							</div>
						) : null}
						{!history.isLoadingHistory && filteredThreads.length === 0 ? (
							<div className="border-t px-4 py-8 text-sm text-muted-foreground">
								{history.threads.length === 0
									? "No sessions yet."
									: "No sessions match the current filters."}
							</div>
						) : null}
						{visibleThreads.map((thread) => {
							const session = history.sessionById.get(thread.id);
							const isEditing = editingSessionId === thread.id;
							const isPending = history.pendingAction?.sessionId === thread.id;
							const pendingKind = isPending
								? history.pendingAction?.action
								: null;
							const workspace = session?.workspaceRoot || session?.cwd || "";
							const updated = formatRelativeTime(
								session?.endedAt || session?.startedAt,
							);
							return (
								<div
									className={cn(
										// Fixed height: every row is the same size so the table
										// never reflows as long values wrap or hydrate in.
										"grid h-14 grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem_1.75rem] items-center gap-x-4 border-t px-4 text-sm transition-colors",
										activeSessionId === thread.id
											? "bg-surface-hover"
											: "hover:bg-surface-hover-lighter",
									)}
									key={thread.id}
								>
									{isEditing ? (
										<form
											className="col-span-6 grid grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem] items-center gap-x-4"
											onSubmit={(event) => {
												event.preventDefault();
												void submitRename(thread);
											}}
										>
											<div className="col-span-2 flex min-w-0 items-center gap-2">
												<Input
													aria-label={`Rename ${thread.title}`}
													autoFocus
													className="h-8"
													disabled={pendingKind === "rename"}
													onChange={(event) =>
														setEditingTitle(event.target.value)
													}
													onKeyDown={(event) => {
														if (event.key === "Escape") {
															event.preventDefault();
															cancelRename();
														}
													}}
													value={editingTitle}
												/>
												<Button
													aria-label="Save title"
													className="h-8 rounded-md px-2.5"
													disabled={
														pendingKind === "rename" || !editingTitle.trim()
													}
													size="sm"
													type="submit"
												>
													{pendingKind === "rename" ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<Check className="size-4" />
													)}
												</Button>
												<Button
													aria-label="Cancel rename"
													className="h-8 rounded-md px-2.5"
													disabled={pendingKind === "rename"}
													onClick={cancelRename}
													size="sm"
													type="button"
													variant="outline"
												>
													<X className="size-4" />
												</Button>
											</div>
											<span
												className="truncate text-muted-foreground"
												title={modelLabel(thread)}
											>
												{modelLabel(thread)}
											</span>
											<span className="text-muted-foreground">
												{tokensLabel(thread)}
											</span>
											<span className="text-muted-foreground">
												{formatCostUsd(thread.totalCostUsd) ?? "-"}
											</span>
											<span className="text-muted-foreground">
												{updated || thread.time}
											</span>
										</form>
									) : (
										// A native <button> suppresses drag-to-select, so the row is a
										// plain container with button semantics: the cells stay
										// selectable and a click that ends a selection does not open
										// the session.
										// biome-ignore lint/a11y/useSemanticElements: buttons are not text-selectable
										<div
											aria-disabled={Boolean(pendingKind)}
											className={cn(
												"col-span-6 grid select-text grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem] items-center gap-x-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
												pendingKind ? "cursor-default" : "cursor-pointer",
											)}
											onClick={() => openRow(thread)}
											onKeyDown={(event) => {
												if (event.key !== "Enter" && event.key !== " ") {
													return;
												}
												event.preventDefault();
												openRow(thread);
											}}
											role="button"
											tabIndex={pendingKind ? -1 : 0}
										>
											<span className="flex min-w-0 items-center gap-3 font-semibold">
												<span className="sr-only">Open session: </span>
												<SessionStatus
													className="shrink-0"
													label={`Session status: ${thread.status}`}
													showLabel={false}
													style={
														{
															"--cline-ui-session-status-color":
																sessionStatusColor(thread.status),
														} as CSSProperties
													}
													tone={sessionStatusTone(thread.status)}
												/>
												<span className="truncate">{thread.title}</span>
												{thread.pinned ? (
													<Star
														aria-label="Favorited"
														className="size-3.5 shrink-0 fill-current text-muted-foreground"
													/>
												) : null}
											</span>
											<span className="flex min-w-0 items-center gap-2 text-muted-foreground">
												<Folder className="size-3.5 shrink-0" />
												<span className="truncate" title={workspace}>
													{workspace ? basenamePath(workspace) : "No workspace"}
												</span>
											</span>
											<span
												className="truncate text-muted-foreground"
												title={modelLabel(thread)}
											>
												{modelLabel(thread)}
											</span>
											<span className="truncate text-muted-foreground">
												{tokensLabel(thread)}
											</span>
											<span className="truncate text-muted-foreground">
												{formatCostUsd(thread.totalCostUsd) ?? "-"}
											</span>
											<span className="truncate text-muted-foreground">
												{updated || thread.time}
											</span>
										</div>
									)}
									<div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<button
													aria-label={`Session actions for ${thread.title}`}
													className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													disabled={Boolean(pendingKind)}
													type="button"
												>
													{pendingKind ? (
														<Loader2 className="size-4 animate-spin" />
													) : (
														<MoreHorizontal className="size-4" />
													)}
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" sideOffset={6}>
												<DropdownMenuItem
													onClick={() =>
														void history.setThreadPinned(
															thread.id,
															!thread.pinned,
														)
													}
												>
													<Star
														className={cn(
															"size-4",
															thread.pinned && "fill-current",
														)}
													/>
													{thread.pinned ? "Unfavorite" : "Favorite"}
												</DropdownMenuItem>
												<DropdownMenuItem onClick={() => startRename(thread)}>
													<Pencil className="size-4" />
													Rename
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => void history.forkThread(thread.id)}
												>
													<GitFork className="size-4" />
													Fork
												</DropdownMenuItem>
												<DropdownMenuSeparator />
												<DropdownMenuItem
													onClick={() => setDeleteCandidate(thread)}
													variant="destructive"
												>
													<Trash2 className="size-4" />
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							);
						})}
						{filteredThreads.length > 0 ? (
							<div className="flex items-center justify-between gap-4 border-t px-4 py-3 text-xs text-muted-foreground">
								<span>
									{`${pageStart + 1}-${pageStart + visibleThreads.length} of ${filteredThreads.length}`}
									{history.mayHaveMoreSessions ? "+" : ""}
								</span>
								<div className="flex items-center gap-1">
									<Button
										aria-label="First page"
										className="h-8 rounded-md px-2.5"
										disabled={currentPage === 0 || history.isLoadingMore}
										onClick={() => setPage(0)}
										size="sm"
										title="First page"
										type="button"
										variant="outline"
									>
										<ChevronsLeft className="size-4" />
									</Button>
									<Button
										aria-label="Previous page"
										className="h-8 rounded-md px-2.5"
										disabled={currentPage === 0 || history.isLoadingMore}
										onClick={() => setPage(currentPage - 1)}
										size="sm"
										title="Previous page"
										type="button"
										variant="outline"
									>
										<ChevronLeft className="size-4" />
									</Button>
									{paginationItems(currentPage + 1, pageCount).map((item) =>
										typeof item === "number" ? (
											<Button
												aria-current={
													item === currentPage + 1 ? "page" : undefined
												}
												aria-label={`Page ${item}`}
												className="h-8 min-w-8 rounded-md px-2 tabular-nums"
												disabled={history.isLoadingMore}
												key={item}
												onClick={() => setPage(item - 1)}
												size="sm"
												type="button"
												variant={item === currentPage + 1 ? "default" : "ghost"}
											>
												{item}
											</Button>
										) : (
											<span
												aria-hidden="true"
												className="px-1 text-muted-foreground"
												key={item}
											>
												...
											</span>
										),
									)}
									<Button
										aria-label="Next page"
										className="h-8 rounded-md px-2.5"
										disabled={!canGoNext || history.isLoadingMore}
										onClick={() => void goToNextPage()}
										size="sm"
										title="Next page"
										type="button"
										variant="outline"
									>
										{history.isLoadingMore ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<ChevronRight className="size-4" />
										)}
									</Button>
								</div>
							</div>
						) : null}
					</div>
				</div>
			</section>

			<AlertDialog
				open={deleteCandidate !== null}
				onOpenChange={(open) => {
					if (!open && history.pendingAction?.action !== "delete") {
						setDeleteCandidate(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete session?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes "{deleteCandidate?.title ?? "this session"}" from
							local history.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={history.pendingAction?.action === "delete"}
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={
								!deleteCandidate || history.pendingAction?.action === "delete"
							}
							onClick={(event) => {
								event.preventDefault();
								void confirmDelete();
							}}
						>
							{history.pendingAction?.action === "delete" ? (
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
		</div>
	);
}
