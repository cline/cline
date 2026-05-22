import { expect } from "chai"
import { geeCommandSchema, geePreviewChirpsPayloadSchema } from "../schemas"

describe("gee schemas", () => {
	it("validates command envelope", () => {
		const parsed = geeCommandSchema.parse({
			command: "status",
			requestId: "req-1",
		})
		expect(parsed.command).to.equal("status")
	})

	it("rejects invalid command", () => {
		expect(() => geeCommandSchema.parse({ command: "bad", requestId: "x" })).to.throw()
	})

	it("validates CHIRPS payload dates", () => {
		const parsed = geePreviewChirpsPayloadSchema.parse({
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		})
		expect(parsed.startDate).to.equal("2026-01-01")
	})

	it("rejects malformed date", () => {
		expect(() => geePreviewChirpsPayloadSchema.parse({ startDate: "01-01-2026", endDate: "2026-01-31" })).to.throw()
	})
})
