import { describe, expect, it } from "vitest"
import { featureContainsPoint, featuresFromGeoJson } from "../geoInspect"

describe("geoInspect", () => {
	it("wraps bare Polygon geometry as a feature", () => {
		const refs = featuresFromGeoJson({
			type: "Polygon",
			coordinates: [
				[
					[-70, 45],
					[-69, 45],
					[-69, 46],
					[-70, 45],
				],
			],
		})
		expect(refs).toHaveLength(1)
		expect(featureContainsPoint(refs[0].feature, -69.5, 45.5)).toBe(true)
		expect(featureContainsPoint(refs[0].feature, -68, 45.5)).toBe(false)
	})

	it("reads FeatureCollection features", () => {
		const refs = featuresFromGeoJson({
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					properties: { gauge_id: "01031500" },
					geometry: {
						type: "Point",
						coordinates: [-69.5, 45.5],
					},
				},
			],
		})
		expect(refs).toHaveLength(1)
		expect(featureContainsPoint(refs[0].feature, -69.5, 45.5)).toBe(true)
	})
})
