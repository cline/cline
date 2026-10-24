"use client";

import { Check, Copy, ExternalLink, GitBranch, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import {
	type ChangesScope,
	type SessionChangeContents,
	type SessionChangeFile,
	type SessionChanges,
	sumChanges,
} from "@/lib/session-changes";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { resolveWorkspaceFilePath } from "@/lib/workspace-paths";
import { FileIcon } from "./file-icons";
import { CodeDiff } from "./highlighted-code";
import { ChangeRow } from "./source-control-column";
import { WorkspacePanelFrame } from "./workspace-panel-frame";

type ChangesPanelProps = {
	environmentId: string;
	/** Base the session's tool-event paths resolve against. */
	cwd: string;
	changes: SessionChanges | null;
	/** Tool-event reconstruction, shown when git checkpoints are unavailable. */
	fallbackFileDiffs: SessionFileDiff[];
	scope: ChangesScope;
	onScopeChange: (scope: ChangesScope) => void;
	selectedPath: string | null;
	onSelectPath: (path: string) => void;
	/** Opens the Files + Git panel on its Git view. */
	onOpenGit: () => void;
	onClose: () => void;
};

type ListedFile = SessionChangeFile & { hunks?: SessionFileDiff["hunks"] };
type ContentsState = SessionChangeContents | { error: string } | "loading";

const COLUMN_WIDTH = 280;

function fallbackFiles(fileDiffs: readonly SessionFileDiff[]): ListedFile[] {
	return fileDiffs.map((diff) => ({
		path: diff.path,
		status:
			diff.deletions === 0 &&
			diff.hunks.length > 0 &&
			diff.hunks.every((hunk) => hunk.old.length === 0)
				? "A"
				: "M",
		additions: diff.additions,
		deletions: diff.deletions,
		hunks: diff.hunks,
	}));
}

export function ChangesPanel({
	environmentId,
	cwd,
	changes,
	fallbackFileDiffs,
	scope,
	onScopeChange,
	selectedPath,
	onSelectPath,
	onOpenGit,
	onClose,
}: ChangesPanelProps) {
	const [contents, setContents] = useState<Map<string, ContentsState>>(
		() => new Map(),
	);
	const [copied, setCopied] = useState(false);
	const copyTimerRef = useRef<number | null>(null);

	const usingFallback = changes !== null && !changes.session;
	// The tool-event fallback only knows the whole session.
	const activeScope: ChangesScope = usingFallback ? "session" : scope;
	const set = activeScope === "session" ? changes?.session : changes?.lastTurn;
	const files = useMemo<ListedFile[]>(
		() =>
			usingFallback ? fallbackFiles(fallbackFileDiffs) : (set?.files ?? []),
		[fallbackFileDiffs, set, usingFallback],
	);
	const totals = sumChanges(files);
	const selected =
		files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
	const absolutePath = (path: string) =>
		changes?.root && !usingFallback
			? resolveWorkspaceFilePath(path, changes.root)
			: resolveWorkspaceFilePath(path, cwd);

	const contentsKey = selected
		? `${selected.oldOid ?? ""}:${selected.newOid ?? ""}`
		: "";
	const selectedContents = contents.get(contentsKey);
	useEffect(() => {
		if (!selected || selected.hunks || contents.has(contentsKey)) return;
		setContents((current) => new Map(current).set(contentsKey, "loading"));
		desktopClient
			.invoke<SessionChangeContents>("read_session_change", {
				environmentId,
				cwd,
				oldOid: selected.oldOid,
				newOid: selected.newOid,
			})
			.then(
				(result) => result,
				(error: unknown) => ({
					error: error instanceof Error ? error.message : String(error),
				}),
			)
			.then((result) =>
				setContents((current) => new Map(current).set(contentsKey, result)),
			);
	}, [contents, contentsKey, cwd, environmentId, selected]);

	useEffect(
		() => () => {
			if (copyTimerRef.current !== null) {
				window.clearTimeout(copyTimerRef.current);
			}
		},
		[],
	);

	const handleCopyPath = useCallback(async (path: string) => {
		try {
			await navigator.clipboard.writeText(path);
			setCopied(true);
			if (copyTimerRef.current !== null) {
				window.clearTimeout(copyTimerRef.current);
			}
			copyTimerRef.current = window.setTimeout(() => setCopied(false), 1600);
		} catch {
			toast({
				variant: "destructive",
				title: "Copy failed",
				description: "The file path could not be copied to the clipboard.",
			});
		}
	}, []);

	const handleOpenInEditor = useCallback(
		async (path: string) => {
			try {
				await desktopClient.invoke("open_file_in_editor", {
					environmentId,
					path,
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
			}
		},
		[environmentId],
	);

	const scopeOptions: Array<{ scope: ChangesScope; label: string }> = [
		{ scope: "last-turn", label: "Last turn" },
		{ scope: "session", label: "Session" },
	];
	const notice = usingFallback
		? `${changes?.unavailableReason ?? "Git checkpoints are unavailable."} Showing edits reconstructed from this session's tool calls.`
		: set?.omitted
			? `${set.omitted} more changed files are not listed.`
			: null;
	const description =
		activeScope === "session"
			? "since the session started"
			: "in the last turn";

	return (
		<WorkspacePanelFrame id="changes-panel">
			<div
				className="flex shrink-0 flex-col border-r border-border bg-sidebar/40"
				style={{ width: COLUMN_WIDTH }}
			>
				<div className="shrink-0 border-b border-border/70 p-2">
					<div
						aria-label="Change scope"
						className="flex h-7 items-center rounded-md bg-secondary p-0.5 text-[11px]"
						role="tablist"
					>
						{scopeOptions.map((option) => (
							<button
								aria-selected={activeScope === option.scope}
								className={cn(
									"h-6 flex-1 rounded-[5px] px-2 whitespace-nowrap",
									activeScope === option.scope
										? "bg-background text-foreground shadow-xs"
										: "text-muted-foreground hover:text-foreground",
								)}
								disabled={usingFallback && option.scope === "last-turn"}
								key={option.scope}
								onClick={() => onScopeChange(option.scope)}
								role="tab"
								type="button"
							>
								{option.label}
							</button>
						))}
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
					<span className="font-mono">
						<span className="text-chart-2">+{totals.additions}</span>{" "}
						<span className="text-destructive">-{totals.deletions}</span>
					</span>
					<span className="truncate">
						· {files.length} file{files.length === 1 ? "" : "s"}
						{description ? ` ${description}` : ""}
					</span>
				</div>
				{notice ? (
					<p className="shrink-0 px-3 pb-1 text-[11px] text-muted-foreground/80">
						{notice}
					</p>
				) : null}
				<div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
					{changes === null ? (
						<div className="flex justify-center p-4 text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
						</div>
					) : files.length === 0 ? (
						<p className="px-2 py-3 text-[11px] text-muted-foreground/80">
							No files changed {description}.
						</p>
					) : (
						files.map((file) => (
							<ChangeRow
								file={file}
								key={file.path}
								onOpen={() => onSelectPath(file.path)}
								selected={file.path === selected?.path}
							/>
						))
					)}
				</div>
				<button
					className="flex h-9 shrink-0 items-center gap-1.5 border-t border-border/70 px-3 text-left text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
					onClick={onOpenGit}
					type="button"
				>
					<GitBranch className="size-3" />
					All uncommitted changes
				</button>
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-[11px] text-muted-foreground">
					{selected ? (
						<>
							<FileIcon path={selected.path} />
							<span
								className="min-w-0 truncate font-mono"
								title={selected.path}
							>
								{selected.path}
							</span>
							<span className="shrink-0 font-mono">
								<span className="text-chart-2">+{selected.additions ?? 0}</span>{" "}
								<span className="text-destructive">
									-{selected.deletions ?? 0}
								</span>
							</span>
							<span className="ml-auto flex shrink-0 items-center gap-0.5">
								<Button
									aria-label="Copy file path"
									className="text-muted-foreground"
									onClick={() =>
										void handleCopyPath(absolutePath(selected.path))
									}
									size="icon-sm"
									title="Copy file path"
									variant="ghost"
								>
									{copied ? (
										<Check className="size-3 text-primary" />
									) : (
										<Copy className="size-3" />
									)}
								</Button>
								{selected.status !== "D" ? (
									<Button
										aria-label="Open in editor"
										className="text-muted-foreground"
										onClick={() =>
											void handleOpenInEditor(absolutePath(selected.path))
										}
										size="icon-sm"
										title="Open in editor"
										variant="ghost"
									>
										<ExternalLink className="size-3" />
									</Button>
								) : null}
							</span>
						</>
					) : (
						<span className="ml-auto" />
					)}
					<Button
						aria-label="Hide changes"
						className="size-6 shrink-0 text-muted-foreground"
						onClick={onClose}
						size="icon-sm"
						variant="ghost"
					>
						<X className="size-3.5" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-auto">
					{!selected ? (
						<Placeholder>Select a file to see its changes.</Placeholder>
					) : selected.hunks ? (
						<div className="flex flex-col gap-2">
							{selected.hunks.map((hunk, index) => {
								const isCompleteNewContents =
									hunk.old.length === 0 &&
									hunk.oldStart === 1 &&
									hunk.newStart === 1;
								return (
									<CodeDiff
										fragment={!isCompleteNewContents}
										// biome-ignore lint/suspicious/noArrayIndexKey: hunks never reorder within a file
										key={`${selected.path}-${index}-${hunk.oldStart}-${hunk.newStart}`}
										newText={hunk.new}
										oldText={isCompleteNewContents ? undefined : hunk.old}
										path={selected.path}
									/>
								);
							})}
						</div>
					) : selectedContents === undefined ||
						selectedContents === "loading" ? (
						<div className="flex justify-center p-6 text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
						</div>
					) : "error" in selectedContents ? (
						<p className="p-4 text-xs text-destructive">
							{selectedContents.error}
						</p>
					) : selectedContents.binary ? (
						<Placeholder>Binary file; no text diff to show.</Placeholder>
					) : selectedContents.truncated ? (
						<Placeholder>This file is too large to show inline.</Placeholder>
					) : (
						<CodeDiff
							newText={selectedContents.newText}
							oldText={selectedContents.oldText}
							path={selected.path}
						/>
					)}
				</div>
			</div>
		</WorkspacePanelFrame>
	);
}

function Placeholder({ children }: { children: string }) {
	return <p className="p-4 text-xs text-muted-foreground">{children}</p>;
}
