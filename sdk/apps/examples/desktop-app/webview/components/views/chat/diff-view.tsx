"use client";

import { ChevronDown, ChevronRight, Minus, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";

type DiffViewProps = {
	fileDiffs: SessionFileDiff[];
	onClose: () => void;
};

export function DiffView({ fileDiffs, onClose }: DiffViewProps) {
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

	const _totals = useMemo(
		() =>
			fileDiffs.reduce(
				(acc, file) => {
					acc.additions += file.additions;
					acc.deletions += file.deletions;
					return acc;
				},
				{ additions: 0, deletions: 0 },
			),
		[fileDiffs],
	);

	const toggleFileCollapse = (filename: string) => {
		setCollapsedFiles((prev) => {
			const next = new Set(prev);
			if (next.has(filename)) {
				next.delete(filename);
			} else {
				next.add(filename);
			}
			return next;
		});
	};

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			<div className="flex h-10 items-center justify-between border-b border-border bg-card px-4">
				<div className="flex items-center gap-3">
					<span className="text-xs font-medium text-foreground">
						Uncommitted changes
					</span>
					<span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
						Files: {fileDiffs.length}
					</span>
				</div>

				<div className="flex items-center gap-2 text-xs font-mono">
					{" "}
					<button
						aria-label="Close diff view"
						className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onClick={onClose}
						type="button"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
			</div>

			<ScrollArea className="flex-1">
				{fileDiffs.length === 0 ? (
					<div className="flex h-full items-center justify-center px-4 py-16 text-sm text-muted-foreground">
						No file changes in this session yet.
					</div>
				) : (
					<div className="flex flex-col">
						{fileDiffs.map((file) => (
							<DiffFileSection
								collapsed={collapsedFiles.has(file.path)}
								file={file}
								key={file.path}
								onToggle={() => toggleFileCollapse(file.path)}
							/>
						))}
					</div>
				)}
			</ScrollArea>
		</div>
	);
}

function DiffFileSection({
	file,
	collapsed,
	onToggle,
}: {
	file: SessionFileDiff;
	collapsed: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="border-b border-border">
			<button
				className="flex w-full items-center gap-2 bg-card/80 px-4 py-2 text-left hover:bg-accent/50 transition-colors"
				onClick={onToggle}
				type="button"
			>
				{collapsed ? (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				) : (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				)}
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
					{file.path}
				</span>
				<span className="shrink-0 font-mono text-[11px] text-primary">
					+{file.additions}
				</span>
				<span className="shrink-0 font-mono text-[11px] text-destructive">
					-{file.deletions}
				</span>
			</button>

			{!collapsed && (
				<div className="space-y-2 border-t border-border bg-card/40 px-4 py-3">
					{file.hunks.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							No hunk details available.
						</p>
					) : (
						file.hunks.map((hunk) => (
							<DiffHunk
								hunk={hunk}
								key={`${file.path}-${hunk.oldStart}-${hunk.newStart}-${hunk.old.length}-${hunk.new.length}`}
							/>
						))
					)}
				</div>
			)}
		</div>
	);
}

function DiffHunk({ hunk }: { hunk: SessionFileDiff["hunks"][number] }) {
	const oldLines = hunk.old.length > 0 ? hunk.old.split("\n") : [];
	const newLines = hunk.new.length > 0 ? hunk.new.split("\n") : [];
	const oldOccurrences = new Map<string, number>();
	const oldLineEntries = oldLines.map((line, offset) => {
		const occurrence = (oldOccurrences.get(line) ?? 0) + 1;
		oldOccurrences.set(line, occurrence);
		return {
			key: `old-${hunk.oldStart + offset}-${occurrence}-${line}`,
			line,
			lineNumber: hunk.oldStart + offset,
		};
	});
	const newOccurrences = new Map<string, number>();
	const newLineEntries = newLines.map((line, offset) => {
		const occurrence = (newOccurrences.get(line) ?? 0) + 1;
		newOccurrences.set(line, occurrence);
		return {
			key: `new-${hunk.newStart + offset}-${occurrence}-${line}`,
			line,
			lineNumber: hunk.newStart + offset,
		};
	});

	return (
		<div className="overflow-x-auto rounded-md border border-border bg-background font-mono text-[11px] leading-5">
			{oldLineEntries.map((entry) => (
				<div className="flex bg-destructive/10" key={entry.key}>
					<span className="hidden w-12 shrink-0 select-none items-center justify-end border-r border-border px-2 text-muted-foreground/40 sm:flex">
						{entry.lineNumber}
					</span>
					<span className="flex w-6 shrink-0 items-center justify-center text-destructive">
						<Minus className="h-2.5 w-2.5" />
					</span>
					<span className="min-w-0 flex-1 whitespace-pre px-2 text-destructive/90">
						{entry.line || " "}
					</span>
				</div>
			))}
			{newLineEntries.map((entry) => (
				<div className="flex bg-primary/10" key={entry.key}>
					<span className="hidden w-12 shrink-0 select-none items-center justify-end border-r border-border px-2 text-muted-foreground/40 sm:flex">
						{entry.lineNumber}
					</span>
					<span className="flex w-6 shrink-0 items-center justify-center text-primary">
						<Plus className="h-2.5 w-2.5" />
					</span>
					<span className="min-w-0 flex-1 whitespace-pre px-2 text-primary">
						{entry.line || " "}
					</span>
				</div>
			))}
			{oldLines.length === 0 && newLines.length === 0 && (
				<div className={cn("px-3 py-2 text-xs text-muted-foreground")}>
					No line diff content.
				</div>
			)}
		</div>
	);
}
