"use client";

import {
	type StatusState,
	StatusStateSchema,
	type StatusUpdate,
} from "@cline/shared/browser";
import {
	Activity,
	ArrowRight,
	CircleCheck,
	CirclePause,
	Clock3,
	GitBranch,
	History,
	Loader2,
	RefreshCw,
	Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type StatusHubTab, useStatusHub } from "@/hooks/use-status-hub";
import { cn } from "@/lib/utils";
import { PageEmptyState, PageFrame, PageHeader } from "../page-layout";

const STATES: StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
	"done",
	"cancelled",
];
const LABELS: Record<StatusState, string> = {
	blocked: "Blocked",
	failed: "Failed",
	running: "Running",
	queued: "Queued",
	done: "Done",
	cancelled: "Cancelled",
};
const COLORS: Record<StatusState, string> = {
	blocked: "text-amber-600 dark:text-amber-400",
	failed: "text-destructive",
	running: "text-primary",
	queued: "text-muted-foreground",
	done: "text-emerald-600 dark:text-emerald-400",
	cancelled: "text-muted-foreground",
};

export function StatusHubView({
	onOpenSession,
}: {
	onOpenSession: (sessionId: string) => void;
}) {
	const [tab, setTab] = useState<StatusHubTab>("board");
	const [search, setSearch] = useState("");
	const [text, setText] = useState("");
	const [state, setState] = useState<StatusState | "all">("all");
	const [subject, setSubject] = useState<{
		subject: string;
		sessionId?: string;
	} | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setText(search.trim()), 250);
		return () => clearTimeout(timer);
	}, [search]);
	const query = useMemo(
		() => ({
			limit: 50,
			includeFacets: true,
			...(text ? { text } : {}),
			...(state !== "all" ? { state: [state] } : {}),
			...(subject ?? {}),
		}),
		[text, state, subject],
	);
	const hub = useStatusHub(tab, query);
	const showHistory = (row: StatusUpdate) => {
		setSubject({ subject: row.subject, sessionId: row.sessionId });
		setState("all");
		setSearch("");
		setText("");
		setTab("changelog");
	};

	return (
		<PageFrame>
			<PageHeader
				title="Status Hub"
				icon={Activity}
				description="Follow current work and the updates behind it, across chats on this computer."
				actions={
					<Button
						variant="outline"
						size="sm"
						onClick={hub.refresh}
						disabled={hub.loading}
					>
						<RefreshCw
							className={cn("size-4", hub.loading && "animate-spin")}
						/>
						Refresh
					</Button>
				}
			/>
			{hub.summary && !hub.loading && !hub.error ? (
				<section
					aria-label="Current work summary"
					className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4"
				>
					{(
						[
							["running", Activity],
							["blocked", CirclePause],
							["queued", Clock3],
							["done", CircleCheck],
						] as const
					).map(([value, Icon]) => (
						<button
							type="button"
							key={value}
							className="rounded-lg border border-border bg-card p-4 text-left hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring"
							onClick={() => {
								setSubject(null);
								setTab("board");
								setState(value);
								setSearch("");
								setText("");
							}}
						>
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Icon className={cn("size-4", COLORS[value])} />
								{LABELS[value]}
							</div>
							<div className="mt-2 text-2xl font-semibold tabular-nums">
								{hub.summary?.byState[value] ?? 0}
							</div>
						</button>
					))}
				</section>
			) : null}
			<Tabs
				value={tab}
				onValueChange={(value) => {
					setTab(value as StatusHubTab);
					setSubject(null);
				}}
			>
				<div className="mb-5 flex flex-wrap items-center justify-between gap-3">
					<TabsList aria-label="Status Hub views">
						<TabsTrigger value="board">
							<GitBranch />
							Board
						</TabsTrigger>
						<TabsTrigger value="changelog">
							<History />
							Changelog
						</TabsTrigger>
					</TabsList>
					<p className="text-xs text-muted-foreground">
						{tab === "board"
							? "Latest report per work item · attention first"
							: "Every report · newest first"}
					</p>
				</div>
				<div className="mb-5 flex flex-wrap items-center gap-3">
					<div className="relative min-w-48 flex-1">
						<Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
						<Input
							className="pl-9"
							type="search"
							aria-label="Search status updates"
							placeholder="Search headlines and details…"
							maxLength={300}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>
					<select
						aria-label="Filter by state"
						className="h-9 rounded-md border border-input bg-background px-3 text-sm"
						value={state}
						onChange={(event) =>
							setState(
								event.target.value === "all"
									? "all"
									: StatusStateSchema.parse(event.target.value),
							)
						}
					>
						<option value="all">All states</option>
						{STATES.map((value) => (
							<option key={value} value={value}>
								{LABELS[value]}
							</option>
						))}
					</select>
				</div>
				{subject ? (
					<div className="mb-4 flex items-center gap-2 text-sm">
						<span className="min-w-0 truncate text-muted-foreground">
							History for{" "}
							<span className="text-foreground">{subject.subject}</span>
						</span>
						<Button variant="ghost" size="xs" onClick={() => setSubject(null)}>
							Clear
						</Button>
					</div>
				) : null}
				{hub.connection === "unavailable" ||
				hub.connection === "reconnecting" ? (
					<output className="mb-4 block text-sm text-muted-foreground">
						Live updates disconnected. Reconnecting to the desktop backend…
					</output>
				) : null}
				{hub.newUpdates ? (
					<output className="mb-4 flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-2 text-sm">
						<span>New updates available</span>
						<Button variant="ghost" size="sm" onClick={hub.refresh}>
							Show latest
						</Button>
					</output>
				) : null}
				{hub.error ? (
					<div
						role="alert"
						className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm"
					>
						<p>Couldn’t load status updates.</p>
						<p className="mt-1 text-muted-foreground">{hub.error}</p>
						<Button
							className="mt-3"
							variant="outline"
							size="sm"
							onClick={hub.rows.length ? hub.loadMore : hub.refresh}
						>
							Retry
						</Button>
					</div>
				) : null}
				{hub.loading ? (
					<output className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Loading status updates…
					</output>
				) : null}
				{!hub.loading && !hub.error && hub.rows.length === 0 ? (
					<PageEmptyState>
						{text || state !== "all" || subject
							? "No updates match these filters."
							: "No status updates yet. Cline reports meaningful work as it starts, reaches milestones, gets blocked, and finishes. Reports from new chats will appear here."}
					</PageEmptyState>
				) : null}
				<TabsContent value={tab} className="mt-0">
					{!hub.loading && hub.rows.length > 0 ? (
						<>
							<p className="mb-3 text-xs text-muted-foreground">
								{hub.rows.length} of {hub.page?.total ?? hub.rows.length}{" "}
								{tab === "board" ? "work items" : "updates"}
							</p>
							{tab === "board" ? (
								<div className="space-y-6">
									{STATES.map((value) => {
										const rows = hub.rows.filter((row) => row.state === value);
										return rows.length ? (
											<section key={value} aria-label={`${LABELS[value]} work`}>
												<h2
													className={cn(
														"mb-3 flex items-center gap-2 text-sm font-semibold",
														COLORS[value],
													)}
												>
													<span className="size-2 rounded-full bg-current" />
													{LABELS[value]}
													<span className="text-muted-foreground font-normal">
														{rows.length}
													</span>
												</h2>
												<div className="space-y-2">
													{rows.map((row) => (
														<StatusRow
															key={row.updateId}
															row={row}
															onHistory={() => showHistory(row)}
															onOpenSession={onOpenSession}
														/>
													))}
												</div>
											</section>
										) : null;
									})}
								</div>
							) : (
								<div className="space-y-2">
									{hub.rows.map((row) => (
										<StatusRow
											key={row.updateId}
											row={row}
											historical
											onOpenSession={onOpenSession}
										/>
									))}
								</div>
							)}
							{hub.page?.hasMore ? (
								<div className="mt-6 flex justify-center">
									<Button
										variant="outline"
										disabled={hub.loadingMore}
										onClick={hub.loadMore}
									>
										{hub.loadingMore ? (
											<Loader2 className="size-4 animate-spin" />
										) : null}
										{hub.loadingMore ? "Loading…" : "Load more"}
									</Button>
								</div>
							) : null}
						</>
					) : null}
				</TabsContent>
			</Tabs>
		</PageFrame>
	);
}

function StatusRow({
	row,
	historical = false,
	onHistory,
	onOpenSession,
}: {
	row: StatusUpdate;
	historical?: boolean;
	onHistory?: () => void;
	onOpenSession: (sessionId: string) => void;
}) {
	const timestamp = new Date(row.createdAt);
	const workspace = row.workspaceRoot
		?.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.at(-1);
	return (
		<article className="rounded-lg border border-border bg-card px-4 py-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
						<span className={cn("font-medium", COLORS[row.state])}>
							{historical &&
							row.previousState &&
							row.previousState !== row.state ? (
								<>
									<span className="text-muted-foreground">
										{LABELS[row.previousState]}
									</span>
									<ArrowRight className="mx-1 inline size-3" />
								</>
							) : null}
							{LABELS[row.state]}
						</span>
						{row.priority === "high" || row.priority === "critical" ? (
							<Badge variant="outline">
								{row.priority === "critical" ? "Critical" : "High priority"}
							</Badge>
						) : null}
						{historical && row.supersededAt ? (
							<span className="text-muted-foreground">Historical</span>
						) : null}
					</div>
					<h3 className="break-words text-sm font-medium leading-6">
						{row.headline}
					</h3>
					<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span className="break-all">{row.subject}</span>
						<span title={row.agentId}>
							{row.agentName ??
								(row.agentId ? `Agent ${row.agentId.slice(-8)}` : "Cline")}
						</span>
						{workspace ? (
							<span title={row.workspaceRoot}>{workspace}</span>
						) : null}
					</div>
				</div>
				<time
					className="shrink-0 text-xs text-muted-foreground"
					dateTime={row.createdAt}
					title={timestamp.toLocaleString()}
				>
					{timestamp.toLocaleDateString(undefined, {
						month: "short",
						day: "numeric",
					})}{" "}
					·{" "}
					{timestamp.toLocaleTimeString(undefined, {
						hour: "numeric",
						minute: "2-digit",
					})}
				</time>
			</div>
			{row.progress !== undefined ? (
				<div className="mt-3 flex items-center gap-3">
					<progress
						className="h-1.5 w-full max-w-48 accent-primary"
						aria-label={`${row.subject} progress`}
						max={1}
						value={row.progress}
					/>
					<span className="text-xs text-muted-foreground">
						{Math.round(row.progress * 100)}%
					</span>
				</div>
			) : null}
			{row.detail ? (
				<details className="mt-3 text-sm">
					<summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
						Details
					</summary>
					<p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
						{row.detail}
					</p>
				</details>
			) : null}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				{row.tags.map((tag) => (
					<Badge variant="outline" key={tag}>
						{tag}
					</Badge>
				))}
				{onHistory ? (
					<Button variant="ghost" size="xs" onClick={onHistory}>
						<History className="size-3" />
						{row.historyCount ?? 1}{" "}
						{(row.historyCount ?? 1) === 1 ? "update" : "updates"}
					</Button>
				) : null}
				{row.sessionId ? (
					<Button
						variant="ghost"
						size="xs"
						onClick={() => onOpenSession(row.sessionId as string)}
					>
						Open chat
						<ArrowRight className="size-3" />
					</Button>
				) : null}
			</div>
		</article>
	);
}
