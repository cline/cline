import { expect } from "chai"
import { describe, it } from "mocha"
import { measureAsyncOperation, measureUtf8Bytes } from "@/test/stress-utils"
import { constructNewFileContent } from "../diff"

function makeLargeOriginalContent(blockCount: number): string {
	return Array.from({ length: blockCount }, (_, i) => {
		return [`function block${i}() {`, `  const payload = "${`value-${i}-`.repeat(16)}"`, `  return payload`, `}`].join("\n")
	}).join("\n\n")
}

describe("constructNewFileContent stress", () => {
	it("handles many ordered replacements in a large file within a bounded time budget", async function () {
		this.timeout(10_000)

		const original = makeLargeOriginalContent(180)
		const replacementIndexes = [10, 25, 40, 55, 70, 85, 100, 115, 130, 145]
		const diff = replacementIndexes
			.map((index) => {
				const oldLine = `  const payload = "${`value-${index}-`.repeat(16)}"`
				const newLine = `  const payload = "${`updated-${index}-`.repeat(16)}"`
				return ["------- SEARCH", oldLine, "=======", newLine, "+++++++ REPLACE"].join("\n")
			})
			.join("\n\n")

		const measured = await measureAsyncOperation("diff ordered replacements stress", async () => {
			return constructNewFileContent(diff, original, true, "v1")
		})

		expect(measureUtf8Bytes(original)).to.be.greaterThan(10_000)
		expect(measured.durationMs).to.be.lessThan(5_000)
		for (const index of replacementIndexes) {
			expect(measured.result.newContent).to.include(`updated-${index}-updated-${index}-`)
		}
	})

	it("uses fallback matching on repeated trimmed multi-line blocks without throwing", async function () {
		this.timeout(10_000)

		const original = Array.from({ length: 120 }, (_, i) => {
			return [`section ${i}`, "    begin", `    payload ${i}`, "    end"].join("\n")
		}).join("\n")

		const diff = [
			"------- SEARCH",
			"begin",
			"payload 90",
			"end",
			"=======",
			"begin",
			"payload 90 updated",
			"end",
			"+++++++ REPLACE",
		].join("\n")

		const measured = await measureAsyncOperation("diff fallback stress", async () => {
			return constructNewFileContent(diff, original, true, "v1")
		})

		expect(measured.durationMs).to.be.lessThan(5_000)
		expect(measured.result.newContent).to.include("payload 90 updated")
		expect(measured.result.matchIndices).to.have.lengthOf(1)
	})
})
