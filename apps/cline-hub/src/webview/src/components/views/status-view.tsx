/**
 * Status Hub — the changelog for every agent.
 *
 * Two genuinely different lenses over one log:
 *
 * **Board** answers "where is everything, and what needs me?" It shows one row
 * per subject (the current status), ordered by attention (blocked, then failed,
 * then running) rather than by recency, grouped under state headings, with
 * whole-table counts from the server.
 *
 * **Changelog** answers "what happened?" It is a flat chronological feed of
 * every update including superseded ones, showing state transitions.
 *
 * Both page server-side with a keyset cursor, so opening this view never pulls
 * the whole log.
 */

import type { StatusState, StatusSummary, StatusUpdate } from "@cline/shared";
import { ActivityIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { postToHost } from "../../vscode";
import { PageEmptyState, PageFrame, PageHeader } from "./page-layout";
import { relativeTime, STATE_STYLES, StatusRow } from "./status-row";

const PAGE_LIMIT = 50;

/** Board section order — what needs a human first. */
const BOARD_SECTIONS: ReadonlyArray<{ state: StatusState; blurb: string }> = [
	{ state: "blocked", blurb: "Waiting on someone. Start here." },
	{ state: "failed", blurb: "Stopped and will not continue on its own." },
	{ state: "running", blurb: "In progress right now." },
	{ state: "queued", blurb: "Accepted, not started." },
	{ state: "done", blurb: "Finished." },
	{ state: "cancelled", blurb: "Abandoned." },
];

/** Tiles that lead with what is wrong. */
const TILE_STATES: readonly StatusState[] = [
	"blocked",
	"failed",
	"running",
	"queued",
	"done",
];

export type StatusViewMode = "board" | "changelog";

function StatTile({
	label,
	count,
	active,
	onClick,
}: {
	label: StatusState;
	count: number;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			className={cn(
				"min-w-24 flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
				active ? "border-primary bg-accent" : "hover:bg-muted/50",
				count === 0 && "opacity-50",
			)}
			onClick={onClick}
			type="button"
		>
			<div className="text-2xl font-semibold tabular-nums text-foreground">
				{count}
			</div>
			<div
				className={cn(
					"text-[11px] uppercase tracking-wide",
					STATE_STYLES[label].split(" ").slice(1).join(" "),
				)}
			>
				{label}
			</div>
		</button>
	);
}

export function StatusView() {
	const [mode, setMode] = useState<StatusViewMode>("board");
	const [updates, setUpdates] = useState<StatusUpdate[]>([]);
	const [summary, setSummary] = useState<StatusSummary | null>(null);
	const [nextCursor, setNextCursor] = useState<number | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stateFilter, setStateFilter] = useState<StatusState[]>([]);
	const [agentFilter, setAgentFilter] = useState<string | null>(null);
	const [searchDraft, setSearchDraft] = useState("");
	const [search, setSearch] = useState("");

	/**
	 * Only the newest request may write results. Without this, a slow first
	 * page can land after a filter change and repopulate the list with rows
	 * that no longer match.
	 */
	const activeRequestRef = useRef<string | null>(null);

	const request = useCallback(
		(cursor: number | null, replace: boolean) => {
			const requestId = `status-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			activeRequestRef.current = requestId;
			setLoading(true);
			setError(null);
			if (replace) {
				setUpdates([]);
			}
			postToHost({
				type: mode === "board" ? "status_board" : "status_query",
				requestId,
				limit: PAGE_LIMIT,
				...(cursor != null ? { cursor } : {}),
				...(stateFilter.length ? { state: stateFilter } : {}),
				...(agentFilter ? { agentId: agentFilter } : {}),
				...(search ? { text: search } : {}),
			});
		},
		[mode, stateFilter, agentFilter, search],
	);

	const requestSummary = useCallback(() => {
		postToHost({ type: "status_summary", requestId: "status-summary" });
	}, []);

	useEffect(() => {
		request(null, true);
	}, [request]);

	useEffect(() => {
		requestSummary();
	}, [requestSummary]);

	useEffect(() => {
		function onMessage(event: MessageEvent) {
			const message = event.data as { type: string } & Record<string, unknown>;

			if (message.type === "status_page") {
				if (message.requestId !== activeRequestRef.current) return;
				const page = message.updates as StatusUpdate[];
				setUpdates((current) =>
					current.length === 0 ? page : [...current, ...page],
				);
				setNextCursor((message.nextCursor as number | null) ?? null);
				setHasMore(message.hasMore === true);
				setLoading(false);
				return;
			}

			if (message.type === "status_summary_result") {
				setSummary(message.summary as StatusSummary);
				return;
			}

			if (message.type === "status_error") {
				if (message.requestId !== activeRequestRef.current) return;
				setError(String(message.text));
				setLoading(false);
				return;
			}

			if (message.type === "status_updated") {
				const live = message.update as StatusUpdate;
				setUpdates((current) => {
					if (current.some((u) => u.updateId === live.updateId)) return current;
					// The board shows one row per subject, so a live update for a
					// subject already on screen replaces it rather than stacking.
					const withoutSubject =
						mode === "board"
							? current.filter((u) => u.subject !== live.subject)
							: current;
					return [live, ...withoutSubject];
				});
				// Counts moved, so the tiles are now stale.
				requestSummary();
			}
		}

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [mode, requestSummary]);

	const toggleState = useCallback((value: StatusState) => {
		setStateFilter((current) =>
			current.includes(value)
				? current.filter((entry) => entry !== value)
				: [...current, value],
		);
	}, []);

	/** Board groups the page under state headings; changelog stays flat. */
	const sections = useMemo(() => {
		if (mode !== "board") return null;
		return BOARD_SECTIONS.map((section) => ({
			...section,
			rows: updates.filter((update) => update.state === section.state),
		})).filter((section) => section.rows.length > 0);
	}, [mode, updates]);

	const refreshAll = useCallback(() => {
		request(null, true);
		requestSummary();
	}, [request, requestSummary]);

	const activeAgent = summary?.byAgent.find((a) => a.agentId === agentFilter);

	return (
		<PageFrame>
			<PageHeader
				description={
					mode === "board"
						? "Where every agent is right now — one row per piece of work, most urgent first."
						: "Everything that has happened, newest first, including superseded updates."
				}
				icon={ActivityIcon}
				meta={
					summary?.lastUpdatedAt ? (
						<Badge className="text-[10px]" variant="outline">
							last update {relativeTime(summary.lastUpdatedAt)}
						</Badge>
					) : null
				}
				title="Status Hub"
				actions={
					<Button
						disabled={loading}
						onClick={refreshAll}
						size="sm"
						type="button"
						variant="outline"
					>
						<RefreshCwIcon
							className={cn("size-3.5", loading && "animate-spin")}
						/>
						Refresh
					</Button>
				}
			/>

			{/* Counts come from the server across every live row, not from this
			    page -- a board that says "3 blocked" when 40 are blocked is worse
			    than no board. */}
			{summary ? (
				<div className="mb-4 flex flex-wrap gap-2">
					{TILE_STATES.map((state) => (
						<StatTile
							active={stateFilter.includes(state)}
							count={summary.byState[state] ?? 0}
							key={state}
							label={state}
							onClick={() => toggleState(state)}
						/>
					))}
				</div>
			) : null}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				<div className="flex overflow-hidden rounded-md border">
					{(["board", "changelog"] as const).map((value) => (
						<button
							className={cn(
								"px-3 py-1.5 text-xs capitalize transition-colors",
								mode === value
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							key={value}
							onClick={() => setMode(value)}
							type="button"
						>
							{value}
						</button>
					))}
				</div>

				<form
					className="flex items-center gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setSearch(searchDraft.trim());
					}}
				>
					<div className="relative">
						<SearchIcon className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							className="h-8 w-56 pl-7 text-xs"
							onChange={(event) => setSearchDraft(event.target.value)}
							placeholder="Search status text"
							value={searchDraft}
						/>
					</div>
					{search ? (
						<Button
							onClick={() => {
								setSearchDraft("");
								setSearch("");
							}}
							size="sm"
							type="button"
							variant="ghost"
						>
							Clear
						</Button>
					) : null}
				</form>

				{/* Agent filter, ordered by who is most blocked. */}
				{summary && summary.byAgent.length > 0 ? (
					<div className="flex flex-wrap items-center gap-1">
						{summary.byAgent.slice(0, 6).map((agent) => (
							<Button
								className="h-7 px-2 text-xs"
								key={agent.agentId}
								onClick={() =>
									setAgentFilter((current) =>
										current === agent.agentId ? null : agent.agentId,
									)
								}
								size="sm"
								type="button"
								variant={agentFilter === agent.agentId ? "default" : "outline"}
							>
								{agent.agentName ?? agent.agentId}
								<span className="ml-1 opacity-60">{agent.total}</span>
								{agent.blocked > 0 ? (
									<span className="ml-1 text-amber-600 dark:text-amber-400">
										{agent.blocked} blocked
									</span>
								) : null}
							</Button>
						))}
					</div>
				) : null}

				{stateFilter.length > 0 || agentFilter || search ? (
					<Button
						className="h-7 px-2 text-xs"
						onClick={() => {
							setStateFilter([]);
							setAgentFilter(null);
							setSearch("");
							setSearchDraft("");
						}}
						size="sm"
						type="button"
						variant="ghost"
					>
						Reset filters
					</Button>
				) : null}
			</div>

			{activeAgent ? (
				<p className="mb-3 text-xs text-muted-foreground">
					Showing {activeAgent.agentName ?? activeAgent.agentId} —{" "}
					{activeAgent.total} active, {activeAgent.running} running,{" "}
					{activeAgent.blocked} blocked.
				</p>
			) : null}

			{error ? (
				<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
					{error}
				</div>
			) : null}

			{updates.length === 0 && !loading ? (
				<div className="rounded-lg border bg-card">
					<PageEmptyState>
						No status updates yet. Agents publish here with the{" "}
						<code className="font-mono text-xs">report_status</code> tool.
					</PageEmptyState>
				</div>
			) : sections ? (
				<div className="space-y-5">
					{sections.map((section) => (
						<section key={section.state}>
							<div className="mb-2 flex items-baseline gap-2">
								<Badge
									className={cn("text-[10px]", STATE_STYLES[section.state])}
									variant="outline"
								>
									{section.state}
								</Badge>
								<span className="text-sm font-medium text-foreground">
									{summary?.byState[section.state] ?? section.rows.length}
								</span>
								<span className="text-xs text-muted-foreground">
									{section.blurb}
								</span>
							</div>
							<div className="rounded-lg border bg-card">
								<ul>
									{section.rows.map((update) => (
										<StatusRow key={update.updateId} update={update} />
									))}
								</ul>
							</div>
						</section>
					))}
				</div>
			) : (
				<div className="rounded-lg border bg-card">
					<ul>
						{updates.map((update) => (
							<StatusRow key={update.updateId} showTransition update={update} />
						))}
					</ul>
				</div>
			)}

			<div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
				<span>
					{updates.length} shown
					{summary && mode === "board" ? ` of ${summary.total} active` : ""}
					{hasMore ? " · more available" : ""}
				</span>
				{hasMore ? (
					<Button
						disabled={loading || nextCursor == null}
						onClick={() => request(nextCursor, false)}
						size="sm"
						type="button"
						variant="outline"
					>
						{loading ? "Loading…" : "Load more"}
					</Button>
				) : null}
			</div>
		</PageFrame>
	);
}
