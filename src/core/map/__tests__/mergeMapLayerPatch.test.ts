import { MapLayer } from "@shared/proto/cline/map"
import { expect } from "chai"
import { describe, it } from "mocha"
import { mergeMapLayerPatch } from "../mergeMapLayerPatch"

describe("mergeMapLayerPatch", () => {
	const base = MapLayer.create({
		id: "layer_a",
		name: "Basin",
		geojson: '{"type":"FeatureCollection","features":[]}',
		layerType: "polygon",
		style: {
			fillColor: "#0066CC",
			fillOpacity: 0.4,
			strokeColor: "#003399",
			strokeWidth: 2,
		},
		metadata: {
			graduated_attr: "twi",
			graduated_breaks: "[1,2,3]",
			path: "vectors/basin.geojson",
		},
	})

	it("preserves geojson when patching style", () => {
		const merged = mergeMapLayerPatch(base, {
			style: { fillColor: "#FF0000", fillOpacity: 0.6 },
		})
		expect(merged.geojson).to.equal(base.geojson)
		expect(merged.style?.fillColor).to.equal("#FF0000")
		expect(merged.style?.fillOpacity).to.equal(0.6)
	})

	it("clears graduated metadata when clear_graduated is set", () => {
		const merged = mergeMapLayerPatch(base, { clear_graduated: true })
		expect(merged.metadata?.graduated_attr).to.be.undefined
		expect(merged.metadata?.graduated_breaks).to.be.undefined
		expect(merged.metadata?.path).to.equal("vectors/basin.geojson")
	})

	it("merges metadata keys", () => {
		const merged = mergeMapLayerPatch(base, {
			metadata: {
				graduated_attr: "elev",
				graduated_breaks: "[10,20]",
			},
		})
		expect(merged.metadata?.graduated_attr).to.equal("elev")
	})
})
