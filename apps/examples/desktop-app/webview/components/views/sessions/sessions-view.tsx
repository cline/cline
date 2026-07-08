"use client";

import {
	ArrowUpDown,
	Check,
	Filter,
	Folder,
	GitFork,
	Loader2,
	MoreHorizontal,
	Pencil,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
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
	parseTimestamp,
	type SessionThread,
	type UseSessionHistoryResult,
} from "@/hooks/use-session-history";
import type { SessionHistoryItem } from "@/lib/session-history";
import { cn } from "@/lib/utils";

type SessionsViewProps = {
	activeSessionId?: string | null;
	history: UseSessionHistoryResult;
};

function statusTone(status?: string): string {
	if (status === "running") return "bg-green-500";
	if (status === "completed") return "bg-emerald-400";
	if (status === "failed") return "bg-destructive";
	if (status === "cancelled") return "bg-yellow-500";
	return "bg-muted-foreground";
}

function modelLabel(thread: SessionThread): string {
	if (thread.provider && thread.model) {
		return `${thread.provider}:${thread.model}`;
	}
	return thread.model || thread.provider || "No model";
}

function tokensLabel(thread: SessionThread): string {
	if (thread.inputTokens == null && thread.outputTokens == null) {
		return "-";
	}
	return `${thread.inputTokens ?? 0}/${thread.outputTokens ?? 0}`;
}

function sessionFilterDetails(
	thread: SessionThread,
	session?: SessionHistoryItem,
): string[] {
	const workspacePath = session?.workspaceRoot || session?.cwd || "";
	const workspace = workspacePath ? basenamePath(workspacePath) : "";
	return [
		workspace ? `workspace:${workspace}` : undefined,
		thread.status ? `status:${thread.status}` : undefined,
		thread.provider ? `provider:${thread.provider}` : undefined,
		thread.model ? `model:${thread.model}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function sortTimestamp(session?: SessionHistoryItem) {
	const timestamp = parseTimestamp(session?.endedAt || session?.startedAt);
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

	const toggleFilter = (detail: string, checked: boolean) => {
		setSessionFilters((current) => {
			if (checked) {
				return current.includes(detail) ? current : [...current, detail];
			}
			return current.filter((item) => item !== detail);
		});
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
			<header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-4">
				<div className="min-w-0">
					<h1 className="text-lg font-semibold leading-tight">Sessions</h1>
					<p className="mt-1 text-sm text-muted-foreground">
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
								{sortDirection === "newest" ? "Newest first" : "Newest first"}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setSortDirection("oldest")}>
								{sortDirection === "oldest" ? "Oldest first" : "Oldest first"}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<DropdownMenu>
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

			<section className="min-h-0 flex-1 overflow-auto px-6 py-5">
				<div className="min-w-240 overflow-hidden rounded-lg border bg-card">
					<div className="grid grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem_2.5rem] gap-x-4 bg-muted/40 px-4 py-3 text-sm font-medium text-muted-foreground">
						<span>Session</span>
						<span>Workspace</span>
						<span>Model</span>
						<span>Tokens</span>
						<span>Cost</span>
						<span>Updated</span>
						<span />
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
						{filteredThreads.map((thread) => {
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
										"grid min-h-14 grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem_2.5rem] items-center gap-x-4 border-t px-4 py-3 text-sm transition-colors",
										activeSessionId === thread.id
											? "bg-accent/50"
											: "hover:bg-accent/30",
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
											<span className="truncate text-muted-foreground">
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
										<button
											className="col-span-6 grid cursor-pointer select-text grid-cols-[minmax(14rem,1.35fr)_minmax(9rem,0.8fr)_minmax(12rem,1fr)_7rem_5rem_6rem] items-center gap-x-4 border-0 bg-transparent p-0 text-left font-inherit text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-default"
											disabled={Boolean(pendingKind)}
											onClick={() => {
												if (pendingKind) {
													return;
												}
												// Don't open the session when the user is selecting text.
												if (window.getSelection()?.toString()) {
													return;
												}
												history.openThread(thread.id);
											}}
											type="button"
										>
											<span className="flex min-w-0 items-center gap-3 font-semibold">
												<span
													className={cn(
														"size-1.5 shrink-0 rounded-full",
														statusTone(thread.status),
													)}
												/>
												<span className="truncate">{thread.title}</span>
											</span>
											<span className="flex min-w-0 items-center gap-2 text-muted-foreground">
												<Folder className="size-3.5 shrink-0" />
												<span className="truncate" title={workspace}>
													{workspace ? basenamePath(workspace) : "No workspace"}
												</span>
											</span>
											<span className="truncate text-muted-foreground">
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
										</button>
									)}
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button
												aria-label={`Session actions for ${thread.title}`}
												className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
							);
						})}
						{history.mayHaveMoreSessions ? (
							<div className="border-t px-4 py-3">
								<Button
									className="h-8 rounded-md px-3 text-xs"
									disabled={history.isLoadingMore}
									onClick={() =>
										void history.loadMoreSessions(history.threads.length + 100)
									}
									type="button"
									variant="outline"
								>
									{history.isLoadingMore ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : null}
									Load more
								</Button>
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
