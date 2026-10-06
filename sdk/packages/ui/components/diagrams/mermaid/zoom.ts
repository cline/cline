/**
 * Zoom/pan math for the diagram viewport. Pure and DOM-free; the React glue
 * lives in `viewport.tsx`.
 */

import { DIAGRAM_ZOOM } from "./config.js";

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function clampDiagramZoom(scale: number): number {
	if (!Number.isFinite(scale)) return 1;
	return clamp(scale, DIAGRAM_ZOOM.min, DIAGRAM_ZOOM.max);
}

export function stepDiagramZoom(
	scale: number,
	direction: "in" | "out",
): number {
	const next =
		direction === "in" ? scale * DIAGRAM_ZOOM.step : scale / DIAGRAM_ZOOM.step;
	// Rounds away float drift so repeated in/out steps return to exactly 1.
	return clampDiagramZoom(Math.round(next * 1000) / 1000);
}

export interface DiagramView {
	scale: number;
	x: number;
	y: number;
}

export const INITIAL_DIAGRAM_VIEW: DiagramView = { scale: 1, x: 0, y: 0 };

/** Zooms to `nextScale`, keeping the content under `point` (viewport-relative) fixed. */
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

export function wheelZoomScale(scale: number, deltaY: number): number {
	const delta = clamp(
		deltaY,
		-DIAGRAM_ZOOM.wheelMaxDeltaY,
		DIAGRAM_ZOOM.wheelMaxDeltaY,
	);
	return scale * Math.exp(-delta * DIAGRAM_ZOOM.wheelSensitivity);
}
