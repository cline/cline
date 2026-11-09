"use client";

import { ChevronDown, FileText, Folder } from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	memo,
	useCallback,
	useEffect,
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
const VIRTUALIZE_AFTER = 200;
const OVERSCAN = 6;

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

interface TreeRow {
	node: FileNode;
	index: number;
	depth: number;
	position: number;
	setSize: number;
	parent: TreeRow | null;
	children: TreeRow[];
}

function indexVisibleTree(nodes: FileNode[], collapsed: ReadonlySet<string>) {
	const rows: TreeRow[] = [];
	const byPath = new Map<string, TreeRow>();
	const visit = (siblings: FileNode[], parent: TreeRow | null): TreeRow[] =>
		siblings.map((node, position) => {
			const row: TreeRow = {
				node,
				index: rows.length,
				depth: parent ? parent.depth + 1 : 0,
				position: position + 1,
				setSize: siblings.length,
				parent,
				children: [],
			};
			rows.push(row);
			byPath.set(node.path, row);
			if (node.children && !collapsed.has(node.path)) {
				row.children = visit(node.children, row);
			}
			return row;
		});
	const roots = visit(nodes, null);
	return { rows, roots, byPath };
}

// Keep ancestors in the DOM so windowing never turns nested lists into a flat list.
function windowTree(
	rows: TreeRow[],
	start: number,
	end: number,
	focused?: TreeRow,
) {
	const included = new Map<number, TreeRow>();
	const include = (row: TreeRow | null) => {
		while (row && !included.has(row.index)) {
			included.set(row.index, { ...row, children: [] });
			row = row.parent;
		}
	};
	for (let index = start; index < end; index += 1) include(rows[index] ?? null);
	// Native Tab entry from outside must still reach the logical first/last row.
	include(rows[0] ?? null);
	include(rows.at(-1) ?? null);
	if (focused) include(focused);
	const roots: TreeRow[] = [];
	for (const row of [...included.values()].sort((a, b) => a.index - b.index)) {
		const parent = row.parent && included.get(row.parent.index);
		if (parent) parent.children.push(row);
		else roots.push(row);
	}
	return roots;
}

function TreeList({
	rows,
	selectedPath,
	onSelect,
	collapsed,
	onToggle,
	rowHeight,
	parentIndex = 0,
}: {
	rows: TreeRow[];
	selectedPath?: string | null;
	onSelect: (path: string) => void;
	collapsed: ReadonlySet<string>;
	onToggle: (path: string) => void;
	rowHeight?: number;
	parentIndex?: number;
}) {
	return (
		<ul className="cline-ui-file-browser__tree">
			{rows.map((row) => {
				const { node } = row;
				const expanded = !collapsed.has(node.path);
				const Icon = node.children ? Folder : FileText;
				return (
					<li
						key={node.path}
						aria-posinset={rowHeight ? row.position : undefined}
						aria-setsize={rowHeight ? row.setSize : undefined}
						style={
							rowHeight
								? { insetBlockStart: (row.index - parentIndex) * rowHeight }
								: undefined
						}
					>
						<ButtonControl
							aria-current={selectedPath === node.path ? "page" : undefined}
							aria-expanded={node.children ? expanded : undefined}
							className={entryClassName}
							data-file-path={node.path}
							onClick={() =>
								node.children ? onToggle(node.path) : onSelect(node.path)
							}
							style={{ "--cline-ui-file-depth": row.depth } as CSSProperties}
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
						{row.children.length > 0 ? (
							<TreeList
								rows={row.children}
								collapsed={collapsed}
								onToggle={onToggle}
								onSelect={onSelect}
								selectedPath={selectedPath}
								rowHeight={rowHeight}
								parentIndex={row.index}
							/>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

export const FileBrowserTree = memo(function FileBrowserTree({
	files,
	selectedPath,
	onSelect,
	label,
	id,
}: {
	files: readonly FileBrowserFile[];
	selectedPath?: string | null;
	onSelect: (path: string) => void;
	label: string;
	id: string;
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
	const tree = useMemo(
		() => indexVisibleTree(nodes, collapsed),
		[nodes, collapsed],
	);
	const virtual = tree.rows.length > VIRTUALIZE_AFTER;
	const viewportRef = useRef<HTMLElement>(null);
	const metrics = useRef({ rowHeight: 32, padding: 8 });
	const [viewportWindow, setViewportWindow] = useState({
		start: 0,
		end: 32,
		rowHeight: 32,
	});
	const [focusedPath, setFocusedPath] = useState<string | null>(null);
	const focused = useRef<{ path: string; index: number } | null>(null);
	const pendingFocus = useRef<string | null>(null);
	const selected = useRef<string | null | undefined>(undefined);
	const focusedRow = focusedPath ? tree.byPath.get(focusedPath) : undefined;
	const start = Math.min(
		viewportWindow.start,
		Math.max(0, tree.rows.length - (viewportWindow.end - viewportWindow.start)),
	);
	const end = Math.min(
		tree.rows.length,
		start + viewportWindow.end - viewportWindow.start,
	);
	const rendered = useMemo(
		() =>
			virtual ? windowTree(tree.rows, start, end, focusedRow) : tree.roots,
		[virtual, tree, start, end, focusedRow],
	);

	const updateWindow = useCallback(() => {
		const viewport = viewportRef.current;
		if (!virtual || !viewport) return;
		const { rowHeight, padding } = metrics.current;
		const top = Math.max(0, viewport.scrollTop - padding);
		const height = viewport.clientHeight || 640;
		const count = Math.ceil(height / rowHeight) + OVERSCAN * 2;
		const start = Math.min(
			Math.max(0, tree.rows.length - count),
			Math.max(0, Math.floor(top / rowHeight) - OVERSCAN),
		);
		const end = Math.min(tree.rows.length, start + count);
		setViewportWindow((current) =>
			current.start === start &&
			current.end === end &&
			current.rowHeight === rowHeight
				? current
				: { start, end, rowHeight },
		);
	}, [virtual, tree.rows.length]);

	const findButton = (path: string) =>
		[
			...(viewportRef.current?.querySelectorAll<HTMLButtonElement>(
				"button[data-file-path]",
			) ?? []),
		].find((button) => button.dataset.filePath === path);
	const reveal = (row: TreeRow) => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const { rowHeight, padding } = metrics.current;
		const button = !virtual && findButton(row.node.path);
		const top = button
			? button.getBoundingClientRect().top -
				viewport.getBoundingClientRect().top +
				viewport.scrollTop
			: row.index * rowHeight + padding;
		const bottom =
			top + (button ? button.getBoundingClientRect().height : rowHeight);
		if (top < viewport.scrollTop) viewport.scrollTop = top;
		else if (bottom > viewport.scrollTop + viewport.clientHeight)
			viewport.scrollTop = bottom - viewport.clientHeight;
		updateWindow();
	};
	const focusRow = (row: TreeRow) => {
		pendingFocus.current = row.node.path;
		setFocusedPath(row.node.path);
		reveal(row);
	};

	useBrowserLayoutEffect(() => {
		if (!virtual) return;
		const viewport = viewportRef.current;
		const button = viewport?.querySelector<HTMLButtonElement>(
			"button[data-file-path]",
		);
		if (!viewport || !button) return;
		const measure = () => {
			const gap = Number.parseFloat(getComputedStyle(viewport).rowGap) || 0;
			const rowHeight = button.getBoundingClientRect().height + gap;
			if (rowHeight > gap) metrics.current.rowHeight = rowHeight;
			metrics.current.padding =
				Number.parseFloat(getComputedStyle(viewport).paddingTop) || 0;
			updateWindow();
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		observer.observe(button);
		return () => observer.disconnect();
	}, [virtual, updateWindow, rendered[0]?.node.path]);

	useBrowserLayoutEffect(() => {
		// The spacer must reflect measured rows before revealing a distant target;
		// otherwise the browser clamps scrolling to the previous, shorter height.
		if (virtual && viewportWindow.rowHeight !== metrics.current.rowHeight)
			return;
		if (selected.current !== selectedPath) {
			selected.current = selectedPath;
			const row = selectedPath ? tree.byPath.get(selectedPath) : undefined;
			if (row && virtual) reveal(row);
		}
		const current = focused.current;
		const currentRow = current && tree.byPath.get(current.path);
		if (currentRow && current) current.index = currentRow.index;
		else if (current) {
			let ancestor = current.path;
			let fallback: TreeRow | undefined;
			while (ancestor.includes("/") && !fallback) {
				ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
				fallback = tree.byPath.get(ancestor);
			}
			fallback ??= tree.rows[Math.min(current.index, tree.rows.length - 1)];
			if (fallback) {
				focused.current = { path: fallback.node.path, index: fallback.index };
				focusRow(fallback);
			} else {
				focused.current = null;
				pendingFocus.current = null;
				setFocusedPath(null);
			}
		}
		const path = pendingFocus.current;
		const button = path && findButton(path);
		if (button) {
			pendingFocus.current = null;
			button.focus({ preventScroll: true });
		}
	});

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (
			!virtual ||
			event.key !== "Tab" ||
			event.defaultPrevented ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey
		)
			return;
		const target = event.target as HTMLElement;
		const path = target.closest<HTMLButtonElement>("button[data-file-path]")
			?.dataset.filePath;
		const current = path && tree.byPath.get(path);
		if (!current) return;
		const next = tree.rows[current.index + (event.shiftKey ? -1 : 1)];
		if (!next) return;
		event.preventDefault();
		focusRow(next);
	};

	return (
		<nav
			aria-label={label}
			className="cline-ui-file-browser__navigation"
			id={id}
			ref={viewportRef}
			onScroll={updateWindow}
			onKeyDown={onKeyDown}
			onFocusCapture={(event) => {
				const path = (event.target as HTMLElement).closest<HTMLButtonElement>(
					"button[data-file-path]",
				)?.dataset.filePath;
				const row = path && tree.byPath.get(path);
				if (row) {
					focused.current = { path: row.node.path, index: row.index };
					setFocusedPath(row.node.path);
				}
			}}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					focused.current = null;
					pendingFocus.current = null;
					setFocusedPath(null);
				}
			}}
		>
			<div
				className={virtual ? "cline-ui-file-browser__virtual-tree" : undefined}
				style={
					virtual
						? { height: tree.rows.length * viewportWindow.rowHeight }
						: undefined
				}
			>
				<TreeList
					rows={rendered}
					selectedPath={selectedPath}
					onSelect={onSelect}
					collapsed={collapsed}
					onToggle={toggleFolder}
					rowHeight={virtual ? viewportWindow.rowHeight : undefined}
				/>
			</div>
		</nav>
	);
});
