import { expect } from "chai"
import {
	extractPathsFromApplyPatch,
	extractPathsFromWriteTool,
	normalizeToWorkspaceRelative,
	validateAndNormalizePath,
} from "../rulePathIntentUtils"

/**
 * Extract file paths from tool call parameters for rule path intent harvesting.
 *
 * This is a pure-function extraction of the logic from ToolExecutor.harvestRulePathIntent()
 * to enable unit testing. The actual ToolExecutor method delegates to this logic.
 */

describe("harvestRulePathIntent utilities", () => {
	describe("extractPathsFromWriteTool", () => {
		it("extracts path from params.path", () => {
			const params = { path: "src/index.ts" }
			const result = extractPathsFromWriteTool(params)
			expect(result).to.deep.equal(["src/index.ts"])
		})

		it("extracts absolutePath from params.absolutePath", () => {
			const params = { absolutePath: "/home/user/project/src/index.ts" }
			const result = extractPathsFromWriteTool(params)
			expect(result).to.deep.equal(["/home/user/project/src/index.ts"])
		})

		it("extracts both path and absolutePath when present", () => {
			const params = { path: "src/index.ts", absolutePath: "/home/user/project/src/index.ts" }
			const result = extractPathsFromWriteTool(params)
			expect(result).to.deep.equal(["src/index.ts", "/home/user/project/src/index.ts"])
		})

		it("returns empty array when no paths present", () => {
			const params = {}
			const result = extractPathsFromWriteTool(params)
			expect(result).to.deep.equal([])
		})

		it("handles undefined values gracefully", () => {
			const params = { path: undefined, absolutePath: undefined }
			const result = extractPathsFromWriteTool(params)
			expect(result).to.deep.equal([])
		})
	})

	describe("extractPathsFromApplyPatch", () => {
		it("extracts path from *** Add File header", () => {
			const input = "*** Add File: src/newfile.ts\ncontent here"
			const result = extractPathsFromApplyPatch(input)
			expect(result).to.deep.equal(["src/newfile.ts"])
		})

		it("extracts path from *** Update File header", () => {
			const input = "*** Update File: src/existing.ts\n@@ -1,3 +1,4 @@"
			const result = extractPathsFromApplyPatch(input)
			expect(result).to.deep.equal(["src/existing.ts"])
		})

		it("extracts path from *** Delete File header", () => {
			const input = "*** Delete File: src/obsolete.ts"
			const result = extractPathsFromApplyPatch(input)
			expect(result).to.deep.equal(["src/obsolete.ts"])
		})

		it("extracts multiple paths from multi-file patch", () => {
			const input = `*** Add File: src/new.ts
content
*** Update File: src/existing.ts
@@ -1,3 +1,4 @@
*** Delete File: src/old.ts`
			const result = extractPathsFromApplyPatch(input)
			expect(result).to.deep.equal(["src/new.ts", "src/existing.ts", "src/old.ts"])
		})

		it("handles paths with spaces", () => {
			const input = "*** Add File: src/my file.ts\ncontent"
			const result = extractPathsFromApplyPatch(input)
			expect(result).to.deep.equal(["src/my file.ts"])
		})

		it("handles deeply nested paths", () => {
			const input = "*** Update File: apps/web/src/components/ui/Button.tsx\ncontent"
			const result = extractPathsFromApplyPatch(input)
			expect(result).to.deep.equal(["apps/web/src/components/ui/Button.tsx"])
		})

		it("returns empty array for empty input", () => {
			expect(extractPathsFromApplyPatch("")).to.deep.equal([])
		})

		it("returns empty array for input without patch headers", () => {
			const input = "This is just regular text without any patch headers"
			expect(extractPathsFromApplyPatch(input)).to.deep.equal([])
		})

		it("ignores malformed headers", () => {
			const input = "*** Add: src/bad.ts\n*** File: src/also-bad.ts"
			expect(extractPathsFromApplyPatch(input)).to.deep.equal([])
		})
	})

	describe("normalizeToWorkspaceRelative", () => {
		it("converts absolute Unix path to workspace-relative", () => {
			const roots = [{ path: "/home/user/project" }]
			const result = normalizeToWorkspaceRelative("/home/user/project/src/index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})

		it("converts absolute Windows path to workspace-relative", () => {
			const roots = [{ path: "C:\\Users\\dev\\project" }]
			const result = normalizeToWorkspaceRelative("C:\\Users\\dev\\project\\src\\index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})

		it("handles mixed path separators", () => {
			const roots = [{ path: "/home/user/project" }]
			const result = normalizeToWorkspaceRelative("/home/user/project\\src\\index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})

		it("returns original path if no root matches", () => {
			const roots = [{ path: "/home/user/other-project" }]
			const result = normalizeToWorkspaceRelative("/home/user/project/src/index.ts", roots)
			expect(result).to.equal("/home/user/project/src/index.ts")
		})

		it("returns relative path unchanged", () => {
			const roots = [{ path: "/home/user/project" }]
			const result = normalizeToWorkspaceRelative("src/index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})

		it("handles multiple workspace roots (matches first)", () => {
			const roots = [{ path: "/home/user/project-a" }, { path: "/home/user/project-b" }]
			const result = normalizeToWorkspaceRelative("/home/user/project-b/src/index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})

		it("handles trailing slash in root path", () => {
			const roots = [{ path: "/home/user/project/" }]
			const result = normalizeToWorkspaceRelative("/home/user/project/src/index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})

		it("returns original when roots array is empty", () => {
			const result = normalizeToWorkspaceRelative("/home/user/project/src/index.ts", [])
			expect(result).to.equal("/home/user/project/src/index.ts")
		})

		it("handles root with null path gracefully", () => {
			const roots = [{ path: null as any }, { path: "/home/user/project" }]
			const result = normalizeToWorkspaceRelative("/home/user/project/src/index.ts", roots)
			expect(result).to.equal("src/index.ts")
		})
	})

	describe("validateAndNormalizePath", () => {
		it("normalizes backslashes to forward slashes", () => {
			const result = validateAndNormalizePath("src\\components\\Button.tsx")
			expect(result).to.equal("src/components/Button.tsx")
		})

		it("does not reject filenames containing '..'", () => {
			const result = validateAndNormalizePath("src/file..txt")
			expect(result).to.equal("src/file..txt")
		})

		it("strips leading forward slash", () => {
			const result = validateAndNormalizePath("/src/index.ts")
			expect(result).to.equal("src/index.ts")
		})

		it("rejects empty string", () => {
			expect(validateAndNormalizePath("")).to.be.undefined
		})

		it("rejects root path only", () => {
			expect(validateAndNormalizePath("/")).to.be.undefined
		})

		it("rejects paths with parent directory traversal", () => {
			expect(validateAndNormalizePath("../src/index.ts")).to.be.undefined
			expect(validateAndNormalizePath("src/../index.ts")).to.be.undefined
		})

		it("allows normal relative paths", () => {
			expect(validateAndNormalizePath("src/index.ts")).to.equal("src/index.ts")
		})

		it("allows deeply nested paths", () => {
			const result = validateAndNormalizePath("apps/web/src/components/ui/Button.tsx")
			expect(result).to.equal("apps/web/src/components/ui/Button.tsx")
		})
	})
})
