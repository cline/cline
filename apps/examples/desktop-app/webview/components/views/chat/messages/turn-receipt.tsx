"use client";

import { ChevronDown, FileDiff } from "lucide-react";
import { useState } from "react";
import { type SessionChangeSet, sumChanges } from "@/lib/session-changes";
import { FileIcon } from "../file-icons";

const LISTED_FILES = 3;

/**
 * What the last turn changed, shown at the end of the transcript once the
 * turn finishes. Selecting it (or a file) opens the changes pane on it.
 *
 * `expandable` is for hosts without an in-app changes pane (VS Code): each
 * row is the only way to reach that file's diff, so "N more files" grows
 * the list in place instead of opening a pane. Desktop leaves it off.
 */
export function TurnReceipt({
	changes,
	onReview,
	expandable = false,
}: {
	changes: SessionChangeSet;
	onReview: (path?: string) => void;
	expandable?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const showAll = expandable && expanded;
	const { additions, deletions } = sumChanges(changes.files);
	const count = changes.files.length + changes.omitted;
	const listed = showAll ? changes.files : changes.files.slice(0, LISTED_FILES);
	const hidden = count - listed.length;
	return (
		<div
			className="overflow-hidden rounded-lg border border-border/80 text-xs"
			data-testid="turn-receipt"
		>
			<button
				aria-label={`Review last turn changes: ${count} files, ${additions} additions, ${deletions} deletions`}
				className="flex w-full items-center gap-2 bg-muted/40 px-3 py-1.5 text-left hover:bg-surface-hover"
				onClick={() => onReview()}
				type="button"
			>
				<FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="font-medium text-foreground">
					Changed {count} file{count === 1 ? "" : "s"}
				</span>
				<span className="font-mono text-[11px]">
					<span className="text-chart-2">+{additions}</span>{" "}
					<span className="text-destructive">-{deletions}</span>
				</span>
				<span className="ml-auto text-[11px] text-muted-foreground">
					Review
				</span>
			</button>
			{showAll ? (
				// Long lists scroll inside the receipt rather than pushing the
				// composer off-screen.
				<div className="max-h-80 overflow-y-auto">
					{listed.map((file) => (
						<ReceiptFileRow file={file} key={file.path} onReview={onReview} />
					))}
				</div>
			) : (
				listed.map((file) => (
					<ReceiptFileRow file={file} key={file.path} onReview={onReview} />
				))
			)}
			{hidden > 0 && expandable && !showAll ? (
				<button
					aria-expanded={false}
					className="flex h-7 w-full items-center gap-1 border-t border-border/50 px-3 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
					onClick={() => setExpanded(true)}
					type="button"
				>
					<ChevronDown className="size-3" />
					{hidden} more file{hidden === 1 ? "" : "s"}
				</button>
			) : hidden > 0 && showAll ? (
				// Only `changes.omitted` remains: the sidecar capped the list.
				<div className="flex h-7 items-center border-t border-border/50 px-3 text-[11px] text-muted-foreground">
					{hidden} more file{hidden === 1 ? "" : "s"} not listed
				</div>
			) : hidden > 0 ? (
				<button
					className="flex h-7 w-full items-center border-t border-border/50 px-3 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
					onClick={() => onReview()}
					type="button"
				>
					{hidden} more file{hidden === 1 ? "" : "s"}
				</button>
			) : null}
			{showAll ? (
				<button
					aria-expanded
					className="flex h-7 w-full items-center gap-1 border-t border-border/50 px-3 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
					onClick={() => setExpanded(false)}
					type="button"
				>
					<ChevronDown className="size-3 rotate-180" />
					Show fewer
				</button>
			) : null}
		</div>
	);
}

function ReceiptFileRow({
	file,
	onReview,
}: {
	file: SessionChangeSet["files"][number];
	onReview: (path?: string) => void;
}) {
	return (
		<button
			className="flex h-7 w-full items-center gap-1.5 border-t border-border/50 px-3 text-left hover:bg-surface-hover"
			onClick={() => onReview(file.path)}
			title={file.path}
			type="button"
		>
			<FileIcon path={file.path} />
			<span className="shrink-0 truncate">{file.path.split("/").pop()}</span>
			<span className="min-w-0 truncate text-[10.5px] text-muted-foreground/80">
				{file.path.split("/").slice(0, -1).join("/")}
			</span>
			<span className="ml-auto shrink-0 font-mono text-[10.5px]">
				<span className="text-chart-2">+{file.additions ?? 0}</span>{" "}
				<span className="text-destructive">-{file.deletions ?? 0}</span>
			</span>
		</button>
	);
}
