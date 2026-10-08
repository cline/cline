"use client";

import { Check, Copy, Maximize2 } from "lucide-react";
import type { MermaidConfig } from "mermaid";
import {
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CustomRenderer, CustomRendererProps } from "streamdown";
import { UI_TIMING } from "./diagrams/mermaid/config.js";
import {
	cleanupMermaidArtifacts,
	downloadBlob,
	downloadText,
	observeThemeChanges,
	type ResolvedMermaidTheme,
	readMermaidTheme,
	svgToPngBlob,
	waitForFonts,
} from "./diagrams/mermaid/dom.js";
import { DownloadMenu, ToolbarButton } from "./diagrams/mermaid/toolbar.js";
import {
	DiagramViewport,
	FullscreenDialog,
	useDiagramView,
	ZoomControls,
} from "./diagrams/mermaid/viewport.js";
import {
	buildMermaidConfig,
	createMermaidService,
	describeMermaidError,
	diagramFileName,
	type MermaidModuleLoader,
	type MermaidService,
	normalizeDiagramSource,
	resolveDiagramSlug,
} from "./mermaid-diagram.js";

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
		const timer = setTimeout(() => setActive(false), UI_TIMING.copiedResetMs);
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
		const timer = setTimeout(() => setNotice(null), UI_TIMING.noticeResetMs);
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
						{copied ? (
							<Check aria-hidden size={14} />
						) : (
							<Copy aria-hidden size={14} />
						)}
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
						<Maximize2 aria-hidden size={14} />
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
