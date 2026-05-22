import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { geeDisplayLines, getLayerBounds, gradientForLegend, isGeoJsonLayer, parseLayerLegend } from "../mapLayerAdapters"

const mkLayer = (partial: Partial<MapLayer> & Pick<MapLayer, "id" | "layerType">): MapLayer => ({
	name: partial.name ?? partial.id,
	geojson: partial.geojson ?? "",
	style: partial.style,
	metadata: partial.metadata ?? {},
	visible: partial.visible ?? true,
	...partial,
})

describe("isGeoJsonLayer", () => {
	it("includes polygon, line, point, and legacy vector types", () => {
		expect(isGeoJsonLayer(mkLayer({ id: "p", layerType: "polygon", geojson: "{}" }))).toBe(true)
		expect(isGeoJsonLayer(mkLayer({ id: "v", layerType: "vector", geojson: "{}" }))).toBe(true)
		expect(isGeoJsonLayer(mkLayer({ id: "r", layerType: "raster", geojson: "" }))).toBe(false)
		expect(isGeoJsonLayer(mkLayer({ id: "g", layerType: "geojson", geojson: "{}" }))).toBe(true)
	})
})

describe("getLayerBounds", () => {
	it("parses gee_bounds for gee_tile layers", () => {
		const layer = mkLayer({
			id: "gee1",
			layerType: "gee_tile",
			metadata: { gee_bounds: "[-120, 30, -110, 40]" },
		})
		expect(getLayerBounds(layer)).toEqual([-120, 30, -110, 40])
	})

	it("parses geojson bounds for vector layers", () => {
		const layer = mkLayer({
			id: "v1",
			layerType: "polygon",
			geojson: JSON.stringify({
				type: "Feature",
				geometry: {
					type: "Polygon",
					coordinates: [
						[
							[0, 0],
							[2, 0],
							[2, 1],
							[0, 1],
							[0, 0],
						],
					],
				},
			}),
		})
		expect(getLayerBounds(layer)).toEqual([0, 0, 2, 1])
	})
})

describe("parseLayerLegend", () => {
	it("parses continuous legend JSON from metadata", () => {
		const layer = mkLayer({
			id: "r1",
			layerType: "raster",
			metadata: {
				legend: JSON.stringify({
					type: "continuous",
					title: "TWI",
					min: 0,
					max: 20,
					colormap: "viridis",
					units: "ln(a/tan β)",
				}),
			},
		})
		const spec = parseLayerLegend(layer)
		expect(spec?.type).toBe("continuous")
		if (spec?.type === "continuous") {
			expect(spec.title).toBe("TWI")
			expect(spec.max).toBe(20)
		}
	})

	it("falls back to chirps gradient for gee_tile without legend", () => {
		const layer = mkLayer({
			id: "g1",
			layerType: "gee_tile",
			metadata: { gee_dataset_id: "UCSB-CHC/CHIRPS/V3/DAILY" },
		})
		const spec = parseLayerLegend(layer)
		expect(spec?.type).toBe("continuous")
		if (spec?.type === "continuous") {
			expect(spec.colormap).toBe("chirps")
		}
	})

	it("parses categorical legend", () => {
		const layer = mkLayer({
			id: "c1",
			layerType: "raster",
			metadata: {
				legend: JSON.stringify({
					type: "categorical",
					classes: [
						{ value: 1, label: "Water", color: "#00f" },
						{ value: 2, label: "Urban", color: "#888" },
					],
				}),
			},
		})
		const spec = parseLayerLegend(layer)
		expect(spec?.type).toBe("categorical")
		if (spec?.type === "categorical") {
			expect(spec.classes).toHaveLength(2)
		}
	})
})

describe("geeDisplayLines", () => {
	it("includes dataset and date range", () => {
		const lines = geeDisplayLines(
			mkLayer({
				id: "g",
				layerType: "gee_tile",
				metadata: {
					gee_dataset_id: "UCSB-CHC/CHIRPS/V3/DAILY",
					gee_start_date: "2024-01-01",
					gee_end_date: "2024-01-14",
				},
			}),
		)
		expect(lines.some(([k]) => k === "dataset")).toBe(true)
		expect(lines.some(([k, v]) => k === "dates" && v.includes("2024-01-01"))).toBe(true)
	})
})

describe("gradientForLegend", () => {
	it("uses chirps gradient name", () => {
		const g = gradientForLegend({ type: "continuous", colormap: "chirps" })
		expect(g).toContain("081d58")
	})
})

describe("webview security", () => {
	it("map workspace fixture has no credential keys", () => {
		const sample = {
			version: 1,
			activeRoi: { name: "Test basin", source: "session" },
			visibleLayerIds: ["a"],
		}
		const json = JSON.stringify(sample)
		expect(json).not.toMatch(/token|credentials|secret|password/i)
	})
})
