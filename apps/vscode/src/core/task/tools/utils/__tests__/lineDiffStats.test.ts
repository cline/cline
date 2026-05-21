import { expect } from "chai"
import { computeLineDiffStats } from "../lineDiffStats"

describe("computeLineDiffStats", () => {
	it("returns zeros for identical content", () => {
		const content = "line1\nline2\nline3"
		expect(computeLineDiffStats(content, content)).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 0,
			linesChanged: 0,
		})
	})

	it("counts all lines as added for new file", () => {
		expect(computeLineDiffStats("", "a\nb\nc")).to.deep.equal({
			linesAdded: 3,
			linesDeleted: 0,
			linesChanged: 0,
		})
	})

	it("counts all lines as deleted for removed file", () => {
		expect(computeLineDiffStats("a\nb\nc", "")).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 3,
			linesChanged: 0,
		})
	})

	it("handles insertion in the middle without false changes", () => {
		const before = "line1\nline2\nline3\nline4\nline5"
		const after = "line1\nline2\nnewA\nnewB\nnewC\nnewD\nnewE\nline3\nline4\nline5"
		const stats = computeLineDiffStats(before, after)
		expect(stats).to.deep.equal({
			linesAdded: 5,
			linesDeleted: 0,
			linesChanged: 0,
		})
	})

	it("handles deletion in the middle without false changes", () => {
		const before = "line1\nline2\nline3\nline4\nline5"
		const after = "line1\nline5"
		const stats = computeLineDiffStats(before, after)
		expect(stats).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 3,
			linesChanged: 0,
		})
	})

	it("counts single line replacement as changed", () => {
		const before = "line1\nline2\nline3"
		const after = "line1\nmodified\nline3"
		const stats = computeLineDiffStats(before, after)
		expect(stats).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 0,
			linesChanged: 1,
		})
	})

	it("handles replace with more lines (changed + added)", () => {
		const before = "line1\nold\nline3"
		const after = "line1\nnewA\nnewB\nnewC\nline3"
		const stats = computeLineDiffStats(before, after)
		// 1 old line replaced by 3 new lines = 1 changed + 2 added
		expect(stats).to.deep.equal({
			linesAdded: 2,
			linesDeleted: 0,
			linesChanged: 1,
		})
	})

	it("handles replace with fewer lines (changed + deleted)", () => {
		const before = "line1\noldA\noldB\noldC\nline5"
		const after = "line1\nnew\nline5"
		const stats = computeLineDiffStats(before, after)
		// 3 old lines replaced by 1 new line = 1 changed + 2 deleted
		expect(stats).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 2,
			linesChanged: 1,
		})
	})

	it("handles empty before and empty after", () => {
		expect(computeLineDiffStats("", "")).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 0,
			linesChanged: 0,
		})
	})

	it("handles append at end of file", () => {
		const before = "line1\nline2"
		const after = "line1\nline2\nline3\nline4"
		const stats = computeLineDiffStats(before, after)
		expect(stats).to.deep.equal({
			linesAdded: 2,
			linesDeleted: 0,
			linesChanged: 0,
		})
	})

	it("handles multiple disjoint edits", () => {
		const before = "a\nb\nc\nd\ne\nf\ng"
		const after = "a\nB\nc\nd\ne\nF\ng"
		const stats = computeLineDiffStats(before, after)
		expect(stats).to.deep.equal({
			linesAdded: 0,
			linesDeleted: 0,
			linesChanged: 2,
		})
	})
})
