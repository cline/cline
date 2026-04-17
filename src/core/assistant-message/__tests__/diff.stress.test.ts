import { expect } from "chai"
import { describe, it } from "mocha"
import { measureAsyncOperation, measureUtf8Bytes } from "@/test/stress-utils"
import { constructNewFileContent, MAX_DIFF_FALLBACK_WORK_UNITS, MAX_DIFF_LINE_BYTES } from "../diff"

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

	it("fails fast on giant single-line diff payloads", async function () {
		this.timeout(10_000)

		const giantLine = "x".repeat(MAX_DIFF_LINE_BYTES + 1)
		const original = "small line\nsecond line"
		const diff = ["------- SEARCH", giantLine, "=======", "updated", "+++++++ REPLACE"].join("\n")

		const startedAt = Date.now()
		try {
			await constructNewFileContent(diff, original, true, "v1")
			expect.fail("Expected constructNewFileContent to reject giant single-line diff payloads")
		} catch (error) {
			expect(Date.now() - startedAt).to.be.lessThan(1_000)
			expect((error as Error).message).to.match(/SEARCH\/REPLACE payload contains a line that is too large/)
		}
	})

	it("skips oversized fallback matching work for giant near-match multi-line searches", async function () {
		this.timeout(10_000)

		const original = Array.from({ length: 3_000 }, (_, i) => {
			return [`section ${i}`, "    begin", `    payload ${i}`, "    end"].join("\n")
		}).join("\n")

		const diff = [
			"------- SEARCH",
			...Array.from({ length: 64 }, (_, i) => `begin ${i}`),
			"payload 90",
			"end 90",
			"=======",
			"begin",
			"payload 90 updated",
			"end",
			"+++++++ REPLACE",
		].join("\n")

		expect((3_000 - 66 + 1) * 66).to.be.greaterThan(MAX_DIFF_FALLBACK_WORK_UNITS)

		const startedAt = Date.now()
		try {
			await constructNewFileContent(diff, original, true, "v1")
			expect.fail("Expected constructNewFileContent to fail once oversized fallback work is skipped")
		} catch (error) {
			expect(Date.now() - startedAt).to.be.lessThan(1_000)
			expect((error as Error).message).to.match(/does not match anything in the file/)
		}
	})
})
