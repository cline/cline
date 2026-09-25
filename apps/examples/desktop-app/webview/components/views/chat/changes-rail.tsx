"use client";

import {
	AgentChangedFileTree,
	AgentDiffStats,
	AgentFilePanelHeader,
	AgentSegmentedControl,
	AgentWorkspaceTree,
	type AgentWorkspaceTreeNode,
} from "@cline/ui";
import {
	ToolFileDiff,
	ToolFileView,
} from "@cline/ui/components/agent-chat/tool-diff";
import {
	AppWindow,
	Check,
	Columns2,
	Copy,
	ExternalLink,
	RefreshCw,
	Rows3,
	Undo2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionDiffHunk, SessionFileDiff } from "@/lib/session-diff";
import {
	type RailChangedFile,
	summarizeRailFiles,
	toRailChangedFiles,
	toRailFilesFromSessionDiffs,
	WORKSPACE_CHANGES_SCOPES,
	type WorkspaceChangesResult,
	type WorkspaceChangesScope,
	type WorkspaceDirectoryEntry,
	type WorkspaceFileContents,
} from "@/lib/workspace-changes";
import { resolveWorkspaceFilePath } from "@/lib/workspace-paths";
import { EditorIcon } from "./editor-icons";

type ChangesRailProps = {
	environmentId: string;
	sessionId: string | null;
	cwd?: string;
	/** Tool-event reconstruction, shown when git-backed data is unavailable. */
	fallbackFileDiffs: SessionFileDiff[];
	/** Any change to this value refetches the current scope. */
	refreshKey: string;
	onClose: () => void;
};

type EditorOption = { id: string; label: string };
type RailTab = "changes" | "files";
type DiffStyle = "unified" | "split";

const REFRESH_DEBOUNCE_MS = 250;

export function ChangesRail({
	environmentId,
	sessionId,
	cwd,
	fallbackFileDiffs,
	refreshKey,
	onClose,
}: ChangesRailProps) {
	const [tab, setTab] = useState<RailTab>("changes");
	const [scope, setScope] = useState<WorkspaceChangesScope>("session");
	const [result, setResult] = useState<WorkspaceChangesResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
	const [pendingRevert, setPendingRevert] = useState<RailChangedFile | null>(
		null,
	);
	const [reverting, setReverting] = useState(false);
	const [editors, setEditors] = useState<EditorOption[]>([]);
	const requestRef = useRef(0);

	useEffect(() => {
		let cancelled = false;
		desktopClient
			.invoke<EditorOption[]>("list_available_editors")
			.then((list) => {
				if (!cancelled && Array.isArray(list)) setEditors(list);
			})
			.catch(() => {
				// Older sidecars lack the command; the menu still offers the
				// system default opener.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const fetchChanges = useCallback(async () => {
		if (!cwd) {
			setResult(null);
			return;
		}
		const request = ++requestRef.current;
		setLoading(true);
		try {
			const next = await desktopClient.invoke<WorkspaceChangesResult>(
				"get_workspace_changes",
				{
					environmentId,
					cwd,
					scope,
					...(sessionId ? { sessionId } : {}),
				},
			);
			if (request !== requestRef.current) return;
			setResult(next);
			setError(null);
		} catch (fetchError) {
			if (request !== requestRef.current) return;
			setError(
				fetchError instanceof Error
					? fetchError.message
					: "Could not load workspace changes.",
			);
		} finally {
			if (request === requestRef.current) setLoading(false);
		}
	}, [cwd, environmentId, scope, sessionId]);

	// Tool edits stream in while the agent works; coalesce bursts into one
	// git round-trip.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a reload signal.
	useEffect(() => {
		const timer = window.setTimeout(
			() => void fetchChanges(),
			REFRESH_DEBOUNCE_MS,
		);
		return () => window.clearTimeout(timer);
	}, [fetchChanges, refreshKey]);

	// A stale result for another scope is never shown; until the new fetch
	// resolves the rail reads as loading.
	const scopeResult = result?.scope === scope ? result : null;
	const gitUnavailable = !!scopeResult?.unavailableReason;
	const useFallback = gitUnavailable && scope !== "uncommitted";
	const files = useMemo<RailChangedFile[]>(() => {
		if (useFallback) return toRailFilesFromSessionDiffs(fallbackFileDiffs);
		return scopeResult ? toRailChangedFiles(scopeResult.files) : [];
	}, [fallbackFileDiffs, scopeResult, useFallback]);
	const totals = useMemo(() => summarizeRailFiles(files), [files]);
	const selected =
		files.find((file) => file.path === selectedPath) ?? files[0] ?? null;

	const notice = error
		? error
		: useFallback
			? `${scopeResult?.unavailableReason} Showing edits reconstructed from this session's tool calls instead.`
			: gitUnavailable
				? scopeResult?.unavailableReason
				: scopeResult?.omittedFiles
					? `Showing the first ${scopeResult.files.length} changed files; ${scopeResult.omittedFiles} more are not listed.`
					: null;

	// Git-backed paths are repository-root-relative; tool-event fallbacks and
	// the Files tab are relative to the workspace folder.
	const changesRoot = (!useFallback && scopeResult?.root) || cwd;
	const resolvePath = useCallback(
		(path: string, base: string | undefined = cwd) =>
			resolveWorkspaceFilePath(path, base),
		[cwd],
	);

	const handleOpenInEditor = useCallback(
		async (path: string, editor?: string, base: string | undefined = cwd) => {
			try {
				await desktopClient.invoke("open_file_in_editor", {
					environmentId,
					path,
					...(base?.trim() ? { cwd: base } : {}),
					...(editor ? { editor } : {}),
				});
			} catch (openError) {
				toast({
					variant: "destructive",
					title: "Could not open file",
					description:
						openError instanceof Error
							? openError.message
							: "The file could not be opened in an editor.",
				});
			}
		},
		[cwd, environmentId],
	);

	const handleRevert = useCallback(async () => {
		if (!pendingRevert || !cwd) return;
		setReverting(true);
		try {
			await desktopClient.invoke("revert_workspace_change", {
				environmentId,
				cwd,
				scope,
				path: pendingRevert.path,
				...(sessionId ? { sessionId } : {}),
			});
			setPendingRevert(null);
			void fetchChanges();
		} catch (revertError) {
			toast({
				variant: "destructive",
				title: "Could not revert file",
				description:
					revertError instanceof Error
						? revertError.message
						: "The file could not be reverted.",
			});
		} finally {
			setReverting(false);
		}
	}, [cwd, environmentId, fetchChanges, pendingRevert, scope, sessionId]);

	return (
		<aside
			aria-label="Workspace changes"
			className="flex h-full min-h-0 flex-col bg-background text-foreground"
		>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
				<AgentSegmentedControl
					aria-label="Rail view"
					onValueChange={setTab}
					options={[
						{
							value: "changes",
							label: "Changes",
							count: files.length > 0 ? files.length : undefined,
						},
						{ value: "files", label: "Files" },
					]}
					value={tab}
				/>
				<div className="ml-auto flex items-center gap-0.5">
					{tab === "changes" && (
						<Button
							aria-label="Refresh changes"
							className="text-muted-foreground"
							disabled={loading}
							onClick={() => void fetchChanges()}
							size="icon-sm"
							title="Refresh"
							variant="ghost"
						>
							<RefreshCw
								className={loading ? "size-3.5 animate-spin" : "size-3.5"}
							/>
						</Button>
					)}
					<Button
						aria-label="Close changes panel"
						className="text-muted-foreground"
						onClick={onClose}
						size="icon-sm"
						variant="ghost"
					>
						<X className="size-4" />
					</Button>
				</div>
			</div>

			{tab === "changes" ? (
				<>
					<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
						<AgentSegmentedControl
							aria-label="Change scope"
							onValueChange={setScope}
							options={WORKSPACE_CHANGES_SCOPES}
							value={scope}
						/>
						<AgentDiffStats
							additions={totals.additions}
							className="ml-auto pr-1"
							deletions={totals.deletions}
						/>
					</div>
					{notice && (
						<p
							className={`shrink-0 border-b border-border px-3 py-2 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
							role={error ? "alert" : undefined}
						>
							{notice}
						</p>
					)}
					<ResizablePanelGroup
						autoSaveId="cline-changes-rail-split"
						className="min-h-0 flex-1"
						direction="vertical"
					>
						<ResizablePanel defaultSize={35} minSize={12}>
							<ScrollArea className="h-full">
								<AgentChangedFileTree
									emptyMessage={
										!scopeResult
											? "Loading changes…"
											: scope === "uncommitted"
												? "The working tree is clean."
												: "No files changed in this scope yet."
									}
									files={files}
									onSelect={(file) => setSelectedPath(file.path)}
									selectedPath={selected?.path ?? null}
								/>
							</ScrollArea>
						</ResizablePanel>
						<ResizableHandle />
						<ResizablePanel minSize={20}>
							{selected ? (
								<div className="flex h-full min-h-0 flex-col">
									<AgentFilePanelHeader
										actions={
											<>
												<Button
													aria-label={
														diffStyle === "unified"
															? "Switch to split diff"
															: "Switch to unified diff"
													}
													className="text-muted-foreground"
													onClick={() =>
														setDiffStyle((style) =>
															style === "unified" ? "split" : "unified",
														)
													}
													size="icon-sm"
													title={
														diffStyle === "unified"
															? "Split view"
															: "Unified view"
													}
													variant="ghost"
												>
													{diffStyle === "unified" ? (
														<Columns2 className="size-3.5" />
													) : (
														<Rows3 className="size-3.5" />
													)}
												</Button>
												<CopyPathButton
													path={resolvePath(selected.path, changesRoot)}
												/>
												{selected.status !== "deleted" && (
													<OpenInEditorMenu
														editors={editors}
														onOpen={(editor) =>
															void handleOpenInEditor(
																selected.path,
																editor,
																changesRoot,
															)
														}
														path={selected.path}
													/>
												)}
												{!selected.hunks && (
													<Button
														aria-label={`Revert ${selected.path}`}
														className="text-muted-foreground hover:text-destructive"
														onClick={() => setPendingRevert(selected)}
														size="icon-sm"
														title="Revert file"
														variant="ghost"
													>
														<Undo2 className="size-3.5" />
													</Button>
												)}
											</>
										}
										additions={selected.additions}
										deletions={selected.deletions}
										path={selected.path}
										status={selected.status}
									/>
									<ScrollArea className="min-h-0 flex-1">
										<SelectedFileDiff diffStyle={diffStyle} file={selected} />
									</ScrollArea>
								</div>
							) : (
								<div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
									Select a file to see its diff.
								</div>
							)}
						</ResizablePanel>
					</ResizablePanelGroup>
				</>
			) : (
				<WorkspaceFilesTab
					cwd={cwd}
					editors={editors}
					environmentId={environmentId}
					onOpenInEditor={handleOpenInEditor}
					resolvePath={resolvePath}
				/>
			)}

			<AlertDialog
				onOpenChange={(open) => {
					if (!open && !reverting) setPendingRevert(null);
				}}
				open={pendingRevert !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revert file?</AlertDialogTitle>
						<AlertDialogDescription>
							<span className="font-mono text-xs">{pendingRevert?.path}</span>{" "}
							will be restored to how it was at the{" "}
							{scope === "uncommitted"
								? "last commit"
								: scope === "turn"
									? "start of the last turn"
									: "start of this session"}
							{pendingRevert?.status === "added"
								? ", which means the file will be deleted."
								: "."}{" "}
							This cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={reverting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={reverting}
							onClick={(event) => {
								event.preventDefault();
								void handleRevert();
							}}
						>
							{reverting ? "Reverting…" : "Revert"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</aside>
	);
}

function SelectedFileDiff({
	file,
	diffStyle,
}: {
	file: RailChangedFile;
	diffStyle: DiffStyle;
}) {
	if (file.binary) {
		return <Placeholder>Binary file; no text diff available.</Placeholder>;
	}
	if (file.truncated) {
		return <Placeholder>This file is too large to show inline.</Placeholder>;
	}
	if (file.hunks) {
		return file.hunks.length === 0 ? (
			<Placeholder>No hunk details available.</Placeholder>
		) : (
			<div className="flex flex-col gap-2 p-2">
				{file.hunks.map((hunk, index) => (
					<FragmentHunk
						hunk={hunk}
						key={`${file.path}-${index}-${hunk.oldStart}-${hunk.newStart}`}
						path={file.path}
					/>
				))}
			</div>
		);
	}
	return (
		<ToolFileDiff
			background="var(--background)"
			className="cline-chat-selectable"
			newText={file.newText}
			oldText={file.oldText}
			options={{ diffStyle }}
			path={file.path}
		/>
	);
}

// Tool-event fallback: a hunk with no old side starting at line 1 carries
// the complete new contents; anything else is a fragment without reliable
// line numbers (mirrors ToolCallRow in chat-messages.tsx).
function FragmentHunk({ hunk, path }: { hunk: SessionDiffHunk; path: string }) {
	const isCompleteNewContents =
		hunk.old.length === 0 && hunk.oldStart === 1 && hunk.newStart === 1;
	return (
		<ToolFileDiff
			background="var(--background)"
			className="cline-chat-selectable"
			fragment={!isCompleteNewContents}
			newText={hunk.new}
			oldText={isCompleteNewContents ? undefined : hunk.old}
			path={path}
		/>
	);
}

function Placeholder({ children }: { children: string }) {
	return <p className="p-4 text-xs text-muted-foreground">{children}</p>;
}

function CopyPathButton({ path }: { path: string }) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (timerRef.current !== null) window.clearTimeout(timerRef.current);
		},
		[],
	);
	return (
		<Button
			aria-label="Copy file path"
			className={copied ? "text-primary" : "text-muted-foreground"}
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(path);
					setCopied(true);
					if (timerRef.current !== null) window.clearTimeout(timerRef.current);
					timerRef.current = window.setTimeout(() => setCopied(false), 1600);
				} catch {
					toast({
						variant: "destructive",
						title: "Copy failed",
						description: "The file path could not be copied to the clipboard.",
					});
				}
			}}
			size="icon-sm"
			title="Copy file path"
			variant="ghost"
		>
			{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
		</Button>
	);
}

function OpenInEditorMenu({
	path,
	editors,
	onOpen,
}: {
	path: string;
	editors: EditorOption[];
	onOpen: (editor?: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label={`Open ${path} in editor`}
					className="text-muted-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
					size="icon-sm"
					title="Open in editor"
					variant="ghost"
				>
					<ExternalLink className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-52">
				<DropdownMenuLabel>Open in</DropdownMenuLabel>
				{editors.map((editor) => (
					<DropdownMenuItem key={editor.id} onSelect={() => onOpen(editor.id)}>
						<EditorIcon editorId={editor.id} />
						{editor.label}
					</DropdownMenuItem>
				))}
				{editors.length > 0 && <DropdownMenuSeparator />}
				<DropdownMenuItem onSelect={() => onOpen("default")}>
					<AppWindow aria-hidden />
					System default
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function WorkspaceFilesTab({
	cwd,
	environmentId,
	editors,
	onOpenInEditor,
	resolvePath,
}: {
	cwd?: string;
	environmentId: string;
	editors: EditorOption[];
	onOpenInEditor: (path: string, editor?: string) => Promise<void>;
	resolvePath: (path: string) => string;
}) {
	const [entries, setEntries] = useState<
		Record<string, WorkspaceDirectoryEntry[]>
	>({});
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<WorkspaceFileContents | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadDirectory = useCallback(
		async (path: string) => {
			if (!cwd) return;
			setLoadingDirs((previous) => new Set(previous).add(path));
			try {
				const listing = await desktopClient.invoke<{
					path: string;
					entries: WorkspaceDirectoryEntry[];
				}>("list_workspace_directory", { environmentId, cwd, path });
				setEntries((previous) => ({ ...previous, [path]: listing.entries }));
				setError(null);
			} catch (listError) {
				setError(
					listError instanceof Error
						? listError.message
						: "Could not list this folder.",
				);
			} finally {
				setLoadingDirs((previous) => {
					const next = new Set(previous);
					next.delete(path);
					return next;
				});
			}
		},
		[cwd, environmentId],
	);

	// Reset when the workspace changes; the root loads on mount.
	useEffect(() => {
		setEntries({});
		setExpanded(new Set());
		setSelected(null);
		setSelectedPath(null);
		void loadDirectory("");
	}, [loadDirectory]);

	const handleToggle = useCallback(
		(path: string) => {
			setExpanded((previous) => {
				const next = new Set(previous);
				if (next.has(path)) next.delete(path);
				else next.add(path);
				return next;
			});
			if (!entries[path]) void loadDirectory(path);
		},
		[entries, loadDirectory],
	);

	const handleSelectFile = useCallback(
		async (node: AgentWorkspaceTreeNode) => {
			if (!cwd) return;
			setSelectedPath(node.path);
			try {
				const contents = await desktopClient.invoke<WorkspaceFileContents>(
					"read_workspace_file",
					{ environmentId, cwd, path: node.path },
				);
				setSelected(contents);
				setError(null);
			} catch (readError) {
				setSelected(null);
				setError(
					readError instanceof Error
						? readError.message
						: "Could not read this file.",
				);
			}
		},
		[cwd, environmentId],
	);

	return (
		<>
			{error && (
				<p
					className="shrink-0 border-b border-border px-3 py-2 text-xs text-destructive"
					role="alert"
				>
					{error}
				</p>
			)}
			<ResizablePanelGroup
				autoSaveId="cline-changes-rail-files-split"
				className="min-h-0 flex-1"
				direction="vertical"
			>
				<ResizablePanel defaultSize={45} minSize={12}>
					<ScrollArea className="h-full">
						<AgentWorkspaceTree
							entries={entries}
							expanded={expanded}
							loading={loadingDirs}
							onSelectFile={(node) => void handleSelectFile(node)}
							onToggleDirectory={handleToggle}
							selectedPath={selectedPath}
						/>
					</ScrollArea>
				</ResizablePanel>
				<ResizableHandle />
				<ResizablePanel minSize={20}>
					{selected ? (
						<div className="flex h-full min-h-0 flex-col">
							<AgentFilePanelHeader
								actions={
									<>
										<CopyPathButton path={resolvePath(selected.path)} />
										<OpenInEditorMenu
											editors={editors}
											onOpen={(editor) =>
												void onOpenInEditor(selected.path, editor)
											}
											path={selected.path}
										/>
									</>
								}
								path={selected.path}
							/>
							<ScrollArea className="min-h-0 flex-1">
								{selected.binary ? (
									<Placeholder>Binary file; no preview available.</Placeholder>
								) : selected.truncated ? (
									<Placeholder>
										This file is too large to show inline.
									</Placeholder>
								) : (
									<ToolFileView
										background="var(--background)"
										className="cline-chat-selectable"
										path={selected.path}
										text={selected.text}
									/>
								)}
							</ScrollArea>
						</div>
					) : (
						<div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
							Select a file to preview it.
						</div>
					)}
				</ResizablePanel>
			</ResizablePanelGroup>
		</>
	);
}
