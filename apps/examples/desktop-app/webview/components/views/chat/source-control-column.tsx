"use client";

import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	ChevronRight,
	GitBranch,
	Loader2,
	Minus,
	Plus,
	Undo2,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import {
	type CommitFile,
	type SourceControlAction,
	type SourceControlCommit,
	type SourceControlFile,
	type SourceControlState,
	unstagePaths,
} from "@/hooks/use-source-control";
import { cn } from "@/lib/utils";
import { FileIcon } from "./file-icons";

export type DiffScope = "staged" | "worktree";

export const SOURCE_CONTROL_STATUS_CLASS: Record<string, string> = {
	M: "text-amber-500",
	A: "text-chart-2",
	"?": "text-chart-2",
	R: "text-sky-500",
	D: "text-destructive",
	U: "text-destructive",
};

export function sourceControlFileName(path: string): string {
	return path.split("/").pop() ?? path;
}

function directoryOf(path: string): string {
	return path.split("/").slice(0, -1).join("/");
}

type SourceControlColumnProps = {
	state: SourceControlState | null;
	loading: boolean;
	error: string | null;
	busy: boolean;
	/** Root-relative paths the current session changed. */
	sessionPaths: Set<string>;
	selected: { path: string; scope: DiffScope } | null;
	onOpen: (file: SourceControlFile, scope: DiffScope) => void;
	/** Resolves true when git accepted the action. */
	onAction: (action: SourceControlAction) => Promise<boolean>;
	/** Discards are destructive; the host confirms before running them. */
	onRequestDiscard: (files: SourceControlFile[]) => void;
	/** Files a commit changed, fetched when the commit is expanded. */
	onLoadCommit: (sha: string) => Promise<CommitFile[]>;
	onOpenCommitFile: (commit: SourceControlCommit, file: CommitFile) => void;
	selectedCommitFile: { sha: string; path: string } | null;
};

type CommitFilesState = {
	files?: CommitFile[];
	loading: boolean;
	error?: string;
};

export function SourceControlColumn({
	state,
	loading,
	error,
	busy,
	sessionPaths,
	selected,
	onOpen,
	onAction,
	onRequestDiscard,
	onLoadCommit,
	onOpenCommitFile,
	selectedCommitFile,
}: SourceControlColumnProps) {
	const [expandedCommits, setExpandedCommits] = useState<Set<string>>(
		() => new Set(),
	);
	const [commitFiles, setCommitFiles] = useState<Map<string, CommitFilesState>>(
		() => new Map(),
	);
	const toggleCommit = useCallback(
		(sha: string) => {
			const opening = !expandedCommits.has(sha);
			setExpandedCommits((current) => {
				const next = new Set(current);
				if (opening) next.add(sha);
				else next.delete(sha);
				return next;
			});
			// A commit's files never change, so a loaded list is reused.
			if (!opening || commitFiles.get(sha)?.files) return;
			setCommitFiles((current) => new Map(current).set(sha, { loading: true }));
			onLoadCommit(sha).then(
				(files) =>
					setCommitFiles((current) =>
						new Map(current).set(sha, { files, loading: false }),
					),
				(caught) =>
					setCommitFiles((current) =>
						new Map(current).set(sha, {
							loading: false,
							error: caught instanceof Error ? caught.message : String(caught),
						}),
					),
			);
		},
		[commitFiles, expandedCommits, onLoadCommit],
	);
	const [stagedOpen, setStagedOpen] = useState(true);
	const [changesOpen, setChangesOpen] = useState(true);
	const [commitsOpen, setCommitsOpen] = useState(true);
	const staged = state?.staged ?? [];
	const changes = [...(state?.unstaged ?? []), ...(state?.untracked ?? [])];

	if (state && !state.root) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-xs text-muted-foreground">
				<GitBranch className="mb-1 size-4" />
				<span className="font-medium text-foreground">
					Not a git repository
				</span>
				<span>Initialize one to track changes here.</span>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col" id="source-control-column">
			{state?.root ? (
				<div className="flex h-8 shrink-0 min-w-0 items-center border-b border-border px-3">
					<BranchIndicator state={state} />
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto px-1 py-1">
				{error ? (
					<div className="px-2 py-1 text-[11px] text-destructive">{error}</div>
				) : null}
				{!state && loading ? (
					<div className="flex items-center gap-2 px-2 py-2 text-[11px] text-muted-foreground">
						<Loader2 className="size-3 animate-spin" /> Reading repository...
					</div>
				) : null}
				{state ? (
					<>
						<Group
							actions={
								staged.length > 0 ? (
									<RowAction
										disabled={busy}
										label="Unstage all"
										onClick={() =>
											void onAction({
												type: "unstage",
												paths: unstagePaths(staged),
											})
										}
									>
										<Minus className="size-3" />
									</RowAction>
								) : null
							}
							count={staged.length}
							label="Staged changes"
							onToggle={() => setStagedOpen((open) => !open)}
							open={stagedOpen}
						>
							{staged.map((file) => (
								<ChangeRow
									actions={
										<RowAction
											disabled={busy}
											label={`Unstage ${file.path}`}
											onClick={() =>
												void onAction({
													type: "unstage",
													paths: unstagePaths([file]),
												})
											}
										>
											<Minus className="size-3" />
										</RowAction>
									}
									file={file}
									key={`staged:${file.path}`}
									onOpen={() => onOpen(file, "staged")}
									selected={
										selected?.scope === "staged" && selected.path === file.path
									}
									session={sessionPaths.has(file.path)}
								/>
							))}
						</Group>
						<Group
							actions={
								changes.length > 0 ? (
									<>
										<RowAction
											disabled={busy}
											label="Discard all changes"
											onClick={() => onRequestDiscard(changes)}
										>
											<Undo2 className="size-3" />
										</RowAction>
										<RowAction
											disabled={busy}
											label="Stage all"
											onClick={() =>
												void onAction({
													type: "stage",
													paths: changes.map((file) => file.path),
												})
											}
										>
											<Plus className="size-3" />
										</RowAction>
									</>
								) : null
							}
							count={changes.length}
							empty={
								staged.length === 0
									? "No changes in the working tree"
									: undefined
							}
							label="Changes"
							onToggle={() => setChangesOpen((open) => !open)}
							open={changesOpen}
						>
							{changes.map((file) => (
								<ChangeRow
									actions={
										<>
											<RowAction
												disabled={busy}
												label={`Discard changes to ${file.path}`}
												onClick={() => onRequestDiscard([file])}
											>
												<Undo2 className="size-3" />
											</RowAction>
											<RowAction
												disabled={busy}
												label={`Stage ${file.path}`}
												onClick={() =>
													void onAction({ type: "stage", paths: [file.path] })
												}
											>
												<Plus className="size-3" />
											</RowAction>
										</>
									}
									file={file}
									key={`worktree:${file.path}`}
									onOpen={() => onOpen(file, "worktree")}
									selected={
										selected?.scope === "worktree" &&
										selected.path === file.path
									}
									session={sessionPaths.has(file.path)}
								/>
							))}
						</Group>
						<Group
							count={state.commits.length}
							empty="No commits yet"
							label="Recent commits"
							onToggle={() => setCommitsOpen((open) => !open)}
							open={commitsOpen}
						>
							{state.commits.map((commit, index) => {
								const expanded = expandedCommits.has(commit.sha);
								const isLast = index === state.commits.length - 1;
								const filesState = commitFiles.get(commit.sha);
								return (
									<div key={commit.sha}>
										<button
											aria-expanded={expanded}
											className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-surface-hover"
											onClick={() => toggleCommit(commit.sha)}
											title={commit.subject}
											type="button"
										>
											<CommitRail
												dot={commit.pushed ? "pushed" : "unpushed"}
												first={index === 0}
												last={isLast && !expanded}
												single={state.commits.length === 1 && !expanded}
											/>
											<span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
												{commit.shortSha}
											</span>
											<span className="min-w-0 flex-1 truncate">
												{commit.subject}
											</span>
											<span className="shrink-0 text-[10.5px] text-muted-foreground">
												{commit.relativeDate}
											</span>
										</button>
										{expanded ? (
											<div>
												{filesState?.loading ? (
													<CommitDetailRow last={isLast}>
														<Loader2 className="size-3 animate-spin" /> Loading
														files...
													</CommitDetailRow>
												) : filesState?.error ? (
													<CommitDetailRow last={isLast}>
														<span className="text-destructive">
															{filesState.error}
														</span>
													</CommitDetailRow>
												) : filesState?.files?.length === 0 ? (
													<CommitDetailRow last={isLast}>
														No file changes
													</CommitDetailRow>
												) : (
													filesState?.files?.map((file) => (
														<button
															className={cn(
																"flex h-7 w-full items-center gap-1.5 rounded-md pl-2 pr-1 text-left text-xs hover:bg-surface-hover",
																selectedCommitFile?.sha === commit.sha &&
																	selectedCommitFile.path === file.path &&
																	"bg-primary/15",
															)}
															key={file.path}
															onClick={() => onOpenCommitFile(commit, file)}
															title={file.path}
															type="button"
														>
															<CommitRail last={isLast} />
															<FileIcon className="ml-2" path={file.path} />
															<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
																<span
																	className={cn(
																		"shrink-0 truncate",
																		SOURCE_CONTROL_STATUS_CLASS[file.status],
																	)}
																>
																	{sourceControlFileName(file.path)}
																</span>
																<span className="min-w-0 truncate text-[10.5px] text-muted-foreground/80">
																	{directoryOf(file.path)}
																</span>
															</span>
															{file.additions !== null ||
															file.deletions !== null ? (
																<span className="shrink-0 font-mono text-[10.5px]">
																	<span className="text-chart-2">
																		+{file.additions ?? 0}
																	</span>{" "}
																	<span className="text-destructive">
																		-{file.deletions ?? 0}
																	</span>
																</span>
															) : null}
															<span
																className={cn(
																	"w-3 shrink-0 text-center font-mono text-[10px] font-medium",
																	SOURCE_CONTROL_STATUS_CLASS[file.status],
																)}
															>
																{file.status}
															</span>
														</button>
													))
												)}
											</div>
										) : null}
									</div>
								);
							})}
						</Group>
					</>
				) : null}
			</div>
		</div>
	);
}

export function BranchIndicator({
	state,
}: {
	state: SourceControlState | null;
}) {
	if (!state?.root) return null;
	return (
		<span
			className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
			title={
				state.hasUpstream
					? `${state.ahead} ahead, ${state.behind} behind upstream`
					: "No upstream branch"
			}
		>
			<GitBranch className="size-3 shrink-0" />
			<span className="min-w-0 truncate">{state.branch ?? "detached"}</span>
			{state.ahead > 0 ? (
				<span className="flex items-center font-mono text-[10px]">
					<ArrowUp className="size-2.5" />
					{state.ahead}
				</span>
			) : null}
			{state.behind > 0 ? (
				<span className="flex items-center font-mono text-[10px]">
					<ArrowDown className="size-2.5" />
					{state.behind}
				</span>
			) : null}
		</span>
	);
}

/**
 * Graph gutter for the commit list: the rail joins consecutive commits and
 * runs through an expanded commit's files, trimmed above the first dot and
 * below the last row.
 */
function CommitRail({
	dot,
	first = false,
	last = false,
	single = false,
}: {
	dot?: "pushed" | "unpushed";
	first?: boolean;
	last?: boolean;
	single?: boolean;
}) {
	const rail = single
		? null
		: dot && first
			? last
				? null
				: "top-1/2 bottom-0"
			: last
				? dot
					? "top-0 bottom-1/2"
					: null
				: "inset-y-0";
	return (
		<span className="relative flex h-full w-2 shrink-0 items-center justify-center">
			{rail ? (
				<span
					aria-hidden
					className={cn(
						"absolute left-1/2 w-px -translate-x-1/2 bg-border",
						rail,
					)}
				/>
			) : null}
			{dot ? (
				<span
					className={cn(
						"relative size-2 rounded-full border bg-background",
						dot === "pushed"
							? "border-muted-foreground/60"
							: "border-primary bg-primary",
					)}
					title={dot === "pushed" ? "Pushed" : "Not pushed"}
				/>
			) : null}
		</span>
	);
}

function CommitDetailRow({
	last,
	children,
}: {
	last: boolean;
	children: ReactNode;
}) {
	return (
		<div className="flex h-7 items-center gap-1.5 px-2 text-[11px] text-muted-foreground">
			<CommitRail last={last} />
			<span className="ml-2 flex items-center gap-1.5">{children}</span>
		</div>
	);
}

function Group({
	label,
	count,
	open,
	onToggle,
	actions,
	empty,
	children,
}: {
	label: string;
	count: number;
	open: boolean;
	onToggle: () => void;
	actions?: ReactNode;
	empty?: string;
	children: ReactNode;
}) {
	return (
		<section>
			<div className="group flex h-7 items-center gap-1.5 px-1 text-[11px] font-medium text-muted-foreground">
				<button
					aria-expanded={open}
					className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left hover:text-foreground"
					onClick={onToggle}
					type="button"
				>
					{open ? (
						<ChevronDown className="size-3 shrink-0" />
					) : (
						<ChevronRight className="size-3 shrink-0" />
					)}
					<span className="uppercase tracking-wide">{label}</span>
					<span className="rounded bg-secondary px-1.5 py-px font-mono text-[10px]">
						{count}
					</span>
				</button>
				<span className="flex items-center gap-0.5">{actions}</span>
			</div>
			{open ? (
				count === 0 && empty ? (
					<div className="px-3 pb-2 pt-0.5 text-[11px] text-muted-foreground/80">
						{empty}
					</div>
				) : (
					children
				)
			) : null}
		</section>
	);
}

function RowAction({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			aria-label={label}
			className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
			disabled={disabled}
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			title={label}
			type="button"
		>
			{children}
		</button>
	);
}

export function ChangeRow({
	file,
	selected,
	session = false,
	actions,
	onOpen,
}: {
	file: Pick<SourceControlFile, "path" | "status" | "additions" | "deletions"> &
		Partial<Pick<SourceControlFile, "originalPath">>;
	selected: boolean;
	session?: boolean;
	actions?: ReactNode;
	onOpen: () => void;
}) {
	const directory = directoryOf(file.path);
	return (
		<div
			className={cn(
				"group flex h-7 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs hover:bg-surface-hover",
				selected && "bg-primary/15",
			)}
		>
			<button
				className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
				onClick={onOpen}
				title={file.path}
				type="button"
			>
				<FileIcon path={file.path} />
				<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
					<span
						className={cn(
							"shrink-0 truncate",
							SOURCE_CONTROL_STATUS_CLASS[file.status],
						)}
					>
						{sourceControlFileName(file.path)}
					</span>
					{file.originalPath ? (
						<span className="min-w-0 truncate text-[10.5px] text-muted-foreground/80">
							← {sourceControlFileName(file.originalPath)}
						</span>
					) : null}
					{directory ? (
						<span className="min-w-0 truncate text-[10.5px] text-muted-foreground/80">
							{directory}
						</span>
					) : null}
				</span>
			</button>
			{actions ? (
				<span className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
					{actions}
				</span>
			) : null}
			{session ? (
				<span
					className="size-1.5 shrink-0 rounded-full bg-primary"
					title="Changed in this session"
				/>
			) : null}
			{file.additions !== null || file.deletions !== null ? (
				<span className="shrink-0 font-mono text-[10.5px]">
					<span className="text-chart-2">+{file.additions ?? 0}</span>{" "}
					<span className="text-destructive">-{file.deletions ?? 0}</span>
				</span>
			) : null}
			<span
				className={cn(
					"w-3 shrink-0 text-center font-mono text-[10px] font-medium",
					SOURCE_CONTROL_STATUS_CLASS[file.status],
				)}
			>
				{file.status}
			</span>
		</div>
	);
}
