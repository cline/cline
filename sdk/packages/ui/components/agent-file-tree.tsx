"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

export type AgentChangedFileStatus =
	| "added"
	| "modified"
	| "deleted"
	| "renamed";

export interface AgentChangedFileEntry {
	/** Workspace-relative path with forward slashes. */
	path: string;
	status: AgentChangedFileStatus;
	additions: number;
	deletions: number;
}

const STATUS_LETTER: Record<AgentChangedFileStatus, string> = {
	added: "A",
	modified: "M",
	deleted: "D",
	renamed: "R",
};

const STATUS_CLASS: Record<AgentChangedFileStatus, string> = {
	added: "bg-cline-ui-success-surface text-cline-ui-success-text",
	modified: "bg-cline-ui-warning-surface text-cline-ui-warning-text",
	deleted: "bg-cline-ui-error-surface text-cline-ui-error-text",
	renamed: "bg-cline-ui-info-surface text-cline-ui-info-text",
};

export function AgentFileStatusBadge({
	status,
	className = "",
}: {
	status: AgentChangedFileStatus;
	className?: string;
}) {
	return (
		<span
			className={`cline-ui-file-status inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] font-cline-ui-mono text-[10px] font-cline-ui-semibold ${STATUS_CLASS[status]} ${className}`}
			title={status}
		>
			{STATUS_LETTER[status]}
		</span>
	);
}

export function AgentDiffStats({
	additions,
	deletions,
	className = "",
}: {
	additions: number;
	deletions: number;
	className?: string;
}) {
	return (
		<span
			className={`cline-ui-diff-stats inline-flex shrink-0 items-center gap-1.5 font-cline-ui-mono text-[11px] ${className}`}
		>
			<span className="text-cline-ui-success-text">+{additions}</span>
			<span className="text-cline-ui-error-text">-{deletions}</span>
		</span>
	);
}

function splitPath(path: string): { directory: string; name: string } {
	const index = path.lastIndexOf("/");
	return index < 0
		? { directory: "", name: path }
		: { directory: path.slice(0, index), name: path.slice(index + 1) };
}

const ROW_CLASS =
	"cline-ui-file-tree__row flex h-7 w-full min-w-0 items-center gap-1.5 pr-3 text-left text-cline-ui-xs transition-colors hover:bg-cline-ui-surface-hover-lighter focus-visible:outline-none focus-visible:bg-cline-ui-surface-hover-lighter";
const ROW_SELECTED_CLASS =
	"bg-cline-ui-accent text-cline-ui-accent-foreground hover:bg-cline-ui-accent";

export interface AgentChangedFileTreeProps {
	files: readonly AgentChangedFileEntry[];
	selectedPath?: string | null;
	onSelect: (file: AgentChangedFileEntry) => void;
	emptyMessage?: ReactNode;
	className?: string;
}

/**
 * Changed files grouped by directory, one collapsible group per directory.
 * The host owns the selection and the data; this only renders it.
 */
export function AgentChangedFileTree({
	files,
	selectedPath,
	onSelect,
	emptyMessage = "No changes.",
	className = "",
}: AgentChangedFileTreeProps) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const groups = useMemo(() => {
		const byDirectory = new Map<
			string,
			{ entry: AgentChangedFileEntry; name: string }[]
		>();
		for (const entry of files) {
			const { directory, name } = splitPath(entry.path);
			const list = byDirectory.get(directory) ?? [];
			list.push({ entry, name });
			byDirectory.set(directory, list);
		}
		return [...byDirectory.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([directory, entries]) => ({
				directory,
				entries: entries.sort((a, b) => a.name.localeCompare(b.name)),
			}));
	}, [files]);

	if (files.length === 0) {
		return (
			<div
				className={`cline-ui-file-tree__empty flex items-center justify-center px-4 py-10 text-center text-cline-ui-xs text-cline-ui-muted-foreground ${className}`}
			>
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className={`cline-ui-file-tree flex flex-col py-1 ${className}`}>
			{groups.map(({ directory, entries }) => {
				const isCollapsed = collapsed.has(directory);
				const label = directory || "./";
				return (
					<div className="cline-ui-file-tree__group" key={directory}>
						<button
							aria-expanded={!isCollapsed}
							className={`${ROW_CLASS} pl-2 text-cline-ui-muted-foreground`}
							onClick={() =>
								setCollapsed((previous) => {
									const next = new Set(previous);
									if (next.has(directory)) next.delete(directory);
									else next.add(directory);
									return next;
								})
							}
							title={label}
							type="button"
						>
							{isCollapsed ? (
								<ChevronRight className="h-3.5 w-3.5 shrink-0" />
							) : (
								<ChevronDown className="h-3.5 w-3.5 shrink-0" />
							)}
							<span className="min-w-0 truncate font-cline-ui-mono text-[11px]">
								{label}
							</span>
							<span className="ml-auto shrink-0 font-cline-ui-mono text-[10px]">
								{entries.length}
							</span>
						</button>
						{!isCollapsed &&
							entries.map(({ entry, name }) => {
								const selected = entry.path === selectedPath;
								return (
									<button
										aria-current={selected ? "true" : undefined}
										className={`${ROW_CLASS} pl-6 ${selected ? ROW_SELECTED_CLASS : "text-cline-ui-foreground"}`}
										key={entry.path}
										onClick={() => onSelect(entry)}
										title={entry.path}
										type="button"
									>
										<AgentFileStatusBadge status={entry.status} />
										<span className="min-w-0 truncate font-cline-ui-mono text-[11px]">
											{name}
										</span>
										<AgentDiffStats
											additions={entry.additions}
											className="ml-auto"
											deletions={entry.deletions}
										/>
									</button>
								);
							})}
					</div>
				);
			})}
		</div>
	);
}

export interface AgentWorkspaceTreeNode {
	name: string;
	/** Workspace-relative path with forward slashes. */
	path: string;
	kind: "file" | "directory";
}

export interface AgentWorkspaceTreeProps {
	/** Loaded children keyed by directory path; "" is the workspace root. */
	entries: Readonly<Record<string, readonly AgentWorkspaceTreeNode[]>>;
	expanded: ReadonlySet<string>;
	/** Directories whose children are still loading. */
	loading?: ReadonlySet<string>;
	selectedPath?: string | null;
	onToggleDirectory: (path: string) => void;
	onSelectFile: (node: AgentWorkspaceTreeNode) => void;
	emptyMessage?: ReactNode;
	className?: string;
}

/**
 * Lazily loaded workspace file browser. The host fetches a directory's
 * children when it is expanded and hands them back through `entries`.
 */
export function AgentWorkspaceTree({
	entries,
	expanded,
	loading,
	selectedPath,
	onToggleDirectory,
	onSelectFile,
	emptyMessage = "This folder is empty.",
	className = "",
}: AgentWorkspaceTreeProps) {
	const root = entries[""];
	if (root && root.length === 0) {
		return (
			<div
				className={`cline-ui-file-tree__empty flex items-center justify-center px-4 py-10 text-center text-cline-ui-xs text-cline-ui-muted-foreground ${className}`}
			>
				{emptyMessage}
			</div>
		);
	}
	return (
		<div className={`cline-ui-file-tree flex flex-col py-1 ${className}`}>
			<WorkspaceTreeLevel
				depth={0}
				directory=""
				entries={entries}
				expanded={expanded}
				loading={loading}
				onSelectFile={onSelectFile}
				onToggleDirectory={onToggleDirectory}
				selectedPath={selectedPath}
			/>
		</div>
	);
}

function WorkspaceTreeLevel({
	directory,
	depth,
	entries,
	expanded,
	loading,
	selectedPath,
	onToggleDirectory,
	onSelectFile,
}: Omit<AgentWorkspaceTreeProps, "emptyMessage" | "className"> & {
	directory: string;
	depth: number;
}) {
	const children = entries[directory];
	if (!children) {
		return loading?.has(directory) ? (
			<div
				className="flex h-7 items-center gap-1.5 text-cline-ui-xs text-cline-ui-muted-foreground"
				style={{ paddingLeft: `${depth * 12 + 8}px` }}
			>
				<Loader2 className="h-3.5 w-3.5 animate-spin" />
				Loading…
			</div>
		) : null;
	}
	return (
		<>
			{children.map((node) => {
				const isDirectory = node.kind === "directory";
				const isExpanded = isDirectory && expanded.has(node.path);
				const selected = !isDirectory && node.path === selectedPath;
				return (
					<div key={node.path}>
						<button
							aria-current={selected ? "true" : undefined}
							aria-expanded={isDirectory ? isExpanded : undefined}
							className={`${ROW_CLASS} ${selected ? ROW_SELECTED_CLASS : isDirectory ? "text-cline-ui-foreground" : "text-cline-ui-text-2"}`}
							onClick={() =>
								isDirectory ? onToggleDirectory(node.path) : onSelectFile(node)
							}
							style={{ paddingLeft: `${depth * 12 + 8}px` }}
							title={node.path}
							type="button"
						>
							{isDirectory ? (
								isExpanded ? (
									<ChevronDown className="h-3.5 w-3.5 shrink-0 text-cline-ui-muted-foreground" />
								) : (
									<ChevronRight className="h-3.5 w-3.5 shrink-0 text-cline-ui-muted-foreground" />
								)
							) : (
								<span className="h-3.5 w-3.5 shrink-0" />
							)}
							<span className="min-w-0 truncate font-cline-ui-mono text-[11px]">
								{node.name}
							</span>
						</button>
						{isExpanded && (
							<WorkspaceTreeLevel
								depth={depth + 1}
								directory={node.path}
								entries={entries}
								expanded={expanded}
								loading={loading}
								onSelectFile={onSelectFile}
								onToggleDirectory={onToggleDirectory}
								selectedPath={selectedPath}
							/>
						)}
					</div>
				);
			})}
		</>
	);
}

export interface AgentFilePanelHeaderProps {
	path: string;
	status?: AgentChangedFileStatus;
	additions?: number;
	deletions?: number;
	/** Host actions such as open in editor, copy path, or revert. */
	actions?: ReactNode;
	className?: string;
}

/** Sticky header above a file diff or file viewer. */
export function AgentFilePanelHeader({
	path,
	status,
	additions,
	deletions,
	actions,
	className = "",
}: AgentFilePanelHeaderProps) {
	return (
		<div
			className={`cline-ui-file-panel-header flex h-9 shrink-0 items-center gap-2 border-b border-cline-ui-border bg-cline-ui-card/80 px-3 ${className}`}
		>
			{status && <AgentFileStatusBadge status={status} />}
			<span
				className="min-w-0 flex-1 truncate font-cline-ui-mono text-cline-ui-xs text-cline-ui-foreground"
				title={path}
			>
				{path}
			</span>
			{additions !== undefined && deletions !== undefined && (
				<AgentDiffStats additions={additions} deletions={deletions} />
			)}
			{actions && (
				<div className="flex shrink-0 items-center gap-0.5">{actions}</div>
			)}
		</div>
	);
}
