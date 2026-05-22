import { MapLayer, MapLayerStyle } from "@shared/proto/cline/map"
import type { GeeTileLayerResult } from "./types"

export function buildGeeMapLayer(result: GeeTileLayerResult, provenancePath?: string): MapLayer {
	return MapLayer.create({
		id: `gee_chirps_${Date.now()}`,
		name: result.name || "CHIRPS precipitation",
		layerType: "gee_tile",
		geojson: "",
		style: MapLayerStyle.create({
			opacity: 0.75,
			fillOpacity: 0.75,
		}),
		visible: true,
		metadata: {
			source: "gee",
			gee_dataset_id: result.dataset_id || "",
			gee_tile_url_template: result.tile_url_template || result.tile_url || "",
			gee_remote_tile_url_template: result.remote_tile_url_template || "",
			gee_bounds: JSON.stringify(result.bounds_wgs84 || [-180, -60, 180, 84]),
			gee_start_date: result.start_date,
			gee_end_date: result.end_date,
			gee_mock: String(result.mock === true),
			provenance_path: provenancePath || "",
		},
	})
}
