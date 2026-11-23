"use client";

import type { MermaidConfig } from "mermaid";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CustomRenderer, CustomRendererProps } from "streamdown";
import {
	buildMermaidConfig,
	createMermaidService,
	type DiagramView,
	describeMermaidError,
	diagramFileName,
	INITIAL_DIAGRAM_VIEW,
	type MermaidModuleLoader,
	type MermaidService,
	normalizeDiagramSource,
	resolveDiagramSlug,
	stepDiagramZoom,
	wheelZoomScale,
	zoomViewAtPoint,
} from "./mermaid-diagram.js";
import {
	cleanupMermaidArtifacts,
	downloadBlob,
	downloadText,
	observeThemeChanges,
	type ResolvedMermaidTheme,
	readMermaidTheme,
	svgToPngBlob,
	waitForFonts,
} from "./mermaid-dom.js";

/**
 * Owned Mermaid diagram block for Streamdown (`plugins.renderers`). Replaces
 * Streamdown's built-in block so the header shows the diagram's filename,
 * downloads are PNG + MMD only (SVG is not an attachable image type and
 * renders blank without foreignObject support), PNGs get an opaque themed
 * background, and colors follow the Cline design tokens for light/dark/accent.
 */

type RenderState =
	| { status: "pending" }
	| { background: string; status: "ready"; svg: string }
	| { message: string; status: "error" };

const COPIED_RESET_MS = 1500;
const NOTICE_RESET_MS = 4000;

let cachedConfig: { config: MermaidConfig; key: string } | undefined;

/** One config object per theme so `initialize` only reruns when it changes. */
function themedConfig(theme: ResolvedMermaidTheme): MermaidConfig {
	if (cachedConfig?.key !== theme.key) {
		cachedConfig = {
			config: buildMermaidConfig(theme.tokens, theme.mode, {
				fontFamily: theme.fontFamily,
			}),
			key: theme.key,
		};
	}
	return cachedConfig.config;
}

function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="14"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
			width="14"
			xmlns="http://www.w3.org/2000/svg"
		>
			{children}
		</svg>
	);
}

const ICONS = {
	check: <path d="M20 6 9 17l-5-5" />,
	copy: (
		<>
			<rect height="13" rx="2" width="13" x="9" y="9" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</>
	),
	download: (
		<>
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
			<path d="m7 10 5 5 5-5" />
			<path d="M12 15V3" />
		</>
	),
	enter: (
		<>
			<path d="M15 3h6v6" />
			<path d="M9 21H3v-6" />
			<path d="m21 3-7 7" />
			<path d="m3 21 7-7" />
		</>
	),
	exit: (
		<>
			<path d="m14 10 7-7" />
			<path d="M20 10h-6V4" />
			<path d="m3 21 7-7" />
			<path d="M4 14h6v6" />
		</>
	),
	reset: (
		<>
			<path d="M3 12a9 9 0 1 0 3-6.7" />
			<path d="M3 4v5h5" />
		</>
	),
	zoomIn: (
		<>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
			<path d="M11 8v6" />
			<path d="M8 11h6" />
		</>
	),
	zoomOut: (
		<>
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
			<path d="M8 11h6" />
		</>
	),
} satisfies Record<string, ReactNode>;

function ToolbarButton({
	children,
	disabled,
	label,
	onClick,
	buttonRef,
}: {
	buttonRef?: RefObject<HTMLButtonElement | null>;
	children: ReactNode;
	disabled?: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			aria-label={label}
			className="cline-mermaid__button"
			disabled={disabled}
			onClick={onClick}
			ref={buttonRef}
			title={label}
			type="button"
		>
			{children}
		</button>
	);
}

function DownloadMenu({
	onMmd,
	onPng,
	pngDisabled,
}: {
	onMmd: () => void;
	onPng: () => void;
	pngDisabled: boolean;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	const close = useCallback((restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) triggerRef.current?.focus();
	}, []);

	useEffect(() => {
		if (!open) return;
		rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				rootRef.current?.contains(event.target)
			) {
				return;
			}
			setOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open]);

	const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key === "Escape") {
			// Keep an enclosing fullscreen dialog open.
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const items = [
			...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
		].filter((item) => !item.hasAttribute("disabled"));
		if (items.length === 0) return;
		const active = document.activeElement;
		const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
		const step = event.key === "ArrowDown" ? 1 : -1;
		items[(index + step + items.length) % items.length]?.focus();
	};

	const choose = (action: () => void) => () => {
		close(true);
		action();
	};

	return (
		<div className="cline-mermaid__menu-root" ref={rootRef}>
			<button
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label="Download diagram"
				className="cline-mermaid__button"
				onClick={() => setOpen((current) => !current)}
				ref={triggerRef}
				title="Download diagram"
				type="button"
			>
				<Icon>{ICONS.download}</Icon>
			</button>
			{open ? (
				<div
					aria-label="Download diagram"
					className="cline-mermaid__menu"
					onKeyDown={onMenuKeyDown}
					role="menu"
					tabIndex={-1}
				>
					<button
						className="cline-mermaid__menu-item"
						disabled={pngDisabled}
						onClick={choose(onPng)}
						role="menuitem"
						type="button"
					>
						PNG image
					</button>
					<button
						className="cline-mermaid__menu-item"
						onClick={choose(onMmd)}
						role="menuitem"
						type="button"
					>
						Mermaid source (.mmd)
					</button>
				</div>
			) : null}
		</div>
	);
}

interface DiagramViewOptions {
	/** Fullscreen: plain wheel zooms and drag always pans. */
	interactive: boolean;
}

function useDiagramView({ interactive }: DiagramViewOptions) {
	const [view, setView] = useState<DiagramView>(INITIAL_DIAGRAM_VIEW);
	// State-backed ref: the viewport mounts only once the SVG is ready.
	const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
	const drag = useRef<{
		originX: number;
		originY: number;
		pointerId: number;
		startX: number;
		startY: number;
	} | null>(null);

	const zoomBy = useCallback(
		(direction: "in" | "out") => {
			const rect = viewport?.getBoundingClientRect();
			const center = rect
				? { x: rect.width / 2, y: rect.height / 2 }
				: { x: 0, y: 0 };
			setView((current) => {
				const next = zoomViewAtPoint(
					current,
					stepDiagramZoom(current.scale, direction),
					center,
				);
				return next.scale === 1 ? INITIAL_DIAGRAM_VIEW : next;
			});
		},
		[viewport],
	);
	const reset = useCallback(() => setView(INITIAL_DIAGRAM_VIEW), []);

	// Native listener: React's onWheel is passive and cannot preventDefault.
	useEffect(() => {
		if (!viewport) return;
		const onWheel = (event: WheelEvent) => {
			// Inline, a plain wheel keeps scrolling the chat; pinch (ctrlKey) and
			// cmd/ctrl+wheel zoom instead.
			if (!interactive && !event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const rect = viewport.getBoundingClientRect();
			const point = {
				x: event.clientX - rect.left,
				y: event.clientY - rect.top,
			};
			setView((current) =>
				zoomViewAtPoint(
					current,
					wheelZoomScale(current.scale, event.deltaY),
					point,
				),
			);
		};
		viewport.addEventListener("wheel", onWheel, { passive: false });
		return () => viewport.removeEventListener("wheel", onWheel);
	}, [viewport, interactive]);

	const canPan = interactive || view.scale !== 1;

	const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!canPan || event.button !== 0) return;
		drag.current = {
			originX: view.x,
			originY: view.y,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};
	const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		const active = drag.current;
		if (!active || active.pointerId !== event.pointerId) return;
		const x = active.originX + event.clientX - active.startX;
		const y = active.originY + event.clientY - active.startY;
		setView((current) => ({ ...current, x, y }));
	};
	const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = null;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
	};

	return {
		canPan,
		pointerHandlers: {
			onPointerCancel: endDrag,
			onPointerDown,
			onPointerMove,
			onPointerUp: endDrag,
		},
		reset,
		setViewport,
		view,
		zoomIn: () => zoomBy("in"),
		zoomOut: () => zoomBy("out"),
	};
}

type DiagramViewApi = ReturnType<typeof useDiagramView>;

function ZoomControls({ api }: { api: DiagramViewApi }) {
	const percent = Math.round(api.view.scale * 100);
	return (
		<>
			<ToolbarButton label="Zoom out" onClick={api.zoomOut}>
				<Icon>{ICONS.zoomOut}</Icon>
			</ToolbarButton>
			<ToolbarButton label="Zoom in" onClick={api.zoomIn}>
				<Icon>{ICONS.zoomIn}</Icon>
			</ToolbarButton>
			<ToolbarButton
				disabled={api.view === INITIAL_DIAGRAM_VIEW}
				label={`Reset zoom (${percent}%)`}
				onClick={api.reset}
			>
				<Icon>{ICONS.reset}</Icon>
			</ToolbarButton>
		</>
	);
}

function DiagramViewport({
	api,
	label,
	svg,
}: {
	api: DiagramViewApi;
	label: string;
	svg: string;
}) {
	return (
		<div
			className="cline-mermaid__viewport"
			data-pannable={api.canPan || undefined}
			ref={api.setViewport}
			{...api.pointerHandlers}
		>
			<div
				aria-label={label}
				className="cline-mermaid__canvas"
				// Mermaid runs with securityLevel "strict", which sanitizes the SVG.
				// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized Mermaid SVG output.
				dangerouslySetInnerHTML={{ __html: svg }}
				role="img"
				style={{
					transform: `translate(${api.view.x}px, ${api.view.y}px) scale(${api.view.scale})`,
				}}
			/>
		</div>
	);
}

function FullscreenDialog({
	filename,
	label,
	onClose,
	svg,
}: {
	filename: string;
	label: string;
	onClose: () => void;
	svg: string;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const api = useDiagramView({ interactive: true });

	// A modal <dialog> renders in the top layer, so no ancestor's overflow,
	// transform or containment can clip or mis-position it; it also traps
	// focus and closes on Escape natively. jsdom lacks showModal, hence the
	// attribute fallback (plus an explicit Escape handler below).
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (typeof dialog.showModal === "function") {
			if (!dialog.open) dialog.showModal();
		} else {
			dialog.setAttribute("open", "");
		}
		return () => {
			if (typeof dialog.close === "function" && dialog.open) dialog.close();
		};
	}, []);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
		if (event.key !== "Escape" || event.defaultPrevented) return;
		event.preventDefault();
		onClose();
	};

	return (
		<dialog
			aria-label={`${filename} (fullscreen)`}
			className="cline-mermaid__dialog"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onKeyDown={onKeyDown}
			ref={dialogRef}
		>
			<div className="cline-mermaid__header">
				<span className="cline-mermaid__filename">{filename}</span>
				<div
					aria-label="Diagram actions"
					className="cline-mermaid__actions"
					role="toolbar"
				>
					<ZoomControls api={api} />
					<ToolbarButton label="Exit fullscreen" onClick={onClose}>
						<Icon>{ICONS.exit}</Icon>
					</ToolbarButton>
				</div>
			</div>
			<DiagramViewport api={api} label={label} svg={svg} />
		</dialog>
	);
}

function useMermaidTheme(
	elementRef: RefObject<HTMLElement | null>,
): ResolvedMermaidTheme | undefined {
	const [theme, setTheme] = useState<ResolvedMermaidTheme>();
	useEffect(() => {
		const update = () => {
			const next = readMermaidTheme(elementRef.current ?? undefined);
			setTheme((current) => (current?.key === next.key ? current : next));
		};
		update();
		return observeThemeChanges(update);
	}, [elementRef]);
	return theme;
}

function useTimedFlag(): [boolean, () => void] {
	const [active, setActive] = useState(false);
	useEffect(() => {
		if (!active) return;
		const timer = setTimeout(() => setActive(false), COPIED_RESET_MS);
		return () => clearTimeout(timer);
	}, [active]);
	return [active, () => setActive(true)];
}

export interface MermaidBlockProps extends CustomRendererProps {
	service: MermaidService;
}

export function MermaidBlock({
	code,
	isIncomplete,
	meta,
	service,
}: MermaidBlockProps) {
	const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");
	const renderCount = useRef(0);
	const figureRef = useRef<HTMLElement>(null);
	const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);
	const theme = useMermaidTheme(figureRef);
	const [state, setState] = useState<RenderState>({ status: "pending" });
	const [retryCount, setRetryCount] = useState(0);
	const [fullscreen, setFullscreen] = useState(false);
	const [copied, markCopied] = useTimedFlag();
	const [notice, setNotice] = useState<string | null>(null);
	const api = useDiagramView({ interactive: false });

	const slug = useMemo(
		() => resolveDiagramSlug({ meta, source: code }),
		[meta, code],
	);
	const sourceName = diagramFileName(slug, "mmd");

	// Render only once the fence is closed: partial sources either fail to parse
	// or draw a misleading half-diagram. Until then (and while re-rendering after
	// a theme/source change) the last good SVG or a skeleton stays on screen.
	useEffect(() => {
		if (isIncomplete || !theme) return;
		let cancelled = false;
		renderCount.current += 1;
		const id = `cline-mermaid-${instanceId}-${retryCount}-${renderCount.current}`;
		void (async () => {
			try {
				await waitForFonts();
				const { svg } = await service.render(id, code, themedConfig(theme));
				if (!cancelled) {
					setState({
						background: theme.tokens.background,
						status: "ready",
						svg,
					});
				}
			} catch (error) {
				if (!cancelled) {
					setState({ message: describeMermaidError(error), status: "error" });
				}
			} finally {
				cleanupMermaidArtifacts(id);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [code, instanceId, isIncomplete, retryCount, service, theme]);

	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), NOTICE_RESET_MS);
		return () => clearTimeout(timer);
	}, [notice]);

	const copySource = async () => {
		try {
			await navigator.clipboard.writeText(normalizeDiagramSource(code));
			markCopied();
		} catch {
			setNotice("Couldn't copy the diagram source.");
		}
	};

	const downloadMmd = () => {
		try {
			downloadText(normalizeDiagramSource(code), sourceName);
		} catch {
			setNotice("Couldn't save the diagram source.");
		}
	};

	const downloadPng = async () => {
		if (state.status !== "ready") return;
		try {
			const blob = await svgToPngBlob(state.svg, state.background);
			downloadBlob(blob, diagramFileName(slug, "png"));
		} catch {
			setNotice("Couldn't export the PNG. Download the .mmd source instead.");
		}
	};

	const closeFullscreen = useCallback(() => {
		setFullscreen(false);
		fullscreenTriggerRef.current?.focus();
	}, []);

	const ready = state.status === "ready";
	const label = `Mermaid diagram: ${slug}`;

	return (
		<figure
			className="cline-mermaid"
			data-cline-mermaid={state.status}
			data-streamdown="mermaid-block"
			ref={figureRef}
		>
			<figcaption className="cline-mermaid__header">
				<span className="cline-mermaid__filename" title={sourceName}>
					{sourceName}
				</span>
				<div
					aria-label="Diagram actions"
					className="cline-mermaid__actions"
					role="toolbar"
				>
					{ready ? <ZoomControls api={api} /> : null}
					<ToolbarButton
						label={copied ? "Copied" : "Copy diagram source"}
						onClick={() => void copySource()}
					>
						<Icon>{copied ? ICONS.check : ICONS.copy}</Icon>
					</ToolbarButton>
					<DownloadMenu
						onMmd={downloadMmd}
						onPng={() => void downloadPng()}
						pngDisabled={!ready}
					/>
					<ToolbarButton
						buttonRef={fullscreenTriggerRef}
						disabled={!ready}
						label="View fullscreen"
						onClick={() => setFullscreen(true)}
					>
						<Icon>{ICONS.enter}</Icon>
					</ToolbarButton>
				</div>
			</figcaption>
			{state.status === "ready" ? (
				<DiagramViewport api={api} label={label} svg={state.svg} />
			) : null}
			{state.status === "pending" ? (
				<output aria-busy="true" className="cline-mermaid__skeleton">
					<span aria-hidden="true" className="cline-mermaid__spinner" />
					{isIncomplete ? "Drawing diagram…" : "Rendering diagram…"}
				</output>
			) : null}
			{state.status === "error" ? (
				<div className="cline-mermaid__error" role="alert">
					<p>Mermaid Error: {state.message}</p>
					<pre>
						<code>{code}</code>
					</pre>
					<button
						className="cline-mermaid__retry"
						onClick={() => {
							setState({ status: "pending" });
							setRetryCount((count) => count + 1);
						}}
						type="button"
					>
						Retry
					</button>
				</div>
			) : null}
			{notice ? (
				<output className="cline-mermaid__notice">{notice}</output>
			) : null}
			{fullscreen && state.status === "ready" ? (
				<FullscreenDialog
					filename={sourceName}
					label={label}
					onClose={closeFullscreen}
					svg={state.svg}
				/>
			) : null}
		</figure>
	);
}

/**
 * Streamdown custom renderer for ```mermaid fences. Register with
 * `plugins={{ renderers: [createMermaidRenderer()] }}`; Streamdown checks custom
 * renderers before its built-in Mermaid block, so no `mermaid` plugin is
 * needed. Create it once (module scope) so the component identity is stable.
 */
export function createMermaidRenderer(
	loader?: MermaidModuleLoader,
): CustomRenderer {
	const service = createMermaidService(loader);
	function MermaidRenderer(props: CustomRendererProps) {
		return <MermaidBlock {...props} service={service} />;
	}
	return { component: MermaidRenderer, language: "mermaid" };
}
