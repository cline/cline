"use client";

import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { File as PierreFile } from "@pierre/diffs/react";
import {
	ChevronDown,
	ChevronRight,
	Cog,
	File,
	FileCode2,
	FileJson,
	FileText,
	Folder,
	FolderOpen,
	Image as ImageIcon,
	Palette,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
	type AgentTouch,
	buildTree,
	CONTENTS,
	dirActivity,
	type GitStatus,
	type MockFile,
	type TreeNode,
} from "./mock-data";
import { ClineMark } from "./shell";

export function FileIcon({
	name,
	className,
}: {
	name: string;
	className?: string;
}) {
	const ext = name.includes(".") ? name.split(".").pop() : "";
	const base = cn("size-3.5 shrink-0", className);
	if (ext === "tsx" || ext === "jsx")
		return <FileCode2 className={cn(base, "text-sky-500")} />;
	if (ext === "ts" || ext === "mjs" || ext === "js")
		return <FileCode2 className={cn(base, "text-blue-500")} />;
	if (ext === "json")
		return <FileJson className={cn(base, "text-amber-500")} />;
	if (ext === "md")
		return <FileText className={cn(base, "text-muted-foreground")} />;
	if (ext === "css") return <Palette className={cn(base, "text-violet-500")} />;
	if (ext === "svg" || ext === "ico" || ext === "png")
		return <ImageIcon className={cn(base, "text-emerald-500")} />;
	if (ext === "yml" || name.startsWith("."))
		return <Cog className={cn(base, "text-muted-foreground")} />;
	return <File className={cn(base, "text-muted-foreground")} />;
}

export function GitBadge({ status }: { status?: GitStatus }) {
	if (!status) return null;
	return (
		<span
			className={cn(
				"w-3 shrink-0 text-center font-mono text-[10px] font-semibold",
				status === "M" && "text-amber-500",
				status === "A" && "text-chart-2",
				status === "D" && "text-destructive",
				status === "U" && "text-muted-foreground",
			)}
			title={status === "M" ? "Modified" : status === "A" ? "Added" : status}
		>
			{status}
		</span>
	);
}

export function AgentMark({
	touch,
	className,
}: {
	touch?: AgentTouch;
	className?: string;
}) {
	if (!touch) return null;
	return (
		<ClineMark
			className={cn(
				"size-3",
				touch === "read" ? "text-muted-foreground/50" : "text-primary",
				className,
			)}
		/>
	);
}

export function DiffCount({
	additions,
	deletions,
	className,
}: {
	additions?: number;
	deletions?: number;
	className?: string;
}) {
	if (!additions && !deletions) return null;
	return (
		<span className={cn("shrink-0 font-mono text-[10px]", className)}>
			{additions ? <span className="text-chart-2">+{additions}</span> : null}
			{deletions ? (
				<span className="ml-1 text-destructive">-{deletions}</span>
			) : null}
		</span>
	);
}

type TreeProps = {
	root?: TreeNode;
	expanded?: string[];
	selected?: string;
	hovered?: string;
	showAgent?: boolean;
	showGit?: boolean;
	showDiff?: boolean;
	dense?: boolean;
	className?: string;
	highlightChangedDirs?: boolean;
};

export const DEFAULT_EXPANDED = [
	"src",
	"src/components",
	"src/lib",
	"src/app",
	"tests",
];

export function FileTree({
	root = buildTree(),
	expanded = DEFAULT_EXPANDED,
	selected,
	hovered,
	showAgent = true,
	showGit = true,
	showDiff = false,
	dense = false,
	className,
	highlightChangedDirs = true,
}: TreeProps) {
	const rows: { node: TreeNode; depth: number }[] = [];
	const walk = (node: TreeNode, depth: number) => {
		for (const child of node.children) {
			rows.push({ node: child, depth });
			if (child.kind === "dir" && expanded.includes(child.path)) {
				walk(child, depth + 1);
			}
		}
	};
	walk(root, 0);

	return (
		<div className={cn("flex flex-col py-1 text-[13px]", className)}>
			{rows.map(({ node, depth }) => {
				const isDir = node.kind === "dir";
				const open = isDir && expanded.includes(node.path);
				const changed = isDir ? dirActivity(node).changed : 0;
				const file = node.file as MockFile | undefined;
				const isSelected = selected === node.path;
				return (
					<div
						className={cn(
							"relative mx-1.5 flex items-center gap-1.5 rounded-md pr-2",
							dense ? "h-6" : "h-7",
							isSelected
								? "bg-primary/10 text-foreground ring-1 ring-primary/25 ring-inset"
								: hovered === node.path
									? "bg-surface-hover"
									: "",
						)}
						key={node.path}
						style={{ paddingLeft: 8 + depth * 14 }}
					>
						{Array.from({ length: depth }).map((_, index) => (
							<span
								aria-hidden
								className="absolute top-0 bottom-0 w-px bg-border/70"
								key={index}
								style={{ left: 14 + index * 14 }}
							/>
						))}
						{isDir ? (
							open ? (
								<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
							) : (
								<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
							)
						) : (
							<span className="w-3 shrink-0" />
						)}
						{isDir ? (
							open ? (
								<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
							) : (
								<Folder className="size-3.5 shrink-0 text-muted-foreground" />
							)
						) : (
							<FileIcon name={node.name} />
						)}
						<span
							className={cn(
								"min-w-0 flex-1 truncate",
								file?.git === "M" &&
									showGit &&
									"text-amber-600 dark:text-amber-400",
								file?.git === "A" &&
									showGit &&
									"text-emerald-600 dark:text-emerald-400",
								isDir && "text-foreground/90",
							)}
						>
							{node.name}
						</span>
						{isDir && changed > 0 && highlightChangedDirs && !open ? (
							<span className="size-1.5 shrink-0 rounded-full bg-amber-500/80" />
						) : null}
						{showDiff ? (
							<DiffCount
								additions={file?.additions}
								deletions={file?.deletions}
							/>
						) : null}
						{showAgent ? <AgentMark touch={file?.agent} /> : null}
						{showGit ? <GitBadge status={file?.git} /> : null}
					</div>
				);
			})}
		</div>
	);
}

const codeStyle = (background: string) =>
	({
		"--diffs-font-size": "var(--text-xs, 0.8rem)",
		"--diffs-line-height": "calc(var(--text-xs, 0.8rem) * 1.6)",
		"--diffs-light-bg": background,
		"--diffs-dark-bg": background,
		colorScheme: "inherit",
	}) as CSSProperties;

/**
 * Syntax-highlighted, read-only file view. Mirrors ToolFileDiff's StrictMode
 * remount guard: a half-rendered shadow tree otherwise stays blank.
 */
export function CodeView({
	path,
	contents,
	selected,
	background = "var(--background)",
	className,
}: {
	path: string;
	contents?: string;
	selected?: { start: number; end: number };
	background?: string;
	className?: string;
}) {
	const hostRef = useRef<HTMLSpanElement | null>(null);
	const [attempt, setAttempt] = useState(0);
	const text = contents ?? CONTENTS[path] ?? "";

	useEffect(() => {
		if (attempt >= 3) return;
		const timer = window.setTimeout(() => {
			const container = hostRef.current?.firstElementChild;
			const themed = container?.shadowRoot?.querySelector(
				"style[data-theme-css]",
			);
			if (container && !themed) setAttempt((value) => value + 1);
		}, 400);
		return () => window.clearTimeout(timer);
	}, [attempt]);

	return (
		<span className={className} ref={hostRef} style={{ display: "contents" }}>
			<PierreFile
				file={{ name: path, contents: text }}
				key={attempt}
				options={{ disableFileHeader: true, themeType: "system" }}
				selectedLines={selected ?? null}
				style={codeStyle(background)}
			/>
		</span>
	);
}

export function ChangesView({
	path,
	oldText,
	newText,
}: {
	path: string;
	oldText: string;
	newText: string;
}) {
	return <ToolFileDiff newText={newText} oldText={oldText} path={path} />;
}

export function Breadcrumb({ path }: { path: string }) {
	const parts = path.split("/");
	return (
		<div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
			{parts.map((part, index) => (
				<span className="flex min-w-0 items-center gap-1" key={part + index}>
					{index > 0 ? (
						<ChevronRight className="size-3 shrink-0 opacity-60" />
					) : null}
					{index === parts.length - 1 ? (
						<span className="flex items-center gap-1.5 truncate font-medium text-foreground">
							<FileIcon name={part} />
							{part}
						</span>
					) : (
						<span className="truncate">{part}</span>
					)}
				</span>
			))}
		</div>
	);
}

export function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">
			{children}
		</kbd>
	);
}

export function Pill({
	children,
	tone = "neutral",
	className,
}: {
	children: React.ReactNode;
	tone?: "neutral" | "primary" | "success" | "warning";
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
				tone === "neutral" && "bg-muted text-muted-foreground",
				tone === "primary" && "bg-primary/12 text-primary",
				tone === "success" && "bg-chart-2/15 text-chart-2",
				tone === "warning" &&
					"bg-amber-500/15 text-amber-600 dark:text-amber-400",
				className,
			)}
		>
			{children}
		</span>
	);
}
