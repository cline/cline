import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { buildMapLayerCatalog, extractNumericAttributes, layerToCatalogEntry } from "../mapLayerCatalog"

describe("mapLayerCatalog", () => {
	it("extractNumericAttributes finds numeric property columns", () => {
		const geojson = JSON.stringify({
			type: "FeatureCollection",
			features: [
				{ type: "Feature", properties: { twi: 5.2, name: "a" }, geometry: null },
				{ type: "Feature", properties: { twi: 8.1, name: "b" }, geometry: null },
			],
		})
		const attrs = extractNumericAttributes(geojson)
		expect(attrs.some((a) => a.name === "twi")).to.equal(true)
		expect(attrs.find((a) => a.name === "twi")?.min).to.be.closeTo(5.2, 0.01)
	})

	it("layerToCatalogEntry reports graduated symbology mode", () => {
		const layer = MapLayer.create({
			id: "l1",
			name: "Grid",
			geojson: '{"type":"FeatureCollection","features":[{"properties":{"twi":1}}]}',
			layerType: "polygon",
			metadata: {
				graduated_attr: "twi",
				graduated_breaks: "[1,5,10]",
				graduated_method: "quantile",
			},
		})
		const entry = layerToCatalogEntry(layer)
		expect(entry.symbology_mode).to.equal("graduated")
		expect(entry.graduated?.attr).to.equal("twi")
	})

	it("buildMapLayerCatalog preserves layer order", () => {
		const layers = [
			MapLayer.create({ id: "b", name: "B", geojson: "{}", layerType: "polygon" }),
			MapLayer.create({ id: "a", name: "A", geojson: "{}", layerType: "polygon" }),
		]
		const catalog = buildMapLayerCatalog(layers, ["a", "b"])
		expect(catalog.layer_order).to.deep.equal(["a", "b"])
		expect(catalog.layers.map((l) => l.id)).to.deep.equal(["a", "b"])
	})
})
