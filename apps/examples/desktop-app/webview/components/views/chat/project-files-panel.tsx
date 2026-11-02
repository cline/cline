"use client";

import {
	Check,
	ChevronDown,
	ChevronRight,
	Copy,
	ExternalLink,
	Loader2,
	Minus,
	Plus,
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
	type CommitFile,
	type SourceControlAction,
	type SourceControlCommit,
	type SourceControlFile,
	unstagePaths,
	useSourceControl,
} from "@/hooks/use-source-control";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionFileDiff } from "@/lib/session-diff";
import { cn } from "@/lib/utils";
import {
	LOCAL_WORKSPACE_ENVIRONMENT_ID,
	resolveWorkspaceFilePath,
} from "@/lib/workspace-paths";
import { FileIcon, FolderIcon } from "./file-icons";
import { CodeDiff, CodeFile } from "./highlighted-code";
import {
	type DiffScope,
	SOURCE_CONTROL_STATUS_CLASS,
	SourceControlColumn,
} from "./source-control-column";
import { WorkspacePanelFrame } from "./workspace-panel-frame";

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
	/** Keep showing it, but re-read on next use. */
	stale?: boolean;
};

type GitDiffState = {
	oldText?: string;
	newText?: string;
	binary?: boolean;
	truncated?: boolean;
	loading: boolean;
	error?: string;
	stale?: boolean;
};

function markStale<T extends { stale?: boolean }>(
	cache: Map<string, T>,
): Map<string, T> {
	if (cache.size === 0) return cache;
	const next = new Map<string, T>();
	for (const [key, entry] of cache) {
		// A commit's contents never change, so its diff never goes stale.
		next.set(
			key,
			key.startsWith("commit:") ? entry : { ...entry, stale: true },
		);
	}
	return next;
}

type PanelView = "source-control" | "files";

type Tab = {
	/** The path for working-copy tabs; commit tabs add the commit. */
	id: string;
	/** Absolute path. */
	path: string;
	mode: "file" | "diff";
	/** Which side of the index a diff opened from source control compares. */
	scope: DiffScope | null;
	/** Set for a file as changed by a past commit. */
	commit?: { sha: string; shortSha: string; file: CommitFile };
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

const COLUMN_WIDTH = 280;
const LOCAL_DIRECTORY_POLL_MS = 5_000;
const REMOTE_DIRECTORY_POLL_MS = 15_000;
const VIEWS: Array<{ id: PanelView; label: string }> = [
	{ id: "source-control", label: "Git" },
	{ id: "files", label: "Files" },
];

function relativeTo(root: string, path: string): string {
	const base = root.replace(/[\\/]+$/, "");
	return path.startsWith(base)
		? path.slice(base.length).replace(/^[\\/]/, "")
		: path;
}

function baseName(path: string): string {
	return path.split(/[\\/]/).pop() ?? path;
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
	const [view, setView] = useState<PanelView>("source-control");
	const [directories, setDirectories] = useState<Map<string, DirectoryState>>(
		() => new Map(),
	);
	const [expanded, setExpanded] = useState<Set<string>>(
		() => new Set([workspaceRoot]),
	);
	const [tabs, setTabs] = useState<Tab[]>([]);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [files, setFiles] = useState<Map<string, FileState>>(() => new Map());
	const [gitDiffs, setGitDiffs] = useState<Map<string, GitDiffState>>(
		() => new Map(),
	);
	const [copied, setCopied] = useState(false);
	const [opening, setOpening] = useState(false);
	const [pendingDiscard, setPendingDiscard] = useState<SourceControlFile[]>([]);
	// Bumped per key whenever its cache entry is dropped, so a read that was
	// already in flight cannot land on top of a fresher one.
	const readGenerationRef = useRef(new Map<string, number>());
	const invalidateReads = useCallback((keys: Iterable<string>) => {
		for (const key of keys) {
			readGenerationRef.current.set(
				key,
				(readGenerationRef.current.get(key) ?? 0) + 1,
			);
		}
	}, []);

	// Session edits keyed by absolute path, so the tree and tabs can mark them
	// and the viewer can fall back to their hunks for files git cannot diff.
	const diffsByPath = useMemo(() => {
		const map = new Map<string, SessionFileDiff>();
		for (const diff of fileDiffs) {
			map.set(resolveWorkspaceFilePath(diff.path, cwd), diff);
		}
		return map;
	}, [cwd, fileDiffs]);
	const diffSignature = fileDiffs
		.map((diff) => `${diff.path}:${diff.additions}:${diff.deletions}`)
		.join("|");

	const sourceControl = useSourceControl({
		environmentId,
		cwd: workspaceRoot,
		enabled: true,
		refreshKey: diffSignature,
	});
	const repoRoot = sourceControl.state?.root ?? null;
	const toAbsolute = useCallback(
		(relative: string) => (repoRoot ? joinPath(repoRoot, relative) : relative),
		[repoRoot],
	);
	const toRelative = useCallback(
		(absolute: string) =>
			repoRoot ? relativeTo(repoRoot, absolute).replace(/\\/g, "/") : absolute,
		[repoRoot],
	);
	// Per absolute path: how git sees it right now.
	const changesByPath = useMemo(() => {
		const map = new Map<
			string,
			{ staged?: SourceControlFile; worktree?: SourceControlFile }
		>();
		const state = sourceControl.state;
		if (!state?.root) return map;
		for (const file of state.staged) {
			map.set(toAbsolute(file.path), {
				...map.get(toAbsolute(file.path)),
				staged: file,
			});
		}
		for (const file of [...state.unstaged, ...state.untracked]) {
			map.set(toAbsolute(file.path), {
				...map.get(toAbsolute(file.path)),
				worktree: file,
			});
		}
		return map;
	}, [sourceControl.state, toAbsolute]);
	const sessionRelativePaths = useMemo(
		() => new Set(Array.from(diffsByPath.keys(), toRelative)),
		[diffsByPath, toRelative],
	);
	// Every repository snapshot may carry new contents even when counts match
	// (one changed line swapped for another), so cached views go stale and
	// the active one re-reads while still showing what it had.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot object is the trigger
	useEffect(() => {
		setGitDiffs(markStale);
		setFiles(markStale);
	}, [sourceControl.state]);
	// Files outside the browsable workspace (a repository above it) are read
	// against the repository root instead.
	const rootFor = useCallback(
		(path: string) =>
			path.startsWith(workspaceRoot.replace(/[\\/]+$/, "")) || !repoRoot
				? workspaceRoot
				: repoRoot,
		[repoRoot, workspaceRoot],
	);

	// Listings carry a per-path generation so a slow response (SSH) cannot
	// overwrite a newer one. Polls skip folders still loading instead of
	// superseding them, so a listing slower than the poll still lands.
	const loadingDirectoriesRef = useRef(new Set<string>());
	const loadDirectory = useCallback(
		async (path: string, options?: { ifIdle?: boolean }) => {
			if (options?.ifIdle && loadingDirectoriesRef.current.has(path)) return;
			const key = `dir:${path}`;
			const generation = (readGenerationRef.current.get(key) ?? 0) + 1;
			readGenerationRef.current.set(key, generation);
			const isCurrent = () => readGenerationRef.current.get(key) === generation;
			loadingDirectoriesRef.current.add(path);
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
				if (!isCurrent()) return;
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
				if (!isCurrent()) return;
				setDirectories((current) => {
					const next = new Map(current);
					next.set(path, {
						...current.get(path),
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					});
					return next;
				});
			} finally {
				if (isCurrent()) loadingDirectoriesRef.current.delete(path);
			}
		},
		[environmentId, workspaceRoot],
	);

	// Reloads what is open and forgets the rest, so a folder expanded later
	// lists what is on disk now; open rows keep their entries while loading.
	// Read through a ref: callers may fire after an await (pull, discard),
	// by which time the user may have expanded more folders.
	const expandedRef = useRef(expanded);
	expandedRef.current = expanded;
	const reloadDirectories = useCallback(
		(options?: { ifIdle?: boolean }) => {
			const open = expandedRef.current;
			setDirectories((current) => {
				const next = new Map<string, DirectoryState>();
				for (const path of open) {
					const entry = current.get(path);
					if (entry) next.set(path, entry);
				}
				return next;
			});
			for (const path of open) void loadDirectory(path, options);
		},
		[loadDirectory],
	);
	// There is no refresh button: while the tree is showing, expanded folders
	// and open files re-read on their own interval (independent of git, which
	// may be failing or absent), and again right after each git snapshot so
	// the tree follows actions and agent edits without waiting for a tick.
	useEffect(() => {
		if (view !== "files") return;
		const relistIfVisible = () => {
			if (document.visibilityState === "visible") {
				reloadDirectories({ ifIdle: true });
				setFiles(markStale);
			}
		};
		const interval = window.setInterval(
			relistIfVisible,
			environmentId === LOCAL_WORKSPACE_ENVIRONMENT_ID
				? LOCAL_DIRECTORY_POLL_MS
				: REMOTE_DIRECTORY_POLL_MS,
		);
		return () => window.clearInterval(interval);
	}, [environmentId, reloadDirectories, view]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot object is the trigger
	useEffect(() => {
		if (view === "files" && sourceControl.state) {
			reloadDirectories({ ifIdle: true });
		}
	}, [sourceControl.state]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-list when the tree is shown again
	useEffect(() => {
		if (view === "files") reloadDirectories();
	}, [view]);

	useEffect(() => {
		void loadDirectory(workspaceRoot);
	}, [loadDirectory, workspaceRoot]);

	// Agent edits may create files in open folders and change open contents.
	// biome-ignore lint/correctness/useExhaustiveDependencies: diffSignature is the trigger
	useEffect(() => {
		if (!diffSignature) return;
		invalidateReads(diffsByPath.keys());
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

	const openTab = useCallback((tab: Tab) => {
		setTabs((current) => {
			const index = current.findIndex((item) => item.id === tab.id);
			if (index === -1) return [...current, tab];
			const next = [...current];
			next[index] = tab;
			return next;
		});
		setActiveId(tab.id);
	}, []);
	const openFile = useCallback(
		(path: string) => openTab({ id: path, path, mode: "file", scope: null }),
		[openTab],
	);
	const openChange = useCallback(
		(file: SourceControlFile, scope: DiffScope) => {
			const path = toAbsolute(file.path);
			openTab({ id: path, path, mode: "diff", scope });
		},
		[openTab, toAbsolute],
	);
	// Opening the panel lands on the first change (in list order) instead of
	// an empty viewer. Once per open, and only while nothing is open yet, so
	// it never replaces something the user picked.
	const autoOpenedRef = useRef(false);
	useEffect(() => {
		const state = sourceControl.state;
		if (autoOpenedRef.current || !state || view !== "source-control") return;
		if (tabs.length > 0) {
			autoOpenedRef.current = true;
			return;
		}
		const first: [SourceControlFile, DiffScope] | undefined = state.staged[0]
			? [state.staged[0], "staged"]
			: state.unstaged[0]
				? [state.unstaged[0], "worktree"]
				: state.untracked[0]
					? [state.untracked[0], "worktree"]
					: undefined;
		if (!first) return;
		autoOpenedRef.current = true;
		openChange(...first);
	}, [openChange, sourceControl.state, tabs.length, view]);
	const openCommitFile = useCallback(
		(commit: SourceControlCommit, file: CommitFile) => {
			const path = toAbsolute(file.path);
			openTab({
				id: `commit:${commit.sha}:${file.path}`,
				path,
				mode: "diff",
				scope: null,
				commit: { sha: commit.sha, shortSha: commit.shortSha, file },
			});
		},
		[openTab, toAbsolute],
	);
	const loadCommit = useCallback(
		async (sha: string): Promise<CommitFile[]> => {
			const result = await desktopClient.invoke<{ files: CommitFile[] }>(
				"get_commit_details",
				{ environmentId, cwd: workspaceRoot, commit: sha },
			);
			return result.files;
		},
		[environmentId, workspaceRoot],
	);
	const setTabMode = useCallback((id: string, mode: Tab["mode"]) => {
		setTabs((current) =>
			current.map((tab) => (tab.id === id ? { ...tab, mode } : tab)),
		);
	}, []);

	const closeTab = useCallback(
		(id: string) => {
			const path = tabs.find((tab) => tab.id === id)?.path ?? id;
			const diffKeys = id.startsWith("commit:")
				? [id]
				: [`diff:${path}:staged`, `diff:${path}:worktree`];
			invalidateReads([path, ...diffKeys]);
			setFiles((current) => {
				if (!current.has(path)) return current;
				const next = new Map(current);
				next.delete(path);
				return next;
			});
			setGitDiffs((current) => {
				if (!diffKeys.some((key) => current.has(key))) return current;
				const next = new Map(current);
				for (const key of diffKeys) next.delete(key);
				return next;
			});
			setTabs((current) => {
				const index = current.findIndex((tab) => tab.id === id);
				const next = current.filter((tab) => tab.id !== id);
				if (activeId === id) {
					setActiveId(next[Math.min(index, next.length - 1)]?.id ?? null);
				}
				return next;
			});
		},
		[activeId, invalidateReads, tabs],
	);

	const tabStripRef = useRef<HTMLDivElement | null>(null);
	// A tab opened past the strip's edge would otherwise stay out of sight.
	useEffect(() => {
		if (!activeId) return;
		const element = Array.from(
			tabStripRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [],
		).find((item) => item.dataset.tabId === activeId);
		element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
	}, [activeId]);

	const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
	const activePath = activeTab?.path ?? null;
	const activeCommit = activeTab?.commit;
	const activeChange =
		activePath && !activeCommit ? changesByPath.get(activePath) : undefined;
	const activeSessionDiff =
		activePath && !activeCommit ? diffsByPath.get(activePath) : undefined;
	// Prefer the side the tab was opened from; otherwise whichever git has.
	const activeScope: DiffScope | null = activeChange
		? activeTab?.scope && activeChange[activeTab.scope]
			? activeTab.scope
			: activeChange.worktree
				? "worktree"
				: "staged"
		: null;
	const canDiff = Boolean(activeCommit || activeScope || activeSessionDiff);
	const effectiveMode: Tab["mode"] =
		activeCommit || (activeTab?.mode === "diff" && canDiff) ? "diff" : "file";
	const gitDiffKey = activeCommit
		? (activeTab?.id ?? null)
		: activePath && activeScope
			? `diff:${activePath}:${activeScope}`
			: null;

	useEffect(() => {
		if (!activePath || effectiveMode !== "file") return;
		const existing = files.get(activePath);
		// A read already in flight is left to finish; if a snapshot marked it
		// stale meanwhile, it stays stale on completion and re-reads then.
		if (existing && (existing.loading || !existing.stale)) return;
		const path = activePath;
		const generation = (readGenerationRef.current.get(path) ?? 0) + 1;
		readGenerationRef.current.set(path, generation);
		const isCurrent = () => readGenerationRef.current.get(path) === generation;
		setFiles((current) =>
			new Map(current).set(path, {
				...current.get(path),
				loading: true,
				stale: false,
			}),
		);
		desktopClient
			.invoke<{ content: string | null; truncated: boolean }>(
				"read_project_file",
				{ environmentId, workspaceRoot: rootFor(path), path },
			)
			.then((result) => {
				if (!isCurrent()) return;
				setFiles((current) =>
					new Map(current).set(path, {
						content: result.content,
						truncated: result.truncated,
						loading: false,
						stale: current.get(path)?.stale ?? false,
					}),
				);
			})
			.catch((error) => {
				if (!isCurrent()) return;
				setFiles((current) =>
					new Map(current).set(path, {
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			});
	}, [activePath, effectiveMode, environmentId, files, rootFor]);

	useEffect(() => {
		if (
			!gitDiffKey ||
			!activePath ||
			(!activeScope && !activeCommit) ||
			effectiveMode !== "diff"
		) {
			return;
		}
		const existing = gitDiffs.get(gitDiffKey);
		if (existing && (existing.loading || !existing.stale)) return;
		const key = gitDiffKey;
		const generation = (readGenerationRef.current.get(key) ?? 0) + 1;
		readGenerationRef.current.set(key, generation);
		const isCurrent = () => readGenerationRef.current.get(key) === generation;
		setGitDiffs((current) =>
			new Map(current).set(key, {
				...current.get(key),
				loading: true,
				stale: false,
			}),
		);
		desktopClient
			.invoke<{
				oldText?: string;
				newText: string;
				binary: boolean;
				truncated: boolean;
			}>("get_git_file_diff", {
				environmentId,
				cwd: workspaceRoot,
				path: activeCommit ? activeCommit.file.path : toRelative(activePath),
				staged: activeScope === "staged",
				commit: activeCommit?.sha,
				originalPath: activeCommit
					? activeCommit.file.originalPath
					: activeScope === "staged"
						? changesByPath.get(activePath)?.staged?.originalPath
						: undefined,
			})
			.then((result) => {
				if (!isCurrent()) return;
				setGitDiffs((current) =>
					new Map(current).set(key, {
						...result,
						loading: false,
						stale: current.get(key)?.stale ?? false,
					}),
				);
			})
			.catch((error) => {
				if (!isCurrent()) return;
				setGitDiffs((current) =>
					new Map(current).set(key, {
						loading: false,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			});
	}, [
		activeCommit,
		activePath,
		activeScope,
		changesByPath,
		effectiveMode,
		environmentId,
		gitDiffKey,
		gitDiffs,
		toRelative,
		workspaceRoot,
	]);

	const runAction = useCallback(
		async (action: SourceControlAction): Promise<boolean> => {
			try {
				await sourceControl.runAction(action);
				// Discards change what is on disk and in the index.
				setFiles(markStale);
				setGitDiffs(markStale);
				// A discard can delete untracked files from the tree.
				if (action.type === "discard") reloadDirectories();
				return true;
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Git command failed",
					description: error instanceof Error ? error.message : String(error),
				});
				return false;
			}
		},
		[reloadDirectories, sourceControl.runAction],
	);
	const confirmDiscard = useCallback(async () => {
		const files = pendingDiscard;
		setPendingDiscard([]);
		const untracked = files.filter((file) => file.status === "?");
		const ok = await runAction({
			type: "discard",
			paths: files
				.filter((file) => file.status !== "?")
				.map((file) => file.path),
			untrackedPaths: untracked.map((file) => file.path),
		});
		// Discarded untracked files no longer exist, so their tabs go too.
		if (ok) {
			for (const file of untracked) closeTab(toAbsolute(file.path));
		}
	}, [closeTab, pendingDiscard, runAction, toAbsolute]);

	const handleCopyPath = useCallback(async () => {
		if (!activePath) return;
		try {
			await navigator.clipboard.writeText(activePath);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			toast({
				variant: "destructive",
				title: "Copy failed",
				description: "The file path could not be copied to the clipboard.",
			});
		}
	}, [activePath]);

	const handleOpenInEditor = useCallback(async () => {
		if (!activePath) return;
		setOpening(true);
		try {
			await desktopClient.invoke("open_file_in_editor", {
				environmentId,
				path: activePath,
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
	}, [activePath, environmentId]);

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
					const change = changesByPath.get(entry.path);
					const status = (change?.worktree ?? change?.staged)?.status;
					const changedBySession = diffsByPath.has(entry.path);
					return (
						<div key={entry.path}>
							<button
								className={cn(
									"group flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs text-foreground/90 hover:bg-surface-hover",
									entry.path === activePath && "bg-primary/15 text-foreground",
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
									<FolderIcon open={isExpanded} path={entry.path} />
								) : (
									<FileIcon path={entry.path} />
								)}
								<span
									className={cn(
										"min-w-0 flex-1 truncate",
										status &&
											!isDirectory &&
											SOURCE_CONTROL_STATUS_CLASS[status],
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
											SOURCE_CONTROL_STATUS_CLASS[status],
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

	const activeFileState = activePath ? files.get(activePath) : undefined;
	const activeGitDiff = gitDiffKey ? gitDiffs.get(gitDiffKey) : undefined;
	const activeChangeFile =
		activeScope && activeChange ? activeChange[activeScope] : undefined;
	const activeStatSource = activeCommit?.file ?? activeChangeFile;
	const activeStat = activeStatSource
		? {
				additions: activeStatSource.additions ?? 0,
				deletions: activeStatSource.deletions ?? 0,
			}
		: activeSessionDiff
			? {
					additions: activeSessionDiff.additions,
					deletions: activeSessionDiff.deletions,
				}
			: null;

	return (
		<WorkspacePanelFrame id="project-files-panel">
			<div
				className="flex shrink-0 flex-col border-r border-border bg-sidebar/40"
				style={{ width: COLUMN_WIDTH }}
			>
				<div className="shrink-0 border-b border-border/70 p-2">
					<div
						aria-label="Panel view"
						className="grid h-7 grid-cols-2 items-center rounded-md bg-secondary p-0.5 text-[11px]"
						role="tablist"
					>
						{VIEWS.map((item) => (
							<button
								aria-selected={view === item.id}
								className={cn(
									"h-6 rounded-[5px] px-2 whitespace-nowrap",
									view === item.id
										? "bg-background text-foreground shadow-xs"
										: "text-muted-foreground hover:text-foreground",
								)}
								key={item.id}
								onClick={() => setView(item.id)}
								role="tab"
								type="button"
							>
								{item.label}
							</button>
						))}
					</div>
				</div>
				{view === "source-control" ? (
					<SourceControlColumn
						busy={sourceControl.busy}
						error={sourceControl.error}
						loading={sourceControl.loading}
						onAction={runAction}
						onLoadCommit={loadCommit}
						onOpen={openChange}
						onOpenCommitFile={openCommitFile}
						onRequestDiscard={setPendingDiscard}
						selected={
							activePath && activeScope
								? { path: toRelative(activePath), scope: activeScope }
								: null
						}
						selectedCommitFile={
							activeCommit
								? { sha: activeCommit.sha, path: activeCommit.file.path }
								: null
						}
						sessionPaths={sessionRelativePaths}
						state={sourceControl.state}
					/>
				) : (
					<div className="min-h-0 flex-1 overflow-auto px-1 py-1">
						<div
							className="truncate px-2 pb-1 pt-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground"
							title={workspaceRoot}
						>
							{baseName(workspaceRoot)}
						</div>
						{renderEntries(workspaceRoot, 0)}
					</div>
				)}
			</div>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
					<div
						className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
						ref={tabStripRef}
					>
						{tabs.map((tab) => {
							const isActive = tab.id === activeId;
							const dirty =
								!tab.commit &&
								(changesByPath.has(tab.path) || diffsByPath.has(tab.path));
							return (
								<div
									className={cn(
										"group relative flex shrink-0 items-center gap-1.5 border-r border-border pl-3 pr-1.5 text-xs text-muted-foreground hover:text-foreground",
										isActive &&
											"bg-background text-foreground shadow-[inset_0_1px_0_var(--primary)]",
									)}
									data-tab-id={tab.id}
									key={tab.id}
								>
									{/* The pseudo-element stretches the hit area over the whole
									    tab; the close button sits above it. */}
									<button
										className="flex items-center gap-1.5 after:absolute after:inset-0 after:content-['']"
										onClick={() => setActiveId(tab.id)}
										title={
											tab.commit
												? `${tab.path} at ${tab.commit.shortSha}`
												: tab.path
										}
										type="button"
									>
										<FileIcon className="size-3" path={tab.path} />
										<span className="max-w-40 truncate">
											{baseName(tab.path)}
										</span>
										{tab.commit ? (
											<span className="font-mono text-[10px] text-muted-foreground">
												{tab.commit.shortSha.slice(0, 7)}
											</span>
										) : null}
										{dirty ? (
											<span className="size-1.5 shrink-0 rounded-full bg-primary" />
										) : null}
									</button>
									<button
										aria-label={`Close ${baseName(tab.path)}`}
										className={cn(
											"relative z-10 rounded p-0.5 opacity-0 hover:bg-surface-hover group-hover:opacity-100 focus-visible:opacity-100",
											isActive && "opacity-100",
										)}
										onClick={() => closeTab(tab.id)}
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
				{activePath && activeTab ? (
					<>
						<div className="flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-border/60 px-3 text-[11px] text-muted-foreground">
							<span className="min-w-0 truncate font-mono" title={activePath}>
								{relativeTo(workspaceRoot, activePath)}
							</span>
							{activeStat ? (
								<span className="shrink-0 font-mono">
									<span className="text-chart-2">+{activeStat.additions}</span>{" "}
									<span className="text-destructive">
										-{activeStat.deletions}
									</span>
								</span>
							) : null}
							{activeScope === "staged" ? (
								<span className="shrink-0 rounded bg-secondary px-1.5 py-px text-[10px]">
									staged
								</span>
							) : null}
							{activeCommit ? (
								<span className="shrink-0 rounded bg-secondary px-1.5 py-px font-mono text-[10px]">
									{activeCommit.shortSha.slice(0, 7)}
								</span>
							) : null}
							<span className="ml-auto flex shrink-0 items-center gap-1">
								{activeScope === "worktree" && activeChange?.worktree ? (
									<>
										<Button
											aria-label="Discard changes"
											className="h-6 gap-1 px-1.5 text-[10.5px]"
											disabled={sourceControl.busy}
											onClick={() =>
												activeChange.worktree &&
												setPendingDiscard([activeChange.worktree])
											}
											size="sm"
											type="button"
											variant="ghost"
										>
											<Undo2 className="size-3" /> Discard
										</Button>
										<Button
											aria-label="Stage file"
											className="h-6 gap-1 px-1.5 text-[10.5px]"
											disabled={sourceControl.busy}
											onClick={() =>
												activeChange.worktree &&
												void runAction({
													type: "stage",
													paths: [activeChange.worktree.path],
												})
											}
											size="sm"
											type="button"
											variant="ghost"
										>
											<Plus className="size-3" /> Stage
										</Button>
									</>
								) : activeScope === "staged" && activeChange?.staged ? (
									<Button
										aria-label="Unstage file"
										className="h-6 gap-1 px-1.5 text-[10.5px]"
										disabled={sourceControl.busy}
										onClick={() =>
											activeChange.staged &&
											void runAction({
												type: "unstage",
												paths: unstagePaths([activeChange.staged]),
											})
										}
										size="sm"
										type="button"
										variant="ghost"
									>
										<Minus className="size-3" /> Unstage
									</Button>
								) : null}
								{canDiff && !activeCommit ? (
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
												onClick={() => setTabMode(activeTab.id, item)}
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
							{effectiveMode === "diff" && (activeScope || activeCommit) ? (
								!activeGitDiff ||
								(activeGitDiff.loading &&
									activeGitDiff.newText === undefined) ? (
									<Spinner />
								) : activeGitDiff.error ? (
									<ErrorText>{activeGitDiff.error}</ErrorText>
								) : activeGitDiff.binary ? (
									<Centered>Binary file</Centered>
								) : activeGitDiff.truncated ? (
									<Centered className="p-6 text-center">
										This file is larger than 1 MB; open it in your editor to
										review the change.
									</Centered>
								) : (
									<CodeDiff
										newText={activeGitDiff.newText ?? ""}
										oldText={activeGitDiff.oldText}
										path={activePath}
									/>
								)
							) : effectiveMode === "diff" && activeSessionDiff ? (
								<div className="flex flex-col gap-2">
									{activeSessionDiff.hunks.map((hunk, index) => {
										const isCompleteNewContents =
											hunk.old.length === 0 &&
											hunk.oldStart === 1 &&
											hunk.newStart === 1;
										return (
											<CodeDiff
												fragment={!isCompleteNewContents}
												// biome-ignore lint/suspicious/noArrayIndexKey: hunks never reorder within a file
												key={`${activePath}-${index}-${hunk.oldStart}-${hunk.newStart}`}
												newText={hunk.new}
												oldText={isCompleteNewContents ? undefined : hunk.old}
												path={activePath}
											/>
										);
									})}
								</div>
							) : !activeFileState ||
								(activeFileState.loading &&
									activeFileState.content === undefined) ? (
								<Spinner />
							) : activeFileState.error ? (
								<ErrorText>{activeFileState.error}</ErrorText>
							) : activeFileState.content === null ? (
								<Centered>Binary file</Centered>
							) : (
								<>
									<CodeFile
										contents={activeFileState.content ?? ""}
										path={activePath}
									/>
									{activeFileState.truncated ? (
										<div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
											File truncated to the first 1 MB.
										</div>
									) : null}
								</>
							)}
						</div>
					</>
				) : (
					<Centered className="p-6 text-center">
						{view === "source-control"
							? "Select a change to review it"
							: "Select a file to view it"}
					</Centered>
				)}
			</div>
			<AlertDialog
				onOpenChange={(open) => {
					if (!open) setPendingDiscard([]);
				}}
				open={pendingDiscard.length > 0}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{pendingDiscard.length === 1
								? `Discard changes to ${baseName(pendingDiscard[0]?.path ?? "")}?`
								: `Discard changes to ${pendingDiscard.length} files?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{pendingDiscard.some((file) => file.status === "?")
								? "Modified files revert to their last committed contents and untracked files are deleted. This cannot be undone."
								: "The files revert to their last committed contents. This cannot be undone."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => void confirmDiscard()}
						>
							Discard
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</WorkspacePanelFrame>
	);
}

function Spinner() {
	return (
		<Centered>
			<Loader2 className="size-4 animate-spin" />
		</Centered>
	);
}

function ErrorText({ children }: { children: React.ReactNode }) {
	return <div className="p-4 text-xs text-destructive">{children}</div>;
}

function Centered({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex h-full flex-1 items-center justify-center text-xs text-muted-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}
