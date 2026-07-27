/**
 * One Status Hub entry.
 *
 * A row has to answer four questions without being opened: what happened, what
 * work it belongs to, who did it, and when. A headline alone does not -- "
 * Processed batch 66 of 70" is meaningless without its subject, agent, and
 * provenance -- so every row carries a provenance line under the headline.
 */

import type { StatusState, StatusUpdate } from "@cline/shared";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const STATE_STYLES: Record<StatusState, string> = {
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

/** How a publisher is described in the provenance line. */
const SOURCE_LABELS: Record<string, string> = {
	agent: "report_status",
	hub: "hub",
	sdk: "SDK",
	cli: "CLI",
};

export function relativeTime(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return "";
	const deltaSec = Math.round((Date.now() - then) / 1000);
	if (deltaSec < 60) return "just now";
	if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
	if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h ago`;
	return `${Math.floor(deltaSec / 86400)}d ago`;
}

function absoluteTime(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** A running item that has not moved in a while is the interesting case. */
function isStale(update: StatusUpdate): boolean {
	if (update.state !== "running") return false;
	const age = Date.now() - new Date(update.createdAt).getTime();
	return Number.isFinite(age) && age > 30 * 60 * 1000;
}

function workspaceLabel(root?: string): string | undefined {
	const parts = root?.split(/[\\/]+/).filter(Boolean);
	return parts?.length ? parts[parts.length - 1] : undefined;
}

export function StatusRow({
	update,
	showTransition,
}: {
	update: StatusUpdate;
	/** Changelog mode reads better as `queued -> running` than a bare state. */
	showTransition?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const who = update.agentName ?? update.agentId;
	const stale = isStale(update);
	const source = SOURCE_LABELS[update.source] ?? update.source;
	const workspace = workspaceLabel(update.workspaceRoot);

	return (
		<li className="border-b border-border last:border-b-0">
			<div className="flex items-start gap-3 px-4 py-3">
				<div className="mt-0.5 flex shrink-0 items-center gap-1">
					{showTransition && update.previousState ? (
						<>
							<Badge
								className={cn(
									"text-[10px] opacity-60",
									STATE_STYLES[update.previousState],
								)}
								variant="outline"
							>
								{update.previousState}
							</Badge>
							<span className="text-muted-foreground text-xs">→</span>
						</>
					) : null}
					<Badge
						className={cn("text-[10px]", STATE_STYLES[update.state])}
						variant="outline"
					>
						{update.state}
					</Badge>
				</div>

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
						{stale ? (
							<Badge
								className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
								variant="outline"
								title="Still running, but no update in over 30 minutes"
							>
								stale
							</Badge>
						) : null}
					</div>

					{/* Provenance: what work, who, how it got here, when. */}
					<div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						<span className="font-mono text-foreground/70">
							{update.subject}
						</span>
						{update.historyCount != null && update.historyCount > 1 ? (
							<span title="Total updates recorded for this subject">
								· {update.historyCount} updates
							</span>
						) : null}
						<span>·</span>
						<span className="text-foreground/70">{who ?? "unattributed"}</span>
						<span>· via {source}</span>
						{workspace ? <span>· {workspace}</span> : null}
						{update.sessionId ? (
							<a
								className="text-primary hover:underline"
								href={`/chat?id=${encodeURIComponent(update.sessionId)}`}
								title={`Open session ${update.sessionId}`}
							>
								· session
							</a>
						) : null}
						<span title={absoluteTime(update.createdAt)}>
							· {relativeTime(update.createdAt)}
						</span>
						{typeof update.progress === "number" ? (
							<span>· {Math.round(update.progress * 100)}%</span>
						) : null}
						{update.tags.map((tag) => (
							<Badge className="text-[10px]" key={tag} variant="outline">
								{tag}
							</Badge>
						))}
					</div>

					{typeof update.progress === "number" ? (
						<div className="mt-2 h-1 w-full max-w-xs overflow-hidden rounded-full bg-muted">
							<div
								className="h-full rounded-full bg-primary"
								style={{ width: `${Math.round(update.progress * 100)}%` }}
							/>
						</div>
					) : null}

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
