import { expect } from "chai"
import { describe, it } from "mocha"
import { previewCommandSchema } from "../previewCommandSchema"

describe("previewCommandSchema", () => {
	it("accepts a well-formed focus_cell command", () => {
		const result = previewCommandSchema.safeParse({ type: "focus_cell", module_id: "m1", cell_id: "c1" })
		expect(result.success).to.equal(true)
	})

	it("accepts a well-formed revise_section command", () => {
		const result = previewCommandSchema.safeParse({
			type: "revise_section",
			module_id: "m1",
			section_id: "s1",
			new_html: "<p>hi</p>",
		})
		expect(result.success).to.equal(true)
	})

	it("rejects a command missing the required type field", () => {
		const result = previewCommandSchema.safeParse({ module_id: "m1" })
		expect(result.success).to.equal(false)
	})

	it("rejects wrong-typed known fields instead of silently coercing", () => {
		const result = previewCommandSchema.safeParse({ type: "focus_cell", cell_id: 123 })
		expect(result.success).to.equal(false)
	})

	it("preserves forward-compat by passing through unknown fields", () => {
		const result = previewCommandSchema.safeParse({ type: "future_command", some_new_field: "value" })
		expect(result.success).to.equal(true)
		if (result.success) {
			expect((result.data as Record<string, unknown>).some_new_field).to.equal("value")
		}
	})
})
