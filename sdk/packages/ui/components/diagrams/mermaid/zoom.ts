/**
 * Zoom/pan math for the diagram viewport. Pure and DOM-free; the React glue
 * lives in `viewport.tsx`.
 */

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

export const MIN_DIAGRAM_ZOOM = 0.25;
export const MAX_DIAGRAM_ZOOM = 4;
export const DIAGRAM_ZOOM_STEP = 1.25;

export function clampDiagramZoom(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return clamp(scale, MIN_DIAGRAM_ZOOM, MAX_DIAGRAM_ZOOM);
}

export function stepDiagramZoom(
	scale: number,
	direction: "in" | "out",
): number {
	const next =
		direction === "in" ? scale * DIAGRAM_ZOOM_STEP : scale / DIAGRAM_ZOOM_STEP;
	// Round so repeated in/out returns to 1 instead of drifting.
	return clampDiagramZoom(Math.round(next * 1000) / 1000);
}

export interface DiagramView {
	scale: number;
	x: number;
	y: number;
}

export const INITIAL_DIAGRAM_VIEW: DiagramView = { scale: 1, x: 0, y: 0 };

/**
 * Zooms to `nextScale` keeping the content under `point` (viewport-relative)
 * fixed, for a `translate(x, y) scale(s)` transform with a top-left origin.
 */
export function zoomViewAtPoint(
	view: DiagramView,
	nextScale: number,
	point: { x: number; y: number },
): DiagramView {
	const scale = clampDiagramZoom(nextScale);
	const ratio = scale / view.scale;
	return {
		scale,
		x: point.x - (point.x - view.x) * ratio,
		y: point.y - (point.y - view.y) * ratio,
	};
}

/** Exponential wheel zoom; `deltaY` is clamped so a notched wheel isn't jumpy. */
export function wheelZoomScale(scale: number, deltaY: number): number {
	return scale * Math.exp(-clamp(deltaY, -100, 100) * 0.0025);
}
