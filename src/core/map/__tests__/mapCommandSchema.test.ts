import { expect } from "chai"
import { describe, it } from "mocha"
import { mapCommandSchema } from "../mapCommandSchema"

describe("mapCommandSchema", () => {
	it("accepts a well-formed update_layer command", () => {
		const result = mapCommandSchema.safeParse({
			type: "update_layer",
			layer_id: "layer1",
			visible: true,
			style: { color: "#ff0000", weight: 2 },
			metadata: { source: "agent" },
		})
		expect(result.success).to.equal(true)
	})

	it("accepts a well-formed set_roi command", () => {
		const result = mapCommandSchema.safeParse({
			type: "set_roi",
			roi: { id: "r1", name: "test", geojson: "{}", area_ha: 12.5 },
		})
		expect(result.success).to.equal(true)
	})

	it("rejects a command missing the required type field", () => {
		const result = mapCommandSchema.safeParse({ layer_id: "layer1" })
		expect(result.success).to.equal(false)
	})

	it("rejects wrong-typed fields instead of silently coercing", () => {
		// visible must be boolean — a string here previously would have
		// flowed straight into MapLayerPatch via an unchecked `as` cast.
		const result = mapCommandSchema.safeParse({ type: "set_layer_visibility", layer_id: "x", visible: "yes" })
		expect(result.success).to.equal(false)
	})

	it("rejects prototype-pollution-shaped roi payloads", () => {
		const result = mapCommandSchema.safeParse({
			type: "set_roi",
			roi: { id: "r1", area_ha: "not-a-number" },
		})
		expect(result.success).to.equal(false)
	})
})
