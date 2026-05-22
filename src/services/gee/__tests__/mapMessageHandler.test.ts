import { expect } from "chai"
import { buildGeeMapLayer } from "../mapMessageHandler"

describe("buildGeeMapLayer", () => {
	it("maps a GEE tile result into a map layer", () => {
		const layer = buildGeeMapLayer(
			{
				ok: true,
				type: "gee_tile_layer",
				name: "CHIRPS precipitation",
				dataset_id: "UCSB-CHC/CHIRPS/V3/DAILY_SAT",
				start_date: "2026-01-01",
				end_date: "2026-01-31",
				tile_url_template: "https://tiles/{z}/{x}/{y}",
				bounds_wgs84: [-10, -5, 10, 5],
				provenance: {},
			},
			"/tmp/prov.json",
		)

		expect(layer.layerType).to.equal("gee_tile")
		expect(layer.metadata.gee_tile_url_template).to.equal("https://tiles/{z}/{x}/{y}")
		expect(layer.metadata.provenance_path).to.equal("/tmp/prov.json")
	})
})
