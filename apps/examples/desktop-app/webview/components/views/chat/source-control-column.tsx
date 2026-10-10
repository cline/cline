"use client";

import {
	ArrowDown,
	ArrowUp,
	Check,
	ChevronDown,
	ChevronRight,
	File,
	GitBranch,
	Loader2,
	Minus,
	Plus,
	Undo2,
} from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	type SourceControlAction,
	type SourceControlFile,
	type SourceControlState,
	unstagePaths,
} from "@/hooks/use-source-control";
import { cn } from "@/lib/utils";

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
}: SourceControlColumnProps) {
	const [message, setMessage] = useState("");
	const [stagedOpen, setStagedOpen] = useState(true);
	const [changesOpen, setChangesOpen] = useState(true);
	const [commitsOpen, setCommitsOpen] = useState(true);
	const staged = state?.staged ?? [];
	const changes = [...(state?.unstaged ?? []), ...(state?.untracked ?? [])];
	const canCommit = staged.length > 0 && message.trim().length > 0 && !busy;
	// Pushing publishes a branch without an upstream; otherwise it needs
	// something ahead. Pulling always needs an upstream.
	const canPush =
		!busy &&
		Boolean(state?.root) &&
		(state?.hasUpstream === false
			? state.commits.length > 0
			: (state?.ahead ?? 0) > 0);
	const canPull = !busy && Boolean(state?.root && state.hasUpstream);

	const commit = useCallback(async () => {
		if (!canCommit) return;
		// A rejected hook or missing identity keeps the message for retry.
		if (
			await onAction({ type: "commit", message: message.trim(), push: false })
		) {
			setMessage("");
		}
	}, [canCommit, message, onAction]);

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
			<div className="flex flex-col gap-2 border-b border-border p-2">
				<Textarea
					aria-label="Commit message"
					className="min-h-16 resize-none bg-background text-xs"
					disabled={busy}
					onChange={(event) => setMessage(event.target.value)}
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault();
							void commit();
						}
					}}
					placeholder={
						staged.length > 0
							? "Commit message (⌘↵ to commit)"
							: "Stage changes to commit"
					}
					value={message}
				/>
				<Button
					className="h-7 w-full text-xs"
					disabled={!canCommit}
					onClick={() => void commit()}
					size="sm"
					type="button"
				>
					{busy ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Check className="size-3.5" />
					)}
					Commit
				</Button>
				<div className="grid grid-cols-2 gap-1.5">
					<Button
						aria-label={
							state?.hasUpstream === false ? "Publish branch" : "Push"
						}
						className="h-7 text-xs"
						disabled={!canPush}
						onClick={() => void onAction({ type: "push" })}
						size="sm"
						title={
							state?.hasUpstream === false
								? "Publish this branch to origin"
								: state?.ahead
									? `Push ${state.ahead} commit${state.ahead === 1 ? "" : "s"}`
									: "Nothing to push"
						}
						type="button"
						variant="outline"
					>
						<ArrowUp className="size-3.5" />
						Push
						{state?.ahead ? <CountBadge count={state.ahead} /> : null}
					</Button>
					<Button
						aria-label="Pull"
						className="h-7 text-xs"
						disabled={!canPull}
						onClick={() => void onAction({ type: "pull" })}
						size="sm"
						title={
							state?.hasUpstream
								? state.behind
									? `Pull ${state.behind} commit${state.behind === 1 ? "" : "s"}`
									: "Pull from upstream"
								: "No upstream branch to pull from"
						}
						type="button"
						variant="outline"
					>
						<ArrowDown className="size-3.5" />
						Pull
						{state?.behind ? <CountBadge count={state.behind} /> : null}
					</Button>
				</div>
			</div>
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
							{state.commits.map((commit, index) => (
								<div
									className="flex h-7 items-center gap-2 px-2 text-xs"
									key={commit.sha}
									title={commit.subject}
								>
									{/* Graph gutter: the dot plus the rail connecting it to
									    its neighbours, trimmed at the ends of the list. */}
									<span className="relative flex h-full w-2 shrink-0 items-center justify-center">
										{state.commits.length > 1 ? (
											<span
												aria-hidden
												className={cn(
													"absolute left-1/2 w-px -translate-x-1/2 bg-border",
													index === 0
														? "top-1/2 bottom-0"
														: index === state.commits.length - 1
															? "top-0 bottom-1/2"
															: "inset-y-0",
												)}
											/>
										) : null}
										<span
											title={commit.pushed ? "Pushed" : "Not pushed"}
											className={cn(
												"relative size-2 rounded-full border bg-background",
												commit.pushed
													? "border-muted-foreground/60"
													: "border-primary bg-primary",
											)}
										/>
									</span>
									<span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
										{commit.shortSha}
									</span>
									<span className="min-w-0 flex-1 truncate">
										{commit.subject}
									</span>
									<span className="shrink-0 text-[10.5px] text-muted-foreground">
										{commit.relativeDate}
									</span>
								</div>
							))}
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
			className="flex items-center gap-1 text-[11px] text-muted-foreground"
			title={
				state.hasUpstream
					? `${state.ahead} ahead, ${state.behind} behind upstream`
					: "No upstream branch"
			}
		>
			<GitBranch className="size-3" />
			<span className="max-w-28 truncate">{state.branch ?? "detached"}</span>
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

function CountBadge({ count }: { count: number }) {
	return (
		<span className="rounded bg-foreground/10 px-1 font-mono text-[10px] leading-4">
			{count}
		</span>
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

function ChangeRow({
	file,
	selected,
	session,
	actions,
	onOpen,
}: {
	file: SourceControlFile;
	selected: boolean;
	session: boolean;
	actions: ReactNode;
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
				<File className="size-3.5 shrink-0 text-muted-foreground" />
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
			<span className="hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
				{actions}
			</span>
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
