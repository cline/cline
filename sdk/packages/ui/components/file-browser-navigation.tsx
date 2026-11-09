"use client";

import { ChevronDown, FileText, Folder } from "lucide-react";
import {
	type CSSProperties,
	memo,
	type PointerEvent,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { buttonVariants } from "./button.js";
import { ButtonControl } from "./button-control.js";
import type { FileBrowserFile } from "./file-browser.js";

const useBrowserLayoutEffect =
	typeof document === "undefined" ? useEffect : useLayoutEffect;

type FileNode = { name: string; path: string; children?: FileNode[] };

function buildFileTree(files: readonly FileBrowserFile[]): FileNode[] {
	const roots: FileNode[] = [];
	const nodesByPath = new Map<string, FileNode>();
	for (const file of files) {
		let siblings = roots;
		let path = "";
		const parts = file.path.split("/");
		parts.forEach((name, index) => {
			path = path ? `${path}/${name}` : name;
			let node = nodesByPath.get(path);
			if (!node) {
				node = {
					name,
					path,
					...(index < parts.length - 1 ? { children: [] } : {}),
				};
				siblings.push(node);
				nodesByPath.set(path, node);
			}
			if (node.children) siblings = node.children;
		});
	}
	const sort = (nodes: FileNode[]) => {
		nodes.sort(
			(a, b) =>
				Number(Boolean(b.children)) - Number(Boolean(a.children)) ||
				a.name.localeCompare(b.name),
		);
		for (const node of nodes) if (node.children) sort(node.children);
	};
	sort(roots);
	return roots;
}

const entryClassName = buttonVariants({
	className: "cline-ui-file-browser__entry",
	size: "xs",
	tone: "neutral",
	variant: "ghost",
});

// Fixed-width rows need neither per-button width observers nor rerenders while resizing.
const FileTree = memo(function FileTreeView({
	nodes,
	selectedPath,
	onSelect,
	collapsed,
	onToggle,
	depth = 0,
}: {
	nodes: FileNode[];
	selectedPath?: string | null;
	onSelect: (path: string) => void;
	collapsed: ReadonlySet<string>;
	onToggle: (path: string) => void;
	depth?: number;
}) {
	return (
		<ul className="cline-ui-file-browser__tree">
			{nodes.map((node) => {
				const expanded = !collapsed.has(node.path);
				const Icon = node.children ? Folder : FileText;
				return (
					<li key={node.path}>
						<ButtonControl
							aria-current={selectedPath === node.path ? "page" : undefined}
							aria-expanded={node.children ? expanded : undefined}
							className={entryClassName}
							onClick={() => {
								if (!node.children) return onSelect(node.path);
								onToggle(node.path);
							}}
							style={{ "--cline-ui-file-depth": depth } as CSSProperties}
							title={node.path}
							type="button"
						>
							<Icon
								aria-hidden="true"
								className="cline-ui-button__icon"
								data-icon="leading"
								focusable="false"
							/>
							<span className="cline-ui-file-browser__name">{node.name}</span>
							{node.children ? (
								<ChevronDown
									aria-hidden="true"
									className="cline-ui-button__icon"
									data-icon="trailing"
									focusable="false"
								/>
							) : null}
						</ButtonControl>
						{node.children && expanded ? (
							<FileTree
								collapsed={collapsed}
								onToggle={onToggle}
								depth={depth + 1}
								nodes={node.children}
								onSelect={onSelect}
								selectedPath={selectedPath}
							/>
						) : null}
					</li>
				);
			})}
		</ul>
	);
});

const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 480;
const MIN_CONTENT_WIDTH = 240;

function maximumSidebarWidth(layoutWidth: number) {
	return Math.max(
		MIN_SIDEBAR_WIDTH,
		Math.min(MAX_SIDEBAR_WIDTH, layoutWidth - MIN_CONTENT_WIDTH),
	);
}

// Share these limits with CSS, including the loading skeleton.
export const fileBrowserLayoutStyle = {
	"--cline-ui-file-sidebar-min": `${MIN_SIDEBAR_WIDTH}px`,
	"--cline-ui-file-sidebar-max": `${MAX_SIDEBAR_WIDTH}px`,
	"--cline-ui-file-content-min": `${MIN_CONTENT_WIDTH}px`,
} as CSSProperties;

export function FileBrowserNavigation({
	files,
	selectedPath,
	onSelect,
	label,
}: {
	files: readonly FileBrowserFile[];
	selectedPath?: string | null;
	onSelect: (path: string) => void;
	label: string;
}) {
	const nodes = useMemo(() => buildFileTree(files), [files]);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const toggleFolder = useCallback((path: string) => {
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);
	const id = useId();
	const sidebarRef = useRef<HTMLDivElement>(null);
	const drag = useRef<{
		pointerId: number;
		startX: number;
		startWidth: number;
		direction: number;
	} | null>(null);
	const [width, setWidth] = useState<number>();
	const [resizing, setResizing] = useState(false);
	const [size, setSize] = useState({ width: 224, max: MAX_SIDEBAR_WIDTH });

	const maximumWidth = () =>
		maximumSidebarWidth(
			sidebarRef.current?.parentElement?.getBoundingClientRect().width ?? 0,
		);
	const resize = (next: number) =>
		setWidth(Math.min(maximumWidth(), Math.max(MIN_SIDEBAR_WIDTH, next)));

	useBrowserLayoutEffect(() => {
		const sidebar = sidebarRef.current;
		const layout = sidebar?.parentElement;
		if (!sidebar || !layout) return;
		const measure = () => {
			const measuredWidth = Math.round(sidebar.getBoundingClientRect().width);
			if (measuredWidth === 0) return;
			const max = maximumSidebarWidth(layout.getBoundingClientRect().width);
			setSize((current) =>
				current.width === measuredWidth && current.max === max
					? current
					: { width: measuredWidth, max },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(sidebar);
		observer.observe(layout);
		return () => observer.disconnect();
	}, []);

	const stopResizing = (event: PointerEvent<HTMLDivElement>) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = null;
		setResizing(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};

	return (
		<div
			className="cline-ui-file-browser__sidebar"
			data-resizing={resizing || undefined}
			ref={sidebarRef}
			style={
				{
					"--cline-ui-file-sidebar-width":
						width === undefined ? undefined : `${width}px`,
				} as CSSProperties
			}
		>
			<nav
				aria-label={label}
				className="cline-ui-file-browser__navigation"
				id={id}
			>
				<FileTree
					collapsed={collapsed}
					onToggle={toggleFolder}
					nodes={nodes}
					onSelect={onSelect}
					selectedPath={selectedPath}
				/>
			</nav>
			{/* biome-ignore lint/a11y/useSemanticElements: This focusable separator adjusts pane width rather than marking a thematic break. */}
			<div
				aria-controls={id}
				aria-label={`Resize ${label}`}
				aria-orientation="vertical"
				aria-valuemin={MIN_SIDEBAR_WIDTH}
				aria-valuemax={size.max}
				aria-valuenow={size.width}
				aria-valuetext={`${size.width} pixels`}
				className="cline-ui-file-browser__resize-handle"
				onDoubleClick={() => setWidth(undefined)}
				onKeyDown={(event) => {
					const sidebar = sidebarRef.current;
					if (!sidebar) return;
					const direction =
						getComputedStyle(sidebar).direction === "rtl" ? -1 : 1;
					const current = sidebar.getBoundingClientRect().width;
					const step = event.shiftKey ? 32 : 10;
					if (event.key === "ArrowLeft") resize(current - step * direction);
					else if (event.key === "ArrowRight")
						resize(current + step * direction);
					else if (event.key === "Home") resize(MIN_SIDEBAR_WIDTH);
					else if (event.key === "End") resize(maximumWidth());
					else return;
					event.preventDefault();
				}}
				onPointerDown={(event) => {
					const sidebar = sidebarRef.current;
					if (event.button !== 0 || !sidebar || drag.current) return;
					event.preventDefault();
					event.currentTarget.focus();
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startWidth: sidebar.getBoundingClientRect().width,
						direction: getComputedStyle(sidebar).direction === "rtl" ? -1 : 1,
					};
					setResizing(true);
				}}
				onPointerMove={(event) => {
					const current = drag.current;
					if (!current || current.pointerId !== event.pointerId) return;
					resize(
						current.startWidth +
							(event.clientX - current.startX) * current.direction,
					);
				}}
				onPointerUp={stopResizing}
				onPointerCancel={stopResizing}
				onLostPointerCapture={stopResizing}
				role="separator"
				tabIndex={0}
				title="Drag to resize sidebar. Double-click to reset."
			/>
		</div>
	);
}
