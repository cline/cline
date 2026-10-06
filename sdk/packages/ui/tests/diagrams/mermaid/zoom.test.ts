// Exercises the zoom module (viewport zoom/pan math) of
// `components/diagrams/mermaid/` via the public façade.

import { describe, expect, test } from "vitest";
import {
	clampDiagramZoom,
	INITIAL_DIAGRAM_VIEW,
	MAX_DIAGRAM_ZOOM,
	stepDiagramZoom,
	wheelZoomScale,
	zoomViewAtPoint,
} from "../../../components/mermaid-diagram";

describe("zoom", () => {
	test("clamps and steps within bounds, returning exactly to 1", () => {
		expect(clampDiagramZoom(100)).toBe(MAX_DIAGRAM_ZOOM);
		expect(clampDiagramZoom(0)).toBeGreaterThan(0);
		expect(clampDiagramZoom(Number.NaN)).toBe(1);
		expect(stepDiagramZoom(stepDiagramZoom(1, "in"), "out")).toBe(1);
		expect(stepDiagramZoom(MAX_DIAGRAM_ZOOM, "in")).toBe(MAX_DIAGRAM_ZOOM);
	});

	test("keeps the point under the cursor fixed while zooming", () => {
		const point = { x: 100, y: 50 };
		const before = { scale: 1, x: 10, y: 20 };
		const after = zoomViewAtPoint(before, 2, point);
		// content coordinate under the point = (point - translate) / scale
		expect((point.x - after.x) / after.scale).toBeCloseTo(
			(point.x - before.x) / before.scale,
		);
		expect((point.y - after.y) / after.scale).toBeCloseTo(
			(point.y - before.y) / before.scale,
		);
		expect(zoomViewAtPoint(INITIAL_DIAGRAM_VIEW, 999, point).scale).toBe(
			MAX_DIAGRAM_ZOOM,
		);
	});

	test("wheel zoom is bounded and direction-correct", () => {
		expect(wheelZoomScale(1, -100)).toBeGreaterThan(1);
		expect(wheelZoomScale(1, 100)).toBeLessThan(1);
		expect(wheelZoomScale(1, 100000)).toBeCloseTo(wheelZoomScale(1, 100));
	});
});
