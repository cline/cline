import { expect } from "chai"
import { describe, it } from "mocha"
import {
	addWorkspaceHint,
	hasWorkspaceHint,
	parseMultipleWorkspacePaths,
	parseWorkspaceInlinePath,
	removeWorkspaceHint,
} from "../../../core/workspace/utils/parseWorkspaceInlinePath"

describe("parseWorkspaceInlinePath", () => {
	describe("basic parsing", () => {
		it("should parse path with workspace hint", () => {
			const result = parseWorkspaceInlinePath("@frontend:src/index.ts")
			expect(result).to.deep.equal({
				workspaceHint: "frontend",
				relPath: "src/index.ts",
			})
		})

		it("should parse path without workspace hint", () => {
			const result = parseWorkspaceInlinePath("src/index.ts")
			expect(result).to.deep.equal({
				workspaceHint: undefined,
				relPath: "src/index.ts",
			})
		})

		it("should handle workspace names with hyphens", () => {
			const result = parseWorkspaceInlinePath("@my-frontend-app:package.json")
			expect(result).to.deep.equal({
				workspaceHint: "my-frontend-app",
				relPath: "package.json",
			})
		})

		it("should handle workspace names with underscores", () => {
			const result = parseWorkspaceInlinePath("@backend_service:src/main.py")
			expect(result).to.deep.equal({
				workspaceHint: "backend_service",
				relPath: "src/main.py",
			})
		})

		it("should handle paths with multiple colons", () => {
			const result = parseWorkspaceInlinePath("@backend:src/config:prod.json")
			expect(result).to.deep.equal({
				workspaceHint: "backend",
				relPath: "src/config:prod.json",
			})
		})

		it("should treat bare workspace hint as root path", () => {
			const result = parseWorkspaceInlinePath("@backend:")
			expect(result).to.deep.equal({
				workspaceHint: "backend",
				relPath: "",
			})
		})

		it("should trim whitespace", () => {
			const result = parseWorkspaceInlinePath("@ frontend : src/index.ts ")
			expect(result).to.deep.equal({
				workspaceHint: "frontend",
				relPath: "src/index.ts",
			})
		})
	})

	describe("edge cases", () => {
		it("should handle empty string", () => {
			const result = parseWorkspaceInlinePath("")
			expect(result).to.deep.equal({
				workspaceHint: undefined,
				relPath: "",
			})
		})

		it("should handle null/undefined", () => {
			const result = parseWorkspaceInlinePath(null as any)
			expect(result).to.deep.equal({
				workspaceHint: undefined,
				relPath: "",
			})
		})

		it("should handle @ without colon", () => {
			const result = parseWorkspaceInlinePath("@frontend")
			expect(result).to.deep.equal({
				workspaceHint: undefined,
				relPath: "@frontend",
			})
		})

		it("should handle colon without @", () => {
			const result = parseWorkspaceInlinePath("frontend:src/index.ts")
			expect(result).to.deep.equal({
				workspaceHint: undefined,
				relPath: "frontend:src/index.ts",
			})
		})

		it("should handle @ at the end", () => {
			const result = parseWorkspaceInlinePath("src/index.ts@")
			expect(result).to.deep.equal({
				workspaceHint: undefined,
				relPath: "src/index.ts@",
			})
		})
	})

	describe("hasWorkspaceHint", () => {
		it("should return true for paths with hints", () => {
			expect(hasWorkspaceHint("@frontend:src/index.ts")).to.be.true
			expect(hasWorkspaceHint("@backend:package.json")).to.be.true
		})

		it("should return false for paths without hints", () => {
			expect(hasWorkspaceHint("src/index.ts")).to.be.false
			expect(hasWorkspaceHint("@frontend")).to.be.false
			expect(hasWorkspaceHint("frontend:src")).to.be.false
		})
	})

	describe("addWorkspaceHint", () => {
		it("should add hint to path without hint", () => {
			const result = addWorkspaceHint("frontend", "src/index.ts")
			expect(result).to.equal("@frontend:src/index.ts")
		})

		it("should replace existing hint", () => {
			const result = addWorkspaceHint("backend", "@frontend:src/index.ts")
			expect(result).to.equal("@backend:src/index.ts")
		})
	})

	describe("removeWorkspaceHint", () => {
		it("should remove hint from path with hint", () => {
			const result = removeWorkspaceHint("@frontend:src/index.ts")
			expect(result).to.equal("src/index.ts")
		})

		it("should return original path if no hint", () => {
			const result = removeWorkspaceHint("src/index.ts")
			expect(result).to.equal("src/index.ts")
		})
	})

	describe("parseMultipleWorkspacePaths", () => {
		it("should parse multiple paths", () => {
			const paths = ["@frontend:src/index.ts", "package.json", "@backend:src/server.js"]

			const results = parseMultipleWorkspacePaths(paths)

			expect(results).to.deep.equal([
				{ workspaceHint: "frontend", relPath: "src/index.ts" },
				{ workspaceHint: undefined, relPath: "package.json" },
				{ workspaceHint: "backend", relPath: "src/server.js" },
			])
		})
	})
})
