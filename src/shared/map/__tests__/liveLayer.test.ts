import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { mapLayerToLiveLayer, parseBoundsJson } from "../liveLayer"

describe("liveLayer adapters", () => {
	it("parseBoundsJson accepts WGS84 quad", () => {
		expect(parseBoundsJson("[-180,-60,180,84]")).to.deep.equal([-180, -60, 180, 84])
	})

	it("mapLayerToLiveLayer maps GEE metadata", () => {
		const layer = MapLayer.create({
			id: "l1",
			name: "CHIRPS",
			layerType: "gee_tile",
			geojson: "",
			visible: true,
			metadata: {
				source: "gee",
				gee_dataset_id: "UCSB-CHC/CHIRPS/V3/DAILY",
				gee_bounds: "[0,0,1,1]",
				gee_start_date: "2024-01-01",
				gee_end_date: "2024-01-07",
				provenance_path: "/tmp/prov.json",
			},
		})
		const live = mapLayerToLiveLayer(layer)
		expect(live.geeDatasetId).to.contain("CHIRPS")
		expect(live.bounds).to.deep.equal([0, 0, 1, 1])
		expect(live.provenancePath).to.equal("/tmp/prov.json")
	})
})
