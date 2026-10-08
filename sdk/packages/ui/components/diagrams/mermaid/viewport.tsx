"use client";

import { Minimize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { ToolbarButton } from "./toolbar.js";
import {
	type DiagramView,
	INITIAL_DIAGRAM_VIEW,
	stepDiagramZoom,
	wheelZoomScale,
	zoomViewAtPoint,
} from "./zoom.js";

/**
 * Zoom/pan viewport for a rendered diagram: the `useDiagramView` hook (wheel
 * zoom, drag pan), the inline canvas, zoom controls and the fullscreen dialog.
 */

interface DiagramViewOptions {
	/** Fullscreen: plain wheel zooms and drag always pans. */
	interactive: boolean;
}

export function useDiagramView({ interactive }: DiagramViewOptions) {
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

export function ZoomControls({ api }: { api: DiagramViewApi }) {
	const percent = Math.round(api.view.scale * 100);
	return (
		<>
			<ToolbarButton label="Zoom out" onClick={api.zoomOut}>
				<ZoomOut aria-hidden size={14} />
			</ToolbarButton>
			<ToolbarButton label="Zoom in" onClick={api.zoomIn}>
				<ZoomIn aria-hidden size={14} />
			</ToolbarButton>
			<ToolbarButton
				disabled={api.view === INITIAL_DIAGRAM_VIEW}
				label={`Reset zoom (${percent}%)`}
				onClick={api.reset}
			>
				<RotateCcw aria-hidden size={14} />
			</ToolbarButton>
		</>
	);
}

export function DiagramViewport({
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

export function FullscreenDialog({
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
						<Minimize2 aria-hidden size={14} />
					</ToolbarButton>
				</div>
			</div>
			<DiagramViewport api={api} label={label} svg={svg} />
		</dialog>
	);
}
