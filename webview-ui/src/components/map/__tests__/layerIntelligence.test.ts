import type { MapLayer } from "@shared/proto/cline/map"
import { describe, expect, it } from "vitest"
import { deriveLayerIntelligence } from "../layerIntelligence"

const layer = (partial: Partial<MapLayer> & Pick<MapLayer, "id" | "layerType">): MapLayer => ({
	id: partial.id,
	name: partial.name ?? partial.id,
	layerType: partial.layerType,
	geojson: partial.geojson ?? "",
	metadata: partial.metadata ?? {},
	style: partial.style,
	visible: partial.visible ?? true,
})

describe("deriveLayerIntelligence", () => {
	it("marks raw GeoTIFF rasters as analysis-ready", () => {
		const intel = deriveLayerIntelligence(
			layer({
				id: "twi",
				layerType: "raster",
				metadata: { raster_recolorable: "true", units: "index" },
			}),
		)
		expect(intel.dataState).toBe("analysis_ready_raster")
		expect(intel.statusLabel).toBe("Analysis-ready raster")
		expect(intel.capabilities.has("style_raster")).toBe(true)
		expect(intel.capabilities.has("raster_probe")).toBe(true)
		expect(intel.warnings).not.toContain("VISUAL_PREVIEW_ONLY")
	})

	it("explains rendered raster previews as visual-only", () => {
		const intel = deriveLayerIntelligence(layer({ id: "png", layerType: "raster" }))
		expect(intel.dataState).toBe("visual_preview_raster")
		expect(intel.statusLabel).toBe("Visual preview only")
		expect(intel.capabilities.has("style_raster")).toBe(false)
		expect(intel.warnings).toContain("VISUAL_PREVIEW_ONLY")
		expect(intel.warnings).toContain("CAPTURE_ONLY_EXPORT")
	})

	it("recognizes MERIT vectors as reference data with citation warnings", () => {
		const intel = deriveLayerIntelligence(
			layer({
				id: "merit-cat",
				layerType: "polygon",
				geojson: "{}",
				metadata: { source: "merit", merit_layer: "catchments" },
			}),
		)
		expect(intel.dataState).toBe("reference_vector")
		expect(intel.statusLabel).toBe("Reference data")
		expect(intel.capabilities.has("export_geojson")).toBe(true)
		expect(intel.warnings).toContain("MISSING_CITATION")
	})
})
