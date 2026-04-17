import { performance } from "node:perf_hooks"
import { expect } from "chai"
import { describe, it } from "mocha"
import { PatchActionType } from "@/shared/Patch"
import { measureAsyncOperation } from "@/test/stress-utils"
import { MAX_PATCH_SEARCH_BLOCK_BYTES, PatchParser } from "../PatchParser"

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

	it("fails fast when a patch search block exceeds the configured byte budget", async function () {
		this.timeout(10_000)

		const oversizedContextLine = "x".repeat(MAX_PATCH_SEARCH_BLOCK_BYTES + 1)
		const patchLines = [
			"*** Begin Patch",
			"*** Update File: stress.ts",
			"@@",
			` ${oversizedContextLine}`,
			"-old",
			"+new",
			"*** End Patch",
		]

		const parser = new PatchParser(patchLines, { "stress.ts": `${oversizedContextLine}\nold` })
		const startedAt = performance.now()

		try {
			parser.parse()
			expect.fail("Expected PatchParser to reject oversized search block")
		} catch (error) {
			const durationMs = performance.now() - startedAt
			expect(durationMs).to.be.lessThan(1_000)
			expect(error).to.be.instanceOf(Error)
			expect((error as Error).message).to.match(/Patch search block for stress\.ts is too large/)
		}
	})
})
