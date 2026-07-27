/**
 * Status Hub — the changelog for every agent.
 *
 * Two lenses over the same log: **Board** shows the current status of each
 * subject ("where is everything right now"), **Changelog** shows every update
 * in order ("what has happened"). Both page server-side with a keyset cursor,
 * so opening this view never pulls the whole log.
 */

import type { StatusState, StatusUpdate } from "@cline/shared";
import { ActivityIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { postToHost } from "../../vscode";
import { PageEmptyState, PageFrame, PageHeader } from "./page-layout";

const PAGE_LIMIT = 50;

const STATE_FILTERS: readonly StatusState[] = [
	"running",
	"blocked",
	"queued",
	"done",
	"failed",
	"cancelled",
];

const STATE_STYLES: Record<StatusState, string> = {
	running: "border-primary/40 text-primary",
	blocked: "border-amber-500/50 text-amber-600 dark:text-amber-400",
	queued: "border-border text-muted-foreground",
	done: "border-emerald-500/50 text-emerald-600 dark:text-emerald-400",
	failed: "border-destructive/50 text-destructive",
	cancelled: "border-border text-muted-foreground line-through",
};

const PRIORITY_STYLES: Record<string, string> = {
	critical: "border-destructive/60 text-destructive",
	high: "border-amber-500/50 text-amber-600 dark:text-amber-400",
};

export type StatusViewMode = "board" | "changelog";

function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const deltaSec = Math.round((Date.now() - then) / 1000);
	if (deltaSec < 60) return "just now";
	if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
	if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
	return `${Math.floor(deltaSec / 86400)}d ago`;
}

function StatusRow({ update }: { update: StatusUpdate }) {
	const [expanded, setExpanded] = useState(false);
	const who = update.agentName ?? update.agentId;

	return (
		<li className="border-b border-border last:border-b-0">
			<div className="flex items-start gap-3 px-4 py-3">
				<Badge
					className={cn(
						"mt-0.5 shrink-0 text-[10px]",
						STATE_STYLES[update.state],
					)}
					variant="outline"
				>
					{update.state}
				</Badge>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
						<span className="font-medium text-foreground">
							{update.headline}
						</span>
						{PRIORITY_STYLES[update.priority] ? (
							<Badge
								className={cn("text-[10px]", PRIORITY_STYLES[update.priority])}
								variant="outline"
							>
								{update.priority}
							</Badge>
						) : null}
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
						<span className="font-mono">{update.subject}</span>
						{who ? <span>· {who}</span> : null}
						<span>· {relativeTime(update.createdAt)}</span>
						{typeof update.progress === "number" ? (
							<span>· {Math.round(update.progress * 100)}%</span>
						) : null}
						{update.tags.map((tag) => (
							<Badge className="text-[10px]" key={tag} variant="outline">
								{tag}
							</Badge>
						))}
					</div>
					{update.detail ? (
						<>
							<button
								className="mt-1 text-xs text-primary hover:underline"
								onClick={() => setExpanded((open) => !open)}
								type="button"
							>
								{expanded ? "Hide detail" : "Show detail"}
							</button>
							{expanded ? (
								<pre className="mt-2 whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono text-[11px] text-muted-foreground">
									{update.detail}
								</pre>
							) : null}
						</>
					) : null}
				</div>
			</div>
		</li>
	);
}

export function StatusView() {
	const [mode, setMode] = useState<StatusViewMode>("board");
	const [updates, setUpdates] = useState<StatusUpdate[]>([]);
	const [nextCursor, setNextCursor] = useState<number | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [stateFilter, setStateFilter] = useState<StatusState[]>([]);
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
				...(search ? { text: search } : {}),
			});
		},
		[mode, stateFilter, search],
	);

	useEffect(() => {
		request(null, true);
	}, [request]);

	useEffect(() => {
		function onMessage(event: MessageEvent) {
			const message = event.data as
				| {
						type: "status_page";
						requestId: string;
						updates: StatusUpdate[];
						nextCursor: number | null;
						hasMore: boolean;
				  }
				| { type: "status_error"; requestId: string; text: string }
				| { type: "status_updated"; update: StatusUpdate }
				| { type: string };

			if (message.type === "status_page") {
				const page = message as Extract<
					typeof message,
					{ type: "status_page" }
				>;
				if (page.requestId !== activeRequestRef.current) return;
				setUpdates((current) =>
					// Cursor pages append; a fresh query replaces.
					current.length === 0 ? page.updates : [...current, ...page.updates],
				);
				setNextCursor(page.nextCursor);
				setHasMore(page.hasMore);
				setLoading(false);
				return;
			}

			if (message.type === "status_error") {
				const failure = message as Extract<
					typeof message,
					{ type: "status_error" }
				>;
				if (failure.requestId !== activeRequestRef.current) return;
				setError(failure.text);
				setLoading(false);
				return;
			}

			if (message.type === "status_updated") {
				const live = (
					message as Extract<typeof message, { type: "status_updated" }>
				).update;
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
			}
		}

		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [mode]);

	const toggleState = useCallback((value: StatusState) => {
		setStateFilter((current) =>
			current.includes(value)
				? current.filter((entry) => entry !== value)
				: [...current, value],
		);
	}, []);

	const blockedCount = useMemo(
		() => updates.filter((u) => u.state === "blocked").length,
		[updates],
	);

	return (
		<PageFrame>
			<PageHeader
				description="Every agent's status in one place. Agents publish as they work; the newest update per subject is the current one."
				icon={ActivityIcon}
				meta={
					blockedCount > 0 ? (
						<Badge
							className="border-amber-500/50 text-amber-600 dark:text-amber-400"
							variant="outline"
						>
							{blockedCount} blocked
						</Badge>
					) : null
				}
				title="Status Hub"
				actions={
					<Button
						disabled={loading}
						onClick={() => request(null, true)}
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

				<div className="flex flex-wrap items-center gap-1">
					{STATE_FILTERS.map((value) => (
						<Button
							className="h-7 px-2 text-xs capitalize"
							key={value}
							onClick={() => toggleState(value)}
							size="sm"
							type="button"
							variant={stateFilter.includes(value) ? "default" : "outline"}
						>
							{value}
						</Button>
					))}
				</div>
			</div>

			{error ? (
				<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
					{error}
				</div>
			) : null}

			<div className="rounded-lg border bg-card">
				{updates.length === 0 && !loading ? (
					<PageEmptyState>
						No status updates yet. Agents publish here with the{" "}
						<code className="font-mono text-xs">report_status</code> tool.
					</PageEmptyState>
				) : (
					<ul>
						{updates.map((update) => (
							<StatusRow key={update.updateId} update={update} />
						))}
					</ul>
				)}
			</div>

			<div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
				<span>
					{updates.length} update{updates.length === 1 ? "" : "s"} shown
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
