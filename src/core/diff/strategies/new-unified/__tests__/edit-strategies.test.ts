import { applyContextMatching, applyDMP, applyGitFallback } from "../edit-strategies"
import { Hunk } from "../types"

const testCases = [
	{
		name: "should return original content if no match is found",
		hunk: {
			changes: [
				{ type: "context", content: "line1" },
				{ type: "add", content: "line2" },
			],
		} as Hunk,
		content: ["line1", "line3"],
		matchPosition: -1,
		expected: {
			confidence: 0,
			result: ["line1", "line3"],
		},
		expectedResult: "line1\nline3",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a simple add change",
		hunk: {
			changes: [
				{ type: "context", content: "line1" },
				{ type: "add", content: "line2" },
			],
		} as Hunk,
		content: ["line1", "line3"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["line1", "line2", "line3"],
		},
		expectedResult: "line1\nline2\nline3",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a simple remove change",
		hunk: {
			changes: [
				{ type: "context", content: "line1" },
				{ type: "remove", content: "line2" },
			],
		} as Hunk,
		content: ["line1", "line2", "line3"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["line1", "line3"],
		},
		expectedResult: "line1\nline3",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a simple context change",
		hunk: {
			changes: [{ type: "context", content: "line1" }],
		} as Hunk,
		content: ["line1", "line2", "line3"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["line1", "line2", "line3"],
		},
		expectedResult: "line1\nline2\nline3",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a multi-line add change",
		hunk: {
			changes: [
				{ type: "context", content: "line1" },
				{ type: "add", content: "line2\nline3" },
			],
		} as Hunk,
		content: ["line1", "line4"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["line1", "line2\nline3", "line4"],
		},
		expectedResult: "line1\nline2\nline3\nline4",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a multi-line remove change",
		hunk: {
			changes: [
				{ type: "context", content: "line1" },
				{ type: "remove", content: "line2\nline3" },
			],
		} as Hunk,
		content: ["line1", "line2", "line3", "line4"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["line1", "line4"],
		},
		expectedResult: "line1\nline4",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a multi-line context change",
		hunk: {
			changes: [
				{ type: "context", content: "line1" },
				{ type: "context", content: "line2\nline3" },
			],
		} as Hunk,
		content: ["line1", "line2", "line3", "line4"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["line1", "line2\nline3", "line4"],
		},
		expectedResult: "line1\nline2\nline3\nline4",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a change with indentation",
		hunk: {
			changes: [
				{ type: "context", content: "  line1" },
				{ type: "add", content: "    line2" },
			],
		} as Hunk,
		content: ["  line1", "  line3"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["  line1", "    line2", "  line3"],
		},
		expectedResult: "  line1\n    line2\n  line3",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a change with mixed indentation",
		hunk: {
			changes: [
				{ type: "context", content: "\tline1" },
				{ type: "add", content: "  line2" },
			],
		} as Hunk,
		content: ["\tline1", "  line3"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["\tline1", "  line2", "  line3"],
		},
		expectedResult: "\tline1\n  line2\n  line3",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a change with mixed indentation and multi-line",
		hunk: {
			changes: [
				{ type: "context", content: "  line1" },
				{ type: "add", content: "\tline2\n    line3" },
			],
		} as Hunk,
		content: ["  line1", "  line4"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["  line1", "\tline2\n    line3", "  line4"],
		},
		expectedResult: "  line1\n\tline2\n    line3\n  line4",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a complex change with mixed indentation and multi-line",
		hunk: {
			changes: [
				{ type: "context", content: "  line1" },
				{ type: "remove", content: "    line2" },
				{ type: "add", content: "\tline3\n      line4" },
				{ type: "context", content: "  line5" },
			],
		} as Hunk,
		content: ["  line1", "    line2", "  line5", "  line6"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["  line1", "\tline3\n      line4", "  line5", "  line6"],
		},
		expectedResult: "  line1\n\tline3\n      line4\n  line5\n  line6",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a complex change with mixed indentation and multi-line and context",
		hunk: {
			changes: [
				{ type: "context", content: "  line1" },
				{ type: "remove", content: "    line2" },
				{ type: "add", content: "\tline3\n      line4" },
				{ type: "context", content: "  line5" },
				{ type: "context", content: "  line6" },
			],
		} as Hunk,
		content: ["  line1", "    line2", "  line5", "  line6", "  line7"],
		matchPosition: 0,
		expected: {
			confidence: 1,
			result: ["  line1", "\tline3\n      line4", "  line5", "  line6", "  line7"],
		},
		expectedResult: "  line1\n\tline3\n      line4\n  line5\n  line6\n  line7",
		strategies: ["context", "dmp"],
	},
	{
		name: "should apply a complex change with mixed indentation and multi-line and context and a different match position",
		hunk: {
			changes: [
				{ type: "context", content: "  line1" },
				{ type: "remove", content: "    line2" },
				{ type: "add", content: "\tline3\n      line4" },
				{ type: "context", content: "  line5" },
				{ type: "context", content: "  line6" },
			],
		} as Hunk,
		content: ["  line0", "  line1", "    line2", "  line5", "  line6", "  line7"],
		matchPosition: 1,
		expected: {
			confidence: 1,
			result: ["  line0", "  line1", "\tline3\n      line4", "  line5", "  line6", "  line7"],
		},
		expectedResult: "  line0\n  line1\n\tline3\n      line4\n  line5\n  line6\n  line7",
		strategies: ["context", "dmp"],
	},
]

describe("applyContextMatching", () => {
	testCases.forEach(({ name, hunk, content, matchPosition, expected, strategies, expectedResult }) => {
		if (!strategies?.includes("context")) {
			return
		}
		it(name, () => {
			const result = applyContextMatching(hunk, content, matchPosition)
			expect(result.result.join("\n")).toEqual(expectedResult)
			expect(result.confidence).toBeGreaterThanOrEqual(expected.confidence)
			expect(result.strategy).toBe("context")
		})
	})
})

describe("applyDMP", () => {
	testCases.forEach(({ name, hunk, content, matchPosition, expected, strategies, expectedResult }) => {
		if (!strategies?.includes("dmp")) {
			return
		}
		it(name, () => {
			const result = applyDMP(hunk, content, matchPosition)
			expect(result.result.join("\n")).toEqual(expectedResult)
			expect(result.confidence).toBeGreaterThanOrEqual(expected.confidence)
			expect(result.strategy).toBe("dmp")
		})
	})
})

describe("applyGitFallback", () => {
	it("should successfully apply changes using git operations", async () => {
		const hunk = {
			changes: [
				{ type: "context", content: "line1", indent: "" },
				{ type: "remove", content: "line2", indent: "" },
				{ type: "add", content: "new line2", indent: "" },
				{ type: "context", content: "line3", indent: "" }
			]
		} as Hunk

		const content = ["line1", "line2", "line3"]
		const result = await applyGitFallback(hunk, content)

		expect(result.result.join("\n")).toEqual("line1\nnew line2\nline3")
		expect(result.confidence).toBe(1)
		expect(result.strategy).toBe("git-fallback")
	})

	it("should return original content with 0 confidence when changes cannot be applied", async () => {
		const hunk = {
			changes: [
				{ type: "context", content: "nonexistent", indent: "" },
				{ type: "add", content: "new line", indent: "" }
			]
		} as Hunk

		const content = ["line1", "line2", "line3"]
		const result = await applyGitFallback(hunk, content)

		expect(result.result).toEqual(content)
		expect(result.confidence).toBe(0)
		expect(result.strategy).toBe("git-fallback")
	})
})
