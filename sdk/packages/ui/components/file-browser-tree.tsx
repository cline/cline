"use client";

import { ChevronDown, FileText, Folder } from "lucide-react";
import {
	type CSSProperties,
	memo,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { buttonVariants } from "./button.js";
import { ButtonControl } from "./button-control.js";
import type { FileBrowserFile } from "./file-browser.js";

const useBrowserLayoutEffect =
	typeof document === "undefined" ? useEffect : useLayoutEffect;
/** Matches the chevron transition in file-browser.css. */
const FOLD_DURATION = 120;

/** Folders are open unless listed. Closing folders keep their rows until the fold ends. */
type Folds = ReadonlyMap<string, "closing" | "closed">;

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

function TreeList({
	nodes,
	selectedPath,
	onSelect,
	folds,
	onToggle,
	depth = 0,
}: {
	nodes: FileNode[];
	selectedPath?: string | null;
	onSelect: (path: string) => void;
	folds: Folds;
	onToggle: (path: string) => void;
	depth?: number;
}) {
	return (
		<ul className="cline-ui-file-browser__tree">
			{nodes.map((node) => {
				const Icon = node.children ? Folder : FileText;
				return (
					<li
						key={node.path}
						style={{ "--cline-ui-file-depth": depth } as CSSProperties}
					>
						<ButtonControl
							aria-current={selectedPath === node.path ? "page" : undefined}
							aria-expanded={node.children ? !folds.has(node.path) : undefined}
							className={entryClassName}
							data-file-path={node.path}
							pressScale={0.99}
							onClick={() =>
								node.children ? onToggle(node.path) : onSelect(node.path)
							}
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
									className="cline-ui-button__icon cline-ui-file-browser__chevron"
									data-icon="trailing"
									focusable="false"
								/>
							) : null}
						</ButtonControl>
						{node.children && folds.get(node.path) !== "closed" ? (
							<TreeList
								nodes={node.children}
								folds={folds}
								onToggle={onToggle}
								onSelect={onSelect}
								selectedPath={selectedPath}
								depth={depth + 1}
							/>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

// Memoized so dragging the resize handle does not rerender the rows.
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
	const [folds, setFolds] = useState<Folds>(() => new Map());
	const navRef = useRef<HTMLElement>(null);
	const motions = useRef(new Map<string, Animation>());
	const opening = useRef<string | null>(null);

	const setFold = (path: string, fold?: "closing" | "closed") =>
		setFolds((current) => {
			const next = new Map(current);
			if (fold) next.set(path, fold);
			else next.delete(path);
			return next;
		});
	/** Clip a folder's rows open or closed. Returns false when motion is unavailable or unwanted. */
	const animateFold = (path: string, closing: boolean) => {
		// Paths are arbitrary text, so compare them instead of building a selector.
		const list = [
			...(navRef.current?.querySelectorAll<HTMLElement>("[data-file-path]") ??
				[]),
		].find((button) => button.dataset.filePath === path)?.nextElementSibling;
		if (
			!(list instanceof HTMLElement) ||
			!list.animate ||
			!window.matchMedia?.("(prefers-reduced-motion: no-preference)").matches
		)
			return false;
		const height = ["0px", `${list.offsetHeight}px`];
		const motion = list.animate(
			{
				height: closing ? height.reverse() : height,
				overflow: ["clip", "clip"],
			},
			{ duration: FOLD_DURATION, easing: "ease-out", fill: "forwards" },
		);
		motions.current.set(path, motion);
		motion.onfinish = () => {
			motions.current.delete(path);
			// Keep the rows clipped until React has removed them.
			flushSync(() =>
				setFolds((current) =>
					current.get(path) === "closing"
						? new Map(current).set(path, "closed")
						: current,
				),
			);
			motion.cancel();
		};
		return true;
	};
	const toggleFolder = (path: string) => {
		const fold = folds.get(path);
		const motion = motions.current.get(path);
		if (motion) {
			motion.reverse();
			setFold(path, fold ? undefined : "closing");
		} else if (fold) {
			opening.current = path;
			setFold(path);
		} else setFold(path, animateFold(path, true) ? "closing" : "closed");
	};
	// A reopened folder's rows exist only after this commit.
	useBrowserLayoutEffect(() => {
		if (opening.current) animateFold(opening.current, false);
		opening.current = null;
	});

	return (
		<nav
			aria-label={label}
			className="cline-ui-file-browser__navigation"
			id={id}
			ref={navRef}
		>
			<TreeList
				nodes={nodes}
				selectedPath={selectedPath}
				onSelect={onSelect}
				folds={folds}
				onToggle={toggleFolder}
			/>
		</nav>
	);
});
