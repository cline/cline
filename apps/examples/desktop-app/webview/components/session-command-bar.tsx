"use client";

import {
	formatSessionSearchPreview,
	formatSessionSearchTitle,
} from "@cline/shared/browser";
import { Loader2 } from "lucide-react";
import { type UIEvent, useEffect, useState } from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { desktopClient } from "@/lib/desktop-client";

type SessionSearchHit = {
	sessionId: string;
	documentId: string;
	ordinal: number;
	role: string;
	startedAt: string;
	workspaceRoot: string;
	title: string;
	snippet: string;
};

const SESSION_SEARCH_RESULT_BATCH_SIZE = 15;

export function SessionCommandBar({
	open,
	onOpenChange,
	onOpenSession,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onOpenSession: (sessionId: string) => void | Promise<void>;
}) {
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SessionSearchHit[]>([]);
	const [searching, setSearching] = useState(false);
	const [visibleHitCount, setVisibleHitCount] = useState(
		SESSION_SEARCH_RESULT_BATCH_SIZE,
	);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setHits([]);
			setSearching(false);
			setVisibleHitCount(SESSION_SEARCH_RESULT_BATCH_SIZE);
		}
	}, [open]);

	useEffect(() => {
		const normalized = query.trim();
		if (!open || !normalized) {
			setHits([]);
			setSearching(false);
			setVisibleHitCount(SESSION_SEARCH_RESULT_BATCH_SIZE);
			return;
		}

		let cancelled = false;
		setSearching(true);
		const timer = setTimeout(() => {
			void desktopClient
				.invoke<SessionSearchHit[]>(
					"search_sessions",
					{
						query: normalized,
						limit: 50,
					},
					{ timeoutMs: 3_000 },
				)
				.then((results) => {
					if (!cancelled) {
						setHits(
							results.map((hit) => ({
								...hit,
								title: formatSessionSearchTitle(hit.title),
								snippet: formatSessionSearchPreview(hit.role, hit.snippet),
							})),
						);
						setVisibleHitCount(SESSION_SEARCH_RESULT_BATCH_SIZE);
					}
				})
				.catch(() => {
					if (!cancelled) setHits([]);
				})
				.finally(() => {
					if (!cancelled) setSearching(false);
				});
		}, 180);

		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [open, query]);

	const handleQueryChange = (value: string) => {
		setQuery(value);
		setHits([]);
		setVisibleHitCount(SESSION_SEARCH_RESULT_BATCH_SIZE);
		setSearching(Boolean(value.trim()));
	};

	const handleResultListScroll = (event: UIEvent<HTMLDivElement>) => {
		const list = event.currentTarget;
		if (list.scrollHeight - list.scrollTop - list.clientHeight > 120) return;
		setVisibleHitCount((current) =>
			Math.min(current + SESSION_SEARCH_RESULT_BATCH_SIZE, hits.length),
		);
	};

	const visibleHits = hits.slice(0, visibleHitCount);

	return (
		<CommandDialog
			className="h-[min(38rem,calc(100vh-2rem))] w-[min(56rem,calc(100vw-2rem))] max-w-none sm:max-w-none"
			description="Search messages across all Cline sessions"
			onOpenChange={onOpenChange}
			open={open}
			// Hits arrive filtered and ranked by the FTS index; letting cmdk
			// re-score them would reorder results and drop hits whose matched
			// text lives outside the truncated snippet.
			shouldFilter={false}
			showCloseButton={false}
			title="Search session history"
		>
			<CommandInput
				onValueChange={handleQueryChange}
				placeholder="Search all session history…"
				value={query}
			/>
			<CommandList
				className="min-h-0 max-h-none flex-1"
				onScroll={handleResultListScroll}
			>
				{searching ? (
					<div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Searching sessions…
					</div>
				) : null}
				{!searching && query.trim() ? (
					<CommandEmpty>No matching session history.</CommandEmpty>
				) : null}
				{!searching && hits.length > 0 ? (
					<CommandGroup heading="Session history">
						{visibleHits.map((hit) => (
							<CommandItem
								className="items-start py-3"
								key={hit.documentId}
								onSelect={() => {
									onOpenChange(false);
									void onOpenSession(hit.sessionId);
								}}
								value={`${hit.documentId} ${hit.title} ${hit.snippet} ${hit.workspaceRoot}`}
							>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-2">
										<span className="shrink-0 text-xs capitalize text-muted-foreground">
											{hit.role}
										</span>
										<span className="truncate font-medium">{hit.title}</span>
									</div>
									<p className="mt-1 line-clamp-2 whitespace-normal text-xs text-muted-foreground">
										{hit.snippet}
									</p>
									<p className="mt-1 truncate text-[11px] text-muted-foreground/70">
										{hit.workspaceRoot}
									</p>
								</div>
							</CommandItem>
						))}
						{visibleHitCount < hits.length ? (
							<div className="py-2 text-center text-[11px] text-muted-foreground">
								Showing {visibleHitCount} of {hits.length} results
							</div>
						) : null}
					</CommandGroup>
				) : null}
				{!query.trim() ? (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						Search messages, commands, errors, and file paths.
					</div>
				) : null}
			</CommandList>
			<div className="flex items-center justify-between border-t px-3 py-2 text-[11px] text-muted-foreground">
				<span>Navigate with ↑↓ and open with ↵</span>
				<kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans">
					Cmd/Ctrl+P
				</kbd>
			</div>
		</CommandDialog>
	);
}
