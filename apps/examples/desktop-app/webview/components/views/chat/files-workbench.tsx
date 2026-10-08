"use client";

import { File as PierreFile } from "@pierre/diffs/react";
import {
	AtSign,
	ChevronDown,
	ChevronRight,
	ExternalLink,
	File,
	FileCode2,
	FileJson,
	FileText,
	Folder,
	FolderOpen,
	Image as ImageIcon,
	LoaderCircle,
	RefreshCw,
	Search,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ClineLogo } from "@/components/cline-logo";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import { toWorkspaceRelativePath } from "@/lib/workspace-paths";
import { DiffHunk, OpenInEditorMenu, useAvailableEditors } from "./diff-view";

type FilesWorkbenchProps = {
	environmentId: string;
	cwd: string;
	fileDiffs: SessionFileDiff[];
	onAddToChat: (path: string) => void;
	className?: string;
};

type WorkspaceFileList = { files: string[]; truncated: boolean };

type WorkspaceFileContents = {
	path: string;
	size: number;
	contents: string;
	binary: boolean;
	truncated: boolean;
};

type DirEntry = { dirs: Set<string>; files: string[] };

const FILTER_RESULT_LIMIT = 200;

function baseName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function ancestorsOf(path: string): string[] {
	const parts = path.split("/");
	return parts
		.slice(0, -1)
		.map((_, index) => parts.slice(0, index + 1).join("/"));
}

function isCreated(diff: SessionFileDiff): boolean {
	const first = diff.hunks[0];
	return Boolean(
		first &&
			first.old.length === 0 &&
			first.oldStart === 1 &&
			first.newStart === 1,
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTypeIcon({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
	const base = cn("size-3.5 shrink-0", className);
	if (
		["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "rb"].includes(
			ext,
		)
	)
		return (
			<FileCode2
				className={cn(
					base,
					ext.endsWith("x") ? "text-sky-500" : "text-blue-500",
				)}
			/>
		);
	if (ext === "json")
		return <FileJson className={cn(base, "text-amber-500")} />;
	if (ext === "md" || ext === "mdx" || ext === "txt")
		return <FileText className={cn(base, "text-muted-foreground")} />;
	if (["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"].includes(ext))
		return <ImageIcon className={cn(base, "text-emerald-500")} />;
	return <File className={cn(base, "text-muted-foreground")} />;
}

/**
 * Project files beside the conversation: a tree on the left and tabbed,
 * read-only file views on the right. Files the agent changed this session are
 * marked, and can be flipped to their session diff.
 */
export function FilesWorkbench({
	environmentId,
	cwd,
	fileDiffs,
	onAddToChat,
	className,
}: FilesWorkbenchProps) {
	const changed = useMemo(
		() =>
			new Map(
				fileDiffs.map((diff) => [
					toWorkspaceRelativePath(diff.path, cwd),
					diff,
				]),
			),
		[cwd, fileDiffs],
	);
	const [listing, setListing] = useState<WorkspaceFileList | null>(null);
	const [listError, setListError] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set([...changed.keys()].flatMap(ancestorsOf)),
	);
	const [openPaths, setOpenPaths] = useState<string[]>(() =>
		[...changed.keys()].slice(0, 1),
	);
	const [activePath, setActivePath] = useState<string | null>(
		() => [...changed.keys()][0] ?? null,
	);
	const [mode, setMode] = useState<"file" | "changes">("file");

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-runs the listing on demand.
	useEffect(() => {
		let cancelled = false;
		setListError(null);
		desktopClient
			.invoke<WorkspaceFileList>("list_workspace_files", { environmentId, cwd })
			.then((result) => {
				if (!cancelled) setListing(result);
			})
			.catch((error) => {
				if (!cancelled)
					setListError(error instanceof Error ? error.message : String(error));
			});
		return () => {
			cancelled = true;
		};
	}, [environmentId, cwd, refreshKey]);

	// The index is cached briefly, so files the agent just created may not be
	// listed yet; merging the session's changed paths keeps them visible.
	const tree = useMemo(() => {
		const entries = new Map<string, DirEntry>();
		const entry = (dir: string) => {
			let value = entries.get(dir);
			if (!value) {
				value = { dirs: new Set(), files: [] };
				entries.set(dir, value);
			}
			return value;
		};
		const paths = new Set([
			...(listing?.files ?? []),
			...[...changed.keys()].filter((path) => !path.startsWith("/")),
		]);
		for (const path of paths) {
			const parents = ancestorsOf(path);
			let parent = "";
			for (const dir of parents) {
				entry(parent).dirs.add(dir);
				parent = dir;
			}
			entry(parent).files.push(path);
		}
		return { entries, paths: [...paths] };
	}, [changed, listing]);

	const changedDirs = useMemo(
		() => new Set([...changed.keys()].flatMap(ancestorsOf)),
		[changed],
	);

	const openFile = useCallback((path: string) => {
		setOpenPaths((current) =>
			current.includes(path) ? current : [...current, path],
		);
		setActivePath(path);
	}, []);

	const closeFile = (path: string) => {
		const index = openPaths.indexOf(path);
		const next = openPaths.filter((item) => item !== path);
		setOpenPaths(next);
		if (path === activePath) {
			setActivePath(next[Math.min(index, next.length - 1)] ?? null);
		}
	};

	const toggleDir = useCallback((dir: string) => {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(dir)) next.delete(dir);
			else next.add(dir);
			return next;
		});
	}, []);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return null;
		return tree.paths
			.filter((path) => path.toLowerCase().includes(needle))
			.sort((left, right) => {
				const leftName = baseName(left).toLowerCase().includes(needle) ? 0 : 1;
				const rightName = baseName(right).toLowerCase().includes(needle)
					? 0
					: 1;
				return leftName - rightName || left.localeCompare(right);
			})
			.slice(0, FILTER_RESULT_LIMIT);
	}, [query, tree.paths]);

	const renderFileRow = (
		path: string,
		depth: number,
		label = baseName(path),
	) => {
		const diff = changed.get(path);
		const created = diff ? isCreated(diff) : false;
		return (
			<button
				className={cn(
					"relative flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] hover:bg-surface-hover",
					path === activePath &&
						"bg-primary/10 ring-1 ring-primary/25 ring-inset hover:bg-primary/10",
				)}
				key={path}
				onClick={() => openFile(path)}
				style={{ paddingLeft: 8 + depth * 14 + 16 }}
				title={path}
				type="button"
			>
				<FileTypeIcon name={path} />
				<span
					className={cn(
						"min-w-0 flex-1 truncate",
						diff &&
							(created
								? "text-emerald-600 dark:text-emerald-400"
								: "text-amber-600 dark:text-amber-400"),
					)}
				>
					{label}
				</span>
				{diff ? <ClineLogo className="size-3 text-primary" /> : null}
			</button>
		);
	};

	const renderDir = (dir: string, depth: number): ReactNode[] => {
		const entry = tree.entries.get(dir);
		if (!entry) return [];
		const rows: ReactNode[] = [];
		for (const child of [...entry.dirs].sort((a, b) => a.localeCompare(b))) {
			const open = expanded.has(child);
			rows.push(
				<button
					className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[13px] text-foreground/90 hover:bg-surface-hover"
					key={child}
					onClick={() => toggleDir(child)}
					style={{ paddingLeft: 8 + depth * 14 }}
					title={child}
					type="button"
				>
					{open ? (
						<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
					) : (
						<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
					)}
					{open ? (
						<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
					) : (
						<Folder className="size-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="min-w-0 flex-1 truncate">{baseName(child)}</span>
					{!open && changedDirs.has(child) ? (
						<span className="size-1.5 shrink-0 rounded-full bg-amber-500/80" />
					) : null}
				</button>,
			);
			if (open) rows.push(...renderDir(child, depth + 1));
		}
		for (const file of [...entry.files].sort((a, b) => a.localeCompare(b))) {
			rows.push(renderFileRow(file, depth));
		}
		return rows;
	};

	const activeDiff = activePath ? changed.get(activePath) : undefined;
	const activeMode = activeDiff ? mode : "file";

	return (
		<div
			className={cn(
				"flex min-h-0 min-w-0 border-l border-border/70",
				className,
			)}
			id="files-workbench"
		>
			<div className="flex w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar/50">
				<div className="flex items-center gap-1 px-2 pt-2 pb-1">
					<label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs focus-within:border-primary/50">
						<Search className="size-3.5 shrink-0 text-muted-foreground" />
						<input
							aria-label="Filter files"
							className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Filter files"
							value={query}
						/>
					</label>
					<button
						aria-label="Refresh files"
						className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground"
						onClick={() => setRefreshKey((key) => key + 1)}
						title="Refresh files"
						type="button"
					>
						<RefreshCw className="size-3.5" />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
					{listError ? (
						<p className="px-2 py-3 text-xs text-muted-foreground">
							{listError}
						</p>
					) : !listing ? (
						<div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
							<LoaderCircle className="size-3.5 animate-spin" />
							Loading files...
						</div>
					) : filtered ? (
						filtered.length === 0 ? (
							<p className="px-2 py-3 text-xs text-muted-foreground">
								No matching files
							</p>
						) : (
							filtered.map((path) => renderFileRow(path, -1, path))
						)
					) : (
						renderDir("", 0)
					)}
					{listing?.truncated ? (
						<p className="px-2 py-2 text-[11px] text-muted-foreground">
							Showing the first {listing.files.length.toLocaleString()} files.
						</p>
					) : null}
				</div>
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				{openPaths.length > 0 ? (
					<div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border/70 bg-sidebar/40 pl-1">
						{openPaths.map((path) => (
							<div
								className={cn(
									"group -mb-px flex h-8 shrink-0 items-center gap-1.5 border-x border-t border-transparent pr-1 pl-3 text-xs",
									path === activePath
										? "rounded-t-md border-border/70 bg-background text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
								key={path}
								ref={
									path === activePath
										? (node) =>
												node?.scrollIntoView({
													block: "nearest",
													inline: "nearest",
												})
										: undefined
								}
							>
								<button
									className="flex items-center gap-1.5"
									onClick={() => setActivePath(path)}
									title={path}
									type="button"
								>
									<FileTypeIcon name={path} />
									{baseName(path)}
								</button>
								<button
									aria-label={`Close ${baseName(path)}`}
									className={cn(
										"inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground",
										path !== activePath && "opacity-0 group-hover:opacity-100",
									)}
									onClick={() => closeFile(path)}
									type="button"
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
				) : null}
				{activePath ? (
					<>
						<div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3">
							<div className="flex min-w-0 items-center gap-2">
								<span
									className="min-w-0 truncate font-mono text-xs text-muted-foreground"
									title={activePath}
								>
									{activePath}
								</span>
								{activeDiff ? (
									<span className="flex shrink-0 items-center gap-1.5 font-mono text-[11px]">
										<ClineLogo className="size-3 text-primary" />
										<span className="text-chart-2">
											+{activeDiff.additions}
										</span>
										<span className="text-destructive">
											-{activeDiff.deletions}
										</span>
									</span>
								) : null}
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{activeDiff ? (
									<div className="flex items-center rounded-md bg-muted p-0.5 text-xs font-medium">
										{(["file", "changes"] as const).map((value) => (
											<button
												aria-pressed={activeMode === value}
												className={cn(
													"h-6 rounded px-2 text-muted-foreground",
													activeMode === value &&
														"bg-background text-foreground shadow-xs",
												)}
												key={value}
												onClick={() => setMode(value)}
												type="button"
											>
												{value === "file" ? "File" : "Changes"}
											</button>
										))}
									</div>
								) : null}
								<button
									className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground"
									onClick={() => onAddToChat(activePath)}
									title="Mention this file in your message"
									type="button"
								>
									<AtSign className="size-3.5" />
									Add to chat
								</button>
								<EditorMenu
									cwd={cwd}
									environmentId={environmentId}
									path={activePath}
								/>
							</div>
						</div>
						{activeMode === "changes" && activeDiff ? (
							<div className="min-h-0 flex-1 overflow-auto py-2">
								{activeDiff.hunks.length === 0 ? (
									<p className="px-3 text-xs text-muted-foreground">
										No hunk details available.
									</p>
								) : (
									// Hunks never reorder within a file, so the index is stable.
									activeDiff.hunks.map((hunk, index) => (
										<DiffHunk
											hunk={hunk}
											key={`${index}-${hunk.oldStart}-${hunk.newStart}`}
											path={activePath}
										/>
									))
								)}
							</div>
						) : (
							<FileContents
								cwd={cwd}
								environmentId={environmentId}
								key={activePath}
								path={activePath}
								version={
									activeDiff
										? `${activeDiff.additions}:${activeDiff.deletions}:${activeDiff.hunks.length}`
										: ""
								}
							/>
						)}
					</>
				) : (
					<div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
						Select a file to view it
					</div>
				)}
			</div>
		</div>
	);
}

function EditorMenu({
	path,
	cwd,
	environmentId,
}: {
	path: string;
	cwd: string;
	environmentId: string;
}) {
	const editors = useAvailableEditors();
	return (
		<OpenInEditorMenu
			className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50 data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
			cwd={cwd}
			editors={editors}
			environmentId={environmentId}
			path={path}
		>
			<ExternalLink className="size-3.5" />
		</OpenInEditorMenu>
	);
}

/** `version` changes when the agent edits the file, prompting a re-read. */
function FileContents({
	environmentId,
	cwd,
	path,
	version,
}: {
	environmentId: string;
	cwd: string;
	path: string;
	version: string;
}) {
	const [file, setFile] = useState<WorkspaceFileContents | null>(null);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: version re-reads the file after the agent edits it.
	useEffect(() => {
		let cancelled = false;
		setError(null);
		desktopClient
			.invoke<WorkspaceFileContents>("read_workspace_file", {
				environmentId,
				cwd,
				path,
			})
			.then((result) => {
				if (!cancelled) setFile(result);
			})
			.catch((reason) => {
				if (!cancelled)
					setError(reason instanceof Error ? reason.message : String(reason));
			});
		return () => {
			cancelled = true;
		};
	}, [environmentId, cwd, path, version]);

	if (error) {
		return <p className="p-4 text-xs text-muted-foreground">{error}</p>;
	}
	if (!file) {
		return (
			<div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
				<LoaderCircle className="size-3.5 animate-spin" />
				Loading...
			</div>
		);
	}
	if (file.binary) {
		return (
			<p className="p-4 text-xs text-muted-foreground">
				Binary file ({formatBytes(file.size)}) not shown.
			</p>
		);
	}
	if (!file.contents) {
		return <p className="p-4 text-xs text-muted-foreground">Empty file.</p>;
	}
	return (
		<div className="cline-chat-selectable min-h-0 flex-1 overflow-auto py-2">
			{file.truncated ? (
				<p className="px-3 pb-2 text-[11px] text-muted-foreground">
					Showing the first {formatBytes(file.contents.length)} of{" "}
					{formatBytes(file.size)}.
				</p>
			) : null}
			<CodeFile contents={file.contents} path={path} />
		</div>
	);
}

const MAX_RENDER_ATTEMPTS = 3;

/**
 * Same StrictMode guard as ToolFileDiff: a FileDiff/File can adopt a
 * half-rendered shadow tree and stay blank, so remount until its theme
 * stylesheet is present.
 */
function CodeFile({ path, contents }: { path: string; contents: string }) {
	const hostRef = useRef<HTMLSpanElement | null>(null);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		if (attempt >= MAX_RENDER_ATTEMPTS) return;
		const timer = window.setTimeout(() => {
			const container = hostRef.current?.firstElementChild;
			if (!container) return;
			if (!container.shadowRoot?.querySelector("style[data-theme-css]")) {
				setAttempt((value) => value + 1);
			}
		}, 400);
		return () => window.clearTimeout(timer);
	}, [attempt]);

	return (
		<span ref={hostRef} style={{ display: "contents" }}>
			<PierreFile
				file={{ name: path, contents }}
				key={attempt}
				options={{ disableFileHeader: true, themeType: "system" }}
				style={
					{
						"--diffs-font-size": "var(--text-xs, 0.8rem)",
						"--diffs-line-height": "calc(var(--text-xs, 0.8rem) * 1.6)",
						"--diffs-light-bg": "var(--background)",
						"--diffs-dark-bg": "var(--background)",
						colorScheme: "inherit",
					} as CSSProperties
				}
			/>
		</span>
	);
}
