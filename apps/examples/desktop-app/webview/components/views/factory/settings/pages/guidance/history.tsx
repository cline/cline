"use client";

import { type ReactNode, useState } from "react";
import { basenamePath } from "@/hooks/use-session-history";
import {
	type FactoryGuidanceHistoryEntry,
	type FactoryGuidanceRole,
	type FactorySettingsClient,
	factorySettingsErrorMessage,
} from "@/lib/factory-settings-client";
import { FS_GUIDANCE } from "@/lib/factory-settings-copy/guidance";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { FactoryGuidanceDiffView } from "../../../../chat/messages/factory-guidance-approval";
import {
	ActionButton,
	CardLink,
	SettingSkeleton,
	UnavailableNote,
} from "../../../factory-settings-rows";
import { useSettingsResource } from "../../use-settings-resource";
import { guidanceDiff } from "./line-diff";

const G = FS_GUIDANCE;
const PAGE = 20;

/** "Today 10:42", "Yesterday 09:10", "Nov 10", "Nov 10, 2025". */
export function historyTime(iso: string, now = new Date()): string {
	const time = new Date(iso);
	if (Number.isNaN(time.getTime())) return iso;
	const day = (date: Date) =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const days = Math.round((day(now) - day(time)) / 86_400_000);
	const clock = time.toLocaleTimeString("en-US", {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	if (days === 0) return `${G.today} ${clock}`;
	if (days === 1) return `${G.yesterday} ${clock}`;
	return time.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(time.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
	});
}

export function historySource(
	entry: FactoryGuidanceHistoryEntry,
	onOpenCard: (taskId: string) => void,
): ReactNode {
	if (!entry.source) return G.sourceAskFactory;
	if (entry.source.kind === "settings") return G.sourceSettings;
	return (
		<>
			{G.sourceFeedback} <CardLink card={entry.source} onOpen={onOpenCard} />
		</>
	);
}

/**
 * The target's history, both scopes, newest first, 20 at a time: View opens
 * the before/after diff in place; Restore reviews the version before that
 * change in its scope's editor (the same confirmation as an edit).
 */
export function GuidanceHistory({
	role,
	title,
	workspaceRoot,
	client,
	version,
	disabled,
	onRestore,
	onOpenCard,
}: {
	role: FactoryGuidanceRole;
	title: string;
	workspaceRoot?: string;
	client: FactorySettingsClient;
	/** Changes after a save, so the list reads again. */
	version: number;
	disabled: boolean;
	onRestore: (entry: FactoryGuidanceHistoryEntry) => void;
	/** "From feedback on F12": leaves settings for the card. */
	onOpenCard: (taskId: string) => void;
}) {
	const first = useSettingsResource(
		() => client.getGuidanceHistory({ role, workspaceRoot, limit: PAGE }),
		[role, workspaceRoot, version],
	);
	const [more, setMore] = useState<{
		key: string;
		entries: FactoryGuidanceHistoryEntry[];
		more: boolean;
	}>();
	const [loadingMore, setLoadingMore] = useState(false);
	const [moreError, setMoreError] = useState<string>();
	const [viewing, setViewing] = useState<string>();
	const key = `${role}|${workspaceRoot ?? ""}|${version}`;
	const extra = more?.key === key ? more : undefined;
	const entries = [...(first.data?.entries ?? []), ...(extra?.entries ?? [])];
	const hasMore = extra ? extra.more : Boolean(first.data?.more);
	const both = role !== "manager" && Boolean(workspaceRoot);

	const showMore = async () => {
		setLoadingMore(true);
		setMoreError(undefined);
		try {
			const reply = await client.getGuidanceHistory({
				role,
				workspaceRoot,
				limit: PAGE,
				before: entries.at(-1)?.id,
			});
			setMore({
				key,
				entries: [...(extra?.entries ?? []), ...reply.entries],
				more: reply.more,
			});
		} catch (cause) {
			setMoreError(factorySettingsErrorMessage(cause, FS_SHELL.loadFailed));
		} finally {
			setLoadingMore(false);
		}
	};

	let content: ReactNode;
	if (first.status === "unavailable") {
		content = (
			<UnavailableNote reason={first.unavailable}>
				{first.unavailable === "hub"
					? FS_SHELL.hubTooOld
					: G.historyUnavailable}
			</UnavailableNote>
		);
	} else if (first.status === "error") {
		content = (
			<p
				role="alert"
				className="flex items-center gap-2 py-3 text-xs text-destructive"
			>
				{first.error}
				<ActionButton onClick={first.reload}>{FS_SHELL.retry}</ActionButton>
			</p>
		);
	} else if (!first.data) {
		content = (
			<div className="py-3">
				<SettingSkeleton />
			</div>
		);
	} else if (entries.length === 0) {
		content = (
			<p className="py-3 text-xs text-muted-foreground">{G.historyEmpty}</p>
		);
	} else {
		content = (
			<ul aria-label={G.history}>
				{entries.map((entry) => {
					const open = viewing === entry.id;
					return (
						<li
							key={entry.id}
							data-history-entry={entry.id}
							className="border-b"
						>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-[13px]">
								<time
									dateTime={entry.time}
									className="w-[92px] shrink-0 text-xs text-muted-foreground tabular-nums"
								>
									{historyTime(entry.time)}
								</time>
								<span className="min-w-0 flex-1">
									{entry.note}
									{both ? (
										<span className="ml-2 text-xs text-muted-foreground">
											{entry.scope === "user"
												? G.historyScopeYours
												: basenamePath(
														entry.workspaceRoot ?? workspaceRoot ?? "",
													)}
										</span>
									) : null}
								</span>
								<span className="text-xs text-muted-foreground">
									{historySource(entry, onOpenCard)}
								</span>
								<span className="flex gap-0.5">
									<ActionButton
										aria-label={`${open ? G.hide : G.view}: ${entry.note}`}
										onClick={() => setViewing(open ? undefined : entry.id)}
									>
										{open ? G.hide : G.view}
									</ActionButton>
									<ActionButton
										disabled={disabled}
										aria-label={G.restoreLabel(entry.note)}
										onClick={() => onRestore(entry)}
									>
										{G.restore}
									</ActionButton>
								</span>
							</div>
							{open ? (
								<FactoryGuidanceDiffView
									className="mb-3"
									diff={guidanceDiff(entry.before, entry.after)}
								/>
							) : null}
						</li>
					);
				})}
			</ul>
		);
	}

	return (
		<div data-guidance-history="" className="mb-2">
			<div className="mb-1 flex items-baseline gap-2.5 border-b pb-2">
				<h4 id="guidance-history-title" className="text-[13px] font-semibold">
					{G.history}
				</h4>
				<span className="text-xs text-muted-foreground">
					{G.historyMeta(title, both)}
				</span>
			</div>
			{content}
			{hasMore && first.status === "ready" ? (
				<div className="flex items-center gap-2 pt-2">
					<ActionButton disabled={loadingMore} onClick={() => void showMore()}>
						{G.showMore}
					</ActionButton>
					{moreError ? (
						<span role="alert" className="text-xs text-destructive">
							{moreError}
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}
