import { expect } from "chai"
import { describe, it } from "mocha"
import { PatchActionType } from "@/shared/Patch"
import { measureAsyncOperation } from "@/test/stress-utils"
import { PatchParser } from "../PatchParser"

function makeRepeatedFile(lineCount: number, payloadWidth: number): string {
	return Array.from({ length: lineCount }, (_, i) => {
		const repeated = `${"segment-".repeat(payloadWidth)}${i}`
		return `const value${i} = "${repeated}"`
	}).join("\n")
}

describe("PatchParser stress", () => {
	it("handles large near-match contexts without failing while reporting fuzzy matches", async function () {
		this.timeout(10_000)

		const originalFile = makeRepeatedFile(260, 14)
		const originalLines = originalFile.split("\n")
		const contextStart = 140
		const contextLength = 18
		const targetContext = originalLines.slice(contextStart, contextStart + contextLength)

		const searchContext = [...targetContext]
		searchContext[9] = searchContext[9].replace("segment-segment-", "segment-SEGMENT-")
		const replacementLine = targetContext[10].replace("segment-", "patched-segment-")

		const patchLines = [
			"*** Begin Patch",
			"*** Update File: stress.ts",
			"@@",
			...searchContext.flatMap((line, index) => {
				if (index === 10) {
					return [`-${line}`, `+${replacementLine}`]
				}
				return ` ${line}`
			}),
			"*** End Patch",
		]

		const measured = await measureAsyncOperation("PatchParser near-match stress", async () => {
			const parser = new PatchParser(patchLines, { "stress.ts": originalFile })
			return parser.parse()
		})

		expect(measured.durationMs).to.be.lessThan(5_000)
		expect(measured.result.patch.actions["stress.ts"]?.type).to.equal(PatchActionType.UPDATE)
		expect(measured.result.patch.actions["stress.ts"]?.chunks).to.be.an("array")
		expect(measured.result.patch.warnings).to.be.undefined
	})
})
