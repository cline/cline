"use client";

import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { File as PierreFile } from "@pierre/diffs/react";
import {
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	ExternalLink,
	File,
	Folder,
	FolderOpen,
	Loader2,
	RefreshCw,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { resolveWorkspaceFilePath } from "@/lib/workspace-paths";

type ProjectEntry = {
	name: string;
	path: string;
	kind: "file" | "directory";
};

type DirectoryState = {
	entries?: ProjectEntry[];
	loading: boolean;
	error?: string;
	truncated?: boolean;
};

type FileState = {
	content?: string | null;
	truncated?: boolean;
	loading: boolean;
	error?: string;
};

type ProjectFilesPanelProps = {
	environmentId: string;
	/** Absolute folder the tree is rooted at. */
	workspaceRoot: string;
	/** Base the session's relative diff paths resolve against. */
	cwd: string;
	fileDiffs: SessionFileDiff[];
	onClose: () => void;
};

const DEFAULT_PANEL_WIDTH = 640;
const MIN_PANEL_WIDTH = 420;
const EXPLORER_WIDTH = 220;

const STATUS_CLASS: Record<string, string> = {
	M: "text-amber-500",
	A: "text-chart-2",
	"?": "text-chart-2",
	R: "text-sky-500",
	D: "text-destructive",
};

function relativeTo(root: string, path: string): string {
	const base = root.replace(/[\\/]+$/, "");
	return path.startsWith(base)
		? path.slice(base.length).replace(/^[\\/]/, "")
		: path;
}

function baseName(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
}

// Same recovery as @cline/ui's ToolFileDiff: under StrictMode a freshly
// mounted @pierre/diffs component can adopt a half-rendered shadow tree and
// stay blank; a rendered file always carries `style[data-theme-css]`, so
// remount until it does.
const RENDER_CHECK_DELAY_MS = 400;
const MAX_RENDER_ATTEMPTS = 3;

function FileContents({ path, contents }: { path: string; contents: string }) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [renderAttempt, setRenderAttempt] = useState(0);
	useEffect(() => {
		if (renderAttempt >= MAX_RENDER_ATTEMPTS) return;
		const timer = window.setTimeout(() => {
			const container = hostRef.current?.firstElementChild;
			if (
				container &&
				!container.shadowRoot?.querySelector("style[data-theme-css]")
			) {
				setRenderAttempt((attempt) => attempt + 1);
			}
		}, RENDER_CHECK_DELAY_MS);
		return () => window.clearTimeout(timer);
	}, [renderAttempt]);
	return (
		<div ref={hostRef} style={{ display: "contents" }}>
			<PierreFile
				file={{ name: path, contents }}
				key={renderAttempt}
				options={{
					disableFileHeader: true,
					themeType: "system",
					overflow: "scroll",
				}}
				style={
					{
						"--diffs-font-size": "var(--text-xs, 0.8rem)",
						"--diffs-line-height": "calc(var(--text-xs, 0.8rem) * 1.5)",
						"--diffs-light-bg": "var(--background)",
						"--diffs-dark-bg": "var(--background)",
						colorScheme: "inherit",
					} as CSSProperties
				}
			/>
		</div>
	);
}

function joinPath(root: string, relative: string): string {
	const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
	return `${root.replace(/[\\/]+$/, "")}${separator}${relative.replace(/^[\\/]/, "")}`;
}

export function ProjectFilesPanel({
	environmentId,
	workspaceRoot,
	cwd,
	fileDiffs,
	onClose,
}: ProjectFilesPanelProps) {
	const [width, setWidth] = useState(DEFAULT_PANEL_WIDTH);
	const [directories, setDirectories] = useState<Map<string, DirectoryState>>(
		() => new Map(),
	);
	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set([workspaceRoot]),
	);
	const [gitStatus, setGitStatus] = useState<Record<string, string>>({});
	const [openFiles, setOpenFiles] = useState<string[]>([]);
	const [activeFile, setActiveFile] = useState<string | null>(null);
	const [files, setFiles] = useState<Map<string, FileState>>(() => new Map());
	const [mode, setMode] = useState<"file" | "diff">("file");
	const [copied, setCopied] = useState(false);
	const [opening, setOpening] = useState(false);
	const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(
		null,
	);

	// Session edits keyed by absolute path, so the tree and tabs can mark them
	// and the viewer can switch into diff mode for them.
	const diffsByPath = useMemo(() => {
		const map = new Map<string, SessionFileDiff>();
		for (const diff of fileDiffs) {
			map.set(resolveWorkspaceFilePath(diff.path, cwd), diff);
		}
		return map;
	}, [cwd, fileDiffs]);

	const loadDirectory = useCallback(
		async (path: string) => {
			setDirectories((current) => {
				const next = new Map(current);
				next.set(path, {
					...current.get(path),
					loading: true,
					error: undefined,
				});
				return next;
			});
			try {
				const result = await desktopClient.invoke<{
					entries: ProjectEntry[];
					truncated: boolean;
				}>("list_project_entries", { environmentId, workspaceRoot, path });
				setDirectories((current) => {
					const next = new Map(current);
					next.set(path, {
						entries: result.entries,
						truncated: result.truncated,
						loading: false,
					});
					return next;
				});
			} catch (error) {
				setDirectories((current) => {
					const next = new Map(current);
					next.set(path, {
						...current.get(path),
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					});
					return next;
				});
			}
		},
		[environmentId, workspaceRoot],
	);

	const refreshGitStatus = useCallback(async () => {
		try {
			const result = await desktopClient.invoke<{
				root: string | null;
				entries: Record<string, string>;
			}>("get_git_status", { environmentId, cwd: workspaceRoot });
			if (!result.root) {
				setGitStatus({});
				return;
			}
			const byAbsolutePath: Record<string, string> = {};
			for (const [relative, status] of Object.entries(result.entries)) {
				byAbsolutePath[joinPath(result.root, relative)] = status;
			}
			setGitStatus(byAbsolutePath);
		} catch {
			// Plain folders and hosts without git simply show no status.
		}
	}, [environmentId, workspaceRoot]);

	const refresh = useCallback(() => {
		for (const path of expanded) void loadDirectory(path);
		void refreshGitStatus();
	}, [expanded, loadDirectory, refreshGitStatus]);

	useEffect(() => {
		void loadDirectory(workspaceRoot);
		void refreshGitStatus();
	}, [loadDirectory, refreshGitStatus, workspaceRoot]);

	// Agent edits change git status and may create files in open folders.
	const diffSignature = fileDiffs
		.map((diff) => `${diff.path}:${diff.additions}:${diff.deletions}`)
		.join("|");
	// biome-ignore lint/correctness/useExhaustiveDependencies: diffSignature is the trigger
	useEffect(() => {
		if (!diffSignature) return;
		void refreshGitStatus();
		setFiles((current) => {
			if (current.size === 0) return current;
			const next = new Map(current);
			for (const path of diffsByPath.keys()) next.delete(path);
			return next;
		});
		const parents = new Set<string>();
		for (const path of diffsByPath.keys()) {
			const parent = path.slice(0, Math.max(0, path.search(/[\\/][^\\/]*$/)));
			if (expanded.has(parent)) parents.add(parent);
		}
		for (const parent of parents) void loadDirectory(parent);
	}, [diffSignature]);

	const toggleDirectory = useCallback(
		(path: string) => {
			const isExpanded = expanded.has(path);
			setExpanded((current) => {
				const next = new Set(current);
				if (isExpanded) next.delete(path);
				else next.add(path);
				return next;
			});
			if (!isExpanded && !directories.get(path)?.entries) {
				void loadDirectory(path);
			}
		},
		[directories, expanded, loadDirectory],
	);

	const openFile = useCallback((path: string) => {
		setOpenFiles((current) =>
			current.includes(path) ? current : [...current, path],
		);
		setActiveFile(path);
	}, []);

	const closeFile = useCallback(
		(path: string) => {
			setOpenFiles((current) => {
				const index = current.indexOf(path);
				const next = current.filter((item) => item !== path);
				if (activeFile === path) {
					setActiveFile(next[Math.min(index, next.length - 1)] ?? null);
				}
				return next;
			});
		},
		[activeFile],
	);

	useEffect(() => {
		if (!activeFile || files.get(activeFile)) return;
		const path = activeFile;
		setFiles((current) => new Map(current).set(path, { loading: true }));
		desktopClient
			.invoke<{ content: string | null; truncated: boolean }>(
				"read_project_file",
				{ environmentId, workspaceRoot, path },
			)
			.then((result) => {
				setFiles((current) =>
					new Map(current).set(path, {
						content: result.content,
						truncated: result.truncated,
						loading: false,
					}),
				);
			})
			.catch((error) => {
				setFiles((current) =>
					new Map(current).set(path, {
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			});
	}, [activeFile, environmentId, files, workspaceRoot]);

	const activeDiff = activeFile ? diffsByPath.get(activeFile) : undefined;
	const effectiveMode = activeDiff ? mode : "file";
	const activeState = activeFile ? files.get(activeFile) : undefined;

	const handleCopyPath = useCallback(async () => {
		if (!activeFile) return;
		try {
			await navigator.clipboard.writeText(activeFile);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			toast({
				variant: "destructive",
				title: "Copy failed",
				description: "The file path could not be copied to the clipboard.",
			});
		}
	}, [activeFile]);

	const handleOpenInEditor = useCallback(async () => {
		if (!activeFile) return;
		setOpening(true);
		try {
			await desktopClient.invoke("open_file_in_editor", {
				environmentId,
				path: activeFile,
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
	}, [activeFile, environmentId]);

	const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
		dragStateRef.current = { startX: event.clientX, startWidth: width };
		event.currentTarget.setPointerCapture(event.pointerId);
	};
	const handleResizeMove = (event: React.PointerEvent<HTMLDivElement>) => {
		const drag = dragStateRef.current;
		if (!drag) return;
		// Leave the conversation column at least as wide as the composer needs.
		const maxWidth = Math.max(MIN_PANEL_WIDTH, window.innerWidth - 760);
		setWidth(
			Math.min(
				maxWidth,
				Math.max(
					MIN_PANEL_WIDTH,
					drag.startWidth + (drag.startX - event.clientX),
				),
			),
		);
	};
	const handleResizeEnd = () => {
		dragStateRef.current = null;
	};

	const renderEntries = (path: string, depth: number) => {
		const state = directories.get(path);
		if (!state?.entries) {
			return state?.loading ? (
				<div
					className="flex h-7 items-center gap-2 text-[11px] text-muted-foreground"
					style={{ paddingLeft: 8 + depth * 12 + 16 }}
				>
					<Loader2 className="size-3 animate-spin" /> Loading...
				</div>
			) : state?.error ? (
				<div
					className="py-1 text-[11px] text-destructive"
					style={{ paddingLeft: 8 + depth * 12 + 16 }}
				>
					{state.error}
				</div>
			) : null;
		}
		return (
			<>
				{state.entries.map((entry) => {
					const isDirectory = entry.kind === "directory";
					const isExpanded = isDirectory && expanded.has(entry.path);
					const status = gitStatus[entry.path];
					const changedBySession = diffsByPath.has(entry.path);
					return (
						<div key={entry.path}>
							<button
								className={cn(
									"group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs text-foreground/90 hover:bg-surface-hover",
									entry.path === activeFile && "bg-primary/15 text-foreground",
								)}
								onClick={() =>
									isDirectory
										? toggleDirectory(entry.path)
										: openFile(entry.path)
								}
								style={{ paddingLeft: 8 + depth * 12 }}
								title={entry.path}
								type="button"
							>
								{isDirectory ? (
									isExpanded ? (
										<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
									) : (
										<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
									)
								) : (
									<span className="w-3 shrink-0" />
								)}
								{isDirectory ? (
									isExpanded ? (
										<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
									) : (
										<Folder className="size-3.5 shrink-0 text-muted-foreground" />
									)
								) : (
									<File className="size-3.5 shrink-0 text-muted-foreground" />
								)}
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										status && !isDirectory && STATUS_CLASS[status],
									)}
								>
									{entry.name}
								</span>
								{changedBySession ? (
									<span
										className="size-1.5 shrink-0 rounded-full bg-primary"
										title="Changed in this session"
									/>
								) : null}
								{status && !isDirectory ? (
									<span
										className={cn(
											"w-3 shrink-0 text-center font-mono text-[10px] font-medium",
											STATUS_CLASS[status],
										)}
									>
										{status}
									</span>
								) : null}
							</button>
							{isExpanded ? renderEntries(entry.path, depth + 1) : null}
						</div>
					);
				})}
				{state.truncated ? (
					<div
						className="py-1 text-[11px] text-muted-foreground"
						style={{ paddingLeft: 8 + depth * 12 + 16 }}
					>
						Showing the first {state.entries.length} entries
					</div>
				) : null}
			</>
		);
	};

	return (
		<aside
			className="relative col-start-2 row-span-2 row-start-1 flex min-h-0 border-l border-border bg-background"
			id="project-files-panel"
			style={{ width }}
		>
			<div
				aria-hidden
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/30"
				onPointerDown={handleResizeStart}
				onPointerMove={handleResizeMove}
				onPointerUp={handleResizeEnd}
			/>
			<div
				className="flex shrink-0 flex-col border-r border-border bg-sidebar/40"
				style={{ width: EXPLORER_WIDTH }}
			>
				<div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/70 px-2">
					<span
						className="min-w-0 flex-1 truncate px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
						title={workspaceRoot}
					>
						{baseName(workspaceRoot) || "Files"}
					</span>
					<Button
						aria-label="Refresh files"
						className="size-6 text-muted-foreground"
						onClick={refresh}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<RefreshCw className="size-3" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-auto px-1 py-1">
					{renderEntries(workspaceRoot, 0)}
				</div>
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
					<div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
						{openFiles.map((path) => {
							const isActive = path === activeFile;
							return (
								<div
									className={cn(
										"group flex shrink-0 items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-xs text-muted-foreground",
										isActive &&
											"bg-background text-foreground shadow-[inset_0_1px_0_var(--primary)]",
									)}
									key={path}
								>
									<button
										className="flex items-center gap-1.5"
										onClick={() => setActiveFile(path)}
										title={path}
										type="button"
									>
										<File className="size-3 shrink-0" />
										<span className="max-w-40 truncate">{baseName(path)}</span>
										{diffsByPath.has(path) ? (
											<span className="size-1.5 shrink-0 rounded-full bg-primary" />
										) : null}
									</button>
									<button
										aria-label={`Close ${baseName(path)}`}
										className="rounded p-0.5 opacity-0 hover:bg-surface-hover group-hover:opacity-100 focus-visible:opacity-100"
										onClick={() => closeFile(path)}
										type="button"
									>
										<X className="size-3" />
									</button>
								</div>
							);
						})}
					</div>
					<Button
						aria-label="Hide project files"
						className="my-auto mr-1 size-6 shrink-0 text-muted-foreground"
						onClick={onClose}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<X className="size-3.5" />
					</Button>
				</div>
				{activeFile ? (
					<>
						<div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border/60 px-3 text-[11px] text-muted-foreground">
							<span className="min-w-0 truncate font-mono" title={activeFile}>
								{relativeTo(workspaceRoot, activeFile)}
							</span>
							{activeDiff ? (
								<span className="shrink-0 font-mono">
									<span className="text-chart-2">+{activeDiff.additions}</span>{" "}
									<span className="text-destructive">
										-{activeDiff.deletions}
									</span>
								</span>
							) : null}
							<span className="ml-auto flex shrink-0 items-center gap-1">
								{activeDiff ? (
									<div className="flex h-6 items-center rounded-md bg-secondary p-0.5">
										{(["file", "diff"] as const).map((item) => (
											<button
												aria-pressed={effectiveMode === item}
												className={cn(
													"h-5 rounded-[5px] px-2 capitalize",
													effectiveMode === item
														? "bg-background text-foreground shadow-xs"
														: "text-muted-foreground",
												)}
												key={item}
												onClick={() => setMode(item)}
												type="button"
											>
												{item}
											</button>
										))}
									</div>
								) : null}
								<Button
									aria-label="Copy file path"
									className="size-6"
									onClick={() => void handleCopyPath()}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									{copied ? (
										<Check className="size-3 text-primary" />
									) : (
										<Copy className="size-3" />
									)}
								</Button>
								<Button
									aria-label="Open in editor"
									className="size-6"
									disabled={opening}
									onClick={() => void handleOpenInEditor()}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<ExternalLink className="size-3" />
								</Button>
							</span>
						</div>
						<div className="cline-chat-selectable min-h-0 flex-1 overflow-auto">
							{effectiveMode === "diff" && activeDiff ? (
								<div className="flex flex-col gap-3 p-3">
									{activeDiff.hunks.map((hunk, index) => {
										const isCompleteNewContents =
											hunk.old.length === 0 &&
											hunk.oldStart === 1 &&
											hunk.newStart === 1;
										return (
											<ToolFileDiff
												background="var(--background)"
												fragment={!isCompleteNewContents}
												key={`${activeFile}-${index}-${hunk.oldStart}-${hunk.newStart}`}
												newText={hunk.new}
												oldText={isCompleteNewContents ? undefined : hunk.old}
												path={activeFile}
											/>
										);
									})}
								</div>
							) : activeState?.loading || !activeState ? (
								<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
									<Loader2 className="size-4 animate-spin" />
								</div>
							) : activeState.error ? (
								<div className="p-4 text-xs text-destructive">
									{activeState.error}
								</div>
							) : activeState.content === null ? (
								<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
									Binary file
								</div>
							) : (
								<>
									<FileContents
										contents={activeState.content ?? ""}
										key={activeFile}
										path={activeFile}
									/>
									{activeState.truncated ? (
										<div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
											File truncated to the first 1 MB.
										</div>
									) : null}
								</>
							)}
						</div>
					</>
				) : (
					<div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
						Select a file to view it
					</div>
				)}
			</div>
		</aside>
	);
}
