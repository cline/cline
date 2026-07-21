"use client";

import {
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	ExternalLink,
	Minus,
	Plus,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { resolveWorkspaceFilePath } from "@/lib/workspace-paths";

type DiffViewProps = {
	fileDiffs: SessionFileDiff[];
	cwd?: string;
	onClose: () => void;
};

type EditorOption = {
	id: string;
	label: string;
};

export function DiffView({ fileDiffs, cwd, onClose }: DiffViewProps) {
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
	const [editors, setEditors] = useState<EditorOption[]>([]);

	useEffect(() => {
		let cancelled = false;
		desktopClient
			.invoke<EditorOption[]>("list_available_editors")
			.then((list) => {
				if (!cancelled && Array.isArray(list)) setEditors(list);
			})
			.catch(() => {
				// Older sidecars don't support the command; the menu still
				// offers the system default opener.
			});
		return () => {
			cancelled = true;
		};
	}, []);

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
		<div className="flex h-full min-h-0 flex-col overflow-hidden">
			<div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
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

			<ScrollArea className="min-h-0 flex-1">
				{fileDiffs.length === 0 ? (
					<div className="flex h-full items-center justify-center px-4 py-16 text-sm text-muted-foreground">
						No file changes in this session yet.
					</div>
				) : (
					<div className="flex flex-col">
						{fileDiffs.map((file) => (
							<DiffFileSection
								collapsed={collapsedFiles.has(file.path)}
								cwd={cwd}
								editors={editors}
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
	cwd,
	editors,
	onToggle,
}: {
	file: SessionFileDiff;
	collapsed: boolean;
	cwd?: string;
	editors: EditorOption[];
	onToggle: () => void;
}) {
	const [copied, setCopied] = useState(false);
	const [opening, setOpening] = useState(false);
	const copyResetTimerRef = useRef<number | null>(null);
	const resolvedPath = resolveWorkspaceFilePath(file.path, cwd);

	const handleCopyPath = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(resolvedPath);
			setCopied(true);
			if (copyResetTimerRef.current !== null) {
				window.clearTimeout(copyResetTimerRef.current);
			}
			copyResetTimerRef.current = window.setTimeout(() => {
				setCopied(false);
				copyResetTimerRef.current = null;
			}, 1600);
		} catch {
			toast({
				variant: "destructive",
				title: "Copy failed",
				description: "The file path could not be copied to the clipboard.",
			});
		}
	}, [resolvedPath]);

	const handleOpenInEditor = useCallback(
		async (editor?: string) => {
			setOpening(true);
			try {
				await desktopClient.invoke("open_file_in_editor", {
					path: file.path,
					...(cwd?.trim() ? { cwd } : {}),
					...(editor ? { editor } : {}),
				});
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Could not open file",
					description:
						error instanceof Error
							? error.message
							: "The file could not be opened in an editor.",
				});
			} finally {
				setOpening(false);
			}
		},
		[file.path, cwd],
	);

	return (
		<div className="border-b border-border">
			<div className="group flex w-full items-center gap-2 bg-card/80 px-4 py-2 hover:bg-accent/50 transition-colors">
				<button
					className="flex min-w-0 shrink items-center gap-2 text-left"
					onClick={onToggle}
					type="button"
				>
					{collapsed ? (
						<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					) : (
						<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="min-w-0 truncate font-mono text-xs text-foreground">
						{file.path}
					</span>
				</button>
				<button
					aria-label={`Copy file path for ${file.path}`}
					className={cn(
						"shrink-0 rounded-md p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
						copied ? "opacity-100 text-primary" : "opacity-0",
					)}
					onClick={() => void handleCopyPath()}
					title="Copy file path"
					type="button"
				>
					{copied ? (
						<Check className="h-3.5 w-3.5" />
					) : (
						<Copy className="h-3.5 w-3.5" />
					)}
				</button>
				{/* Invisible flex spacer that keeps the dead space between the
				    path and the right-aligned actions clickable as a toggle. */}
				<button
					aria-hidden
					className="h-6 min-w-0 flex-1 cursor-pointer"
					onClick={onToggle}
					tabIndex={-1}
					type="button"
				/>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							aria-label={`Open ${file.path} in editor`}
							className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 data-[state=open]:opacity-100 data-[state=open]:bg-accent data-[state=open]:text-foreground"
							disabled={opening}
							title="Open in editor"
							type="button"
						>
							<ExternalLink className="h-3.5 w-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-52">
						{editors.map((editor) => (
							<DropdownMenuItem
								key={editor.id}
								onSelect={() => void handleOpenInEditor(editor.id)}
							>
								Open in {editor.label}
							</DropdownMenuItem>
						))}
						{editors.length > 0 && <DropdownMenuSeparator />}
						<DropdownMenuItem
							onSelect={() => void handleOpenInEditor("default")}
						>
							Open with system default
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<span className="shrink-0 font-mono text-[11px] text-primary">
					+{file.additions}
				</span>
				<span className="shrink-0 font-mono text-[11px] text-destructive">
					-{file.deletions}
				</span>
			</div>

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
